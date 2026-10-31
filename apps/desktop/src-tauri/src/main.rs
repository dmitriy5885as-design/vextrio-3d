#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod files;
mod recent;
use tauri::Manager;
use recent::{RecentRegistry,RecentProject};
use std::{io::Write, sync::Mutex};
use files::FileSession;
#[derive(Default)]
struct CurrentFile(Mutex<FileSession>);
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenCandidate { candidate_token: String, text: String }

#[tauri::command]
fn open_project(state: tauri::State<CurrentFile>) -> Result<Option<OpenCandidate>, String> {
    // Serialize file intents, including dialogs, to make destination changes ordered.
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    let Some(path) = rfd::FileDialog::new().add_filter("VEXTRIO 3D Project", &["v3d"]).pick_file() else { return Ok(None) };
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.len() > 20_000_000 { return Err("Файл превышает допустимые 20 МБ".into()) }
    let text = files::read_project_text(&path)?;
    let candidate_token = session.offer(path);
    Ok(Some(OpenCandidate { candidate_token, text }))
}
#[tauri::command]
fn accept_open(candidate_token: String, state: tauri::State<CurrentFile>, app:tauri::AppHandle) -> Result<(), String> {
    let mut session=state.0.lock().map_err(|e|e.to_string())?;
    session.accept(&candidate_token)?;
    if let Some(path)=session.destination(){session.recent_result(recent_registry(&app).and_then(|r|r.record(&path)));}
    Ok(())
}
#[tauri::command]
fn reject_open(candidate_token: String, state: tauri::State<CurrentFile>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.reject(&candidate_token);
    Ok(())
}
#[tauri::command]
fn reset_destination(state: tauri::State<CurrentFile>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.reset();
    Ok(())
}
#[tauri::command]
fn save_project(text: String, name: String, save_as: bool, state: tauri::State<CurrentFile>, app:tauri::AppHandle) -> Result<bool, String> {
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    let existing = session.destination();
    let path = match (save_as, existing) {
        (false, Some(path)) => path,
        _ => {
            let Some(path) = rfd::FileDialog::new().add_filter("VEXTRIO 3D Project", &["v3d"]).set_file_name(format!("{}.v3d", name)).save_file() else { return Ok(false) };
            path
        }
    };
    let parent = path.parent().ok_or("Не найдена папка назначения")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(&path).map_err(|e| e.to_string())?;
    session.recent_result(recent_registry(&app).and_then(|r|r.record(&path)));
    session.saved(path);
    Ok(true)
}
fn recent_registry(app:&tauri::AppHandle)->Result<RecentRegistry,String>{Ok(RecentRegistry(app.path().app_data_dir().map_err(|e|e.to_string())?.join("recent-projects-v1.json")))}
#[tauri::command]
async fn list_recent_projects(app:tauri::AppHandle,state:tauri::State<'_,CurrentFile>)->Result<Vec<RecentProject>,String>{
    let registry=recent_registry(&app)?;
    {
        let guard=state.0.lock().map_err(|e|e.to_string())?;
        if let Some(error)=guard.recent_error(){return Err(format!("Не удалось обновить список проектов: {}",error))}
    }
    // Availability probes may involve disconnected network paths. Keep them off
    // the window thread, and do not hold the file-intent lock while probing.
    tauri::async_runtime::spawn_blocking(move || registry.list()).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn remove_recent_project(recent_id:String,app:tauri::AppHandle,state:tauri::State<CurrentFile>)->Result<(),String>{let mut guard=state.0.lock().map_err(|e|e.to_string())?;recent_registry(&app)?.remove(&recent_id)?;guard.recent_result(Ok(()));Ok(())}
#[tauri::command]
fn clear_recent_projects(app:tauri::AppHandle,state:tauri::State<CurrentFile>)->Result<(),String>{let mut guard=state.0.lock().map_err(|e|e.to_string())?;recent_registry(&app)?.clear()?;guard.recent_result(Ok(()));Ok(())}
#[tauri::command]
fn open_recent_project(recent_id:String,app:tauri::AppHandle,state:tauri::State<CurrentFile>)->Result<Option<OpenCandidate>,String>{
 let mut session=state.0.lock().map_err(|e|e.to_string())?;
 let path=recent_registry(&app)?.resolve(&recent_id)?;
 let metadata=std::fs::metadata(&path).map_err(|_|"Файл недоступен. Возможно, он перемещён или удалён.")?;
 if !metadata.is_file() || metadata.len()>20_000_000{return Err("Файл недоступен или превышает допустимые 20 МБ.".into())}
 let text=files::read_project_text(&path)?;
 let candidate_token=session.offer(path);Ok(Some(OpenCandidate{candidate_token,text}))
}
fn main() {
    tauri::Builder::default().manage(CurrentFile::default())
        .invoke_handler(tauri::generate_handler![open_project, accept_open, reject_open, save_project, reset_destination, list_recent_projects, remove_recent_project, clear_recent_projects, open_recent_project])
        .run(tauri::generate_context!()).expect("Не удалось запустить VEXTRIO 3D");
}

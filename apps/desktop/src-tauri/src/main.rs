#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod files;
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
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let candidate_token = session.offer(path);
    Ok(Some(OpenCandidate { candidate_token, text }))
}
#[tauri::command]
fn accept_open(candidate_token: String, state: tauri::State<CurrentFile>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.accept(&candidate_token)
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
fn save_project(text: String, name: String, save_as: bool, state: tauri::State<CurrentFile>) -> Result<bool, String> {
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
    session.saved(path);
    Ok(true)
}
fn main() {
    tauri::Builder::default().manage(CurrentFile::default())
        .invoke_handler(tauri::generate_handler![open_project, accept_open, reject_open, save_project, reset_destination])
        .run(tauri::generate_context!()).expect("Не удалось запустить VEXTRIO 3D");
}

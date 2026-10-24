#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io::Write, path::PathBuf, sync::Mutex};
#[derive(Default)]
struct CurrentFile(Mutex<Option<PathBuf>>);

#[tauri::command]
fn open_project(state: tauri::State<CurrentFile>) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new().add_filter("FORMA Project", &["v3d"]).pick_file() else { return Ok(None) };
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.len() > 20_000_000 { return Err("Файл превышает допустимые 20 МБ".into()) }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    // Keep the previous save destination until the frontend validates the document.
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(Some(text))
}

#[tauri::command]
fn reset_destination(state: tauri::State<CurrentFile>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
fn save_project(text: String, name: String, save_as: bool, state: tauri::State<CurrentFile>) -> Result<bool, String> {
    let existing = state.0.lock().map_err(|e| e.to_string())?.clone();
    let path = if !save_as && existing.is_some() { existing.unwrap() } else {
        let Some(path) = rfd::FileDialog::new().add_filter("FORMA Project", &["v3d"]).set_file_name(format!("{}.v3d", name)).save_file() else { return Ok(false) };
        path
    };
    let parent = path.parent().ok_or("Не найдена папка назначения")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(&path).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(true)
}
fn main() {
    tauri::Builder::default().manage(CurrentFile::default())
        .invoke_handler(tauri::generate_handler![open_project, save_project, reset_destination])
        .run(tauri::generate_context!()).expect("Не удалось запустить FORMA");
}

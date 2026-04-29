#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new("open");
    if path.starts_with("obsidian://") {
        cmd.arg(&path);
    } else {
        cmd.arg("-a").arg("Obsidian").arg(&path);
    }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let is_dir = entry.path().is_dir();
        result.push(DirEntry {
            name,
            path: full_path,
            is_dir,
        });
    }
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_file,
            read_text_file,
            write_text_file,
            read_dir
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

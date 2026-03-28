use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct PythonServer(Mutex<Option<Child>>);

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    let mut cmd = Command::new("open");
    if path.starts_with("obsidian://") {
        cmd.arg(&path);
    } else {
        cmd.arg("-a").arg("Obsidian").arg(&path);
    }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Walk up the directory tree from the executable to find server.py.
/// Returns the project root directory on success.
fn find_project_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?.to_path_buf();

    for _ in 0..10 {
        if dir.join("server.py").exists() {
            return Some(dir);
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_file])
        .manage(PythonServer(Mutex::new(None)))
        .setup(|app| {
            let server_handle = app.state::<PythonServer>();

            match find_project_root() {
                Some(project_dir) => {
                    // Run through /bin/arch -arm64 /bin/bash so that the shell
                    // and all its children (including Python) execute as native
                    // arm64, regardless of whether the Tauri binary was built
                    // for x86_64 / Rosetta.
                    let activate = project_dir.join("venv/bin/activate");
                    let server  = project_dir.join("server.py");

                    let shell_cmd = format!(
                        "lsof -ti :8765 | xargs kill -9 2>/dev/null; sleep 0.5; source '{}' && python '{}'",
                        activate.display(),
                        server.display(),
                    );

                    match Command::new("/usr/bin/arch")
                        .arg("-arm64")
                        .arg("/bin/bash")
                        .arg("-c")
                        .arg(&shell_cmd)
                        .current_dir(&project_dir)
                        .spawn()
                    {
                        Ok(child) => {
                            *server_handle.0.lock().unwrap() = Some(child);
                            println!("[tauri] Started Python server (arm64 shell)");
                        }
                        Err(e) => {
                            eprintln!("[tauri] Failed to start Python server: {}", e);
                        }
                    }
                }
                None => {
                    eprintln!(
                        "[tauri] Could not find server.py. \
                         Start the server manually: python server.py"
                    );
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let server_handle = app.state::<PythonServer>();
                let child = { server_handle.0.lock().unwrap().take() };
                if let Some(mut c) = child {
                    let _ = c.kill();
                    println!("[tauri] Python server process killed.");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

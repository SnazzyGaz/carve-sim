//! Carve Sim desktop shell: serves the static app in `../app` unchanged and adds one command,
//! `save_file`, because not every platform webview honours `<a download>` (WebKitGTK, WKWebView).

use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

/// Body: raw bytes of the file. Header `x-file-name`: URI-encoded suggested name.
/// Shows a native Save dialog; returns the saved path, or null if the user cancelled.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_file expects raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "carve-sim-export".into());
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(ext) = std::path::Path::new(&name).extension().and_then(|e| e.to_str()) {
        let label = match ext.to_ascii_lowercase().as_str() {
            "png" => "PNG image",
            "svg" => "SVG drawing",
            "json" => "JSON",
            _ => "File",
        };
        dialog = dialog.add_filter(label, &[ext]);
    }
    let Some(path) = dialog.blocking_save_file() else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("error while running Carve Sim");
}

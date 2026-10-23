use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WindowEvent};

mod reminders;

// Settings > Desktop integration: what closing / minimizing the window does.
#[derive(Default)]
struct TrayBehaviour {
    close_to_tray: AtomicBool,
    minimize_to_tray: AtomicBool,
}

// The updater can replace a Windows install or an AppImage; a .deb / .rpm belongs to the
// package manager (and a binary built from source to whoever built it).
#[tauri::command]
fn can_self_update() -> bool {
    cfg!(windows) || std::env::var_os("APPIMAGE").is_some()
}

#[tauri::command]
fn set_tray_behaviour(state: State<TrayBehaviour>, close_to_tray: bool, minimize_to_tray: bool) {
    state.close_to_tray.store(close_to_tray, Ordering::Relaxed);
    state.minimize_to_tray.store(minimize_to_tray, Ordering::Relaxed);
}

// ---- spell checking (WebKitGTK uses Enchant, which reads Hunspell dictionaries) ----
fn dictionary_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/usr/share/hunspell"),
        PathBuf::from("/usr/share/myspell"),
        PathBuf::from("/usr/share/myspell/dicts"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".local/share/hunspell"));
    }
    dirs
}

// Languages with an installed dictionary, e.g. ["en_US", "pl_PL"].
#[tauri::command]
fn spellcheck_languages_available() -> Vec<String> {
    let mut langs: Vec<String> = dictionary_dirs()
        .iter()
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.strip_suffix(".dic").map(|s| s.to_string())
        })
        .filter(|lang| lang.len() <= 12 && lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .collect();
    langs.sort();
    langs.dedup();
    langs
}

#[tauri::command]
fn set_spellcheck(window: tauri::WebviewWindow, enabled: bool, languages: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::{WebContextExt, WebViewExt};
        window
            .with_webview(move |webview| {
                if let Some(context) = webview.inner().context() {
                    context.set_spell_checking_enabled(enabled);
                    let langs: Vec<&str> = languages.iter().map(|s| s.as_str()).collect();
                    context.set_spell_checking_languages(&langs);
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, enabled, languages);
    }
    Ok(())
}

// Own words the spell checker accepts: Enchant's personal word list of each language
// (~/.config/enchant/<lang>.dic, one word per line).
fn personal_dictionary(lang: &str) -> Option<PathBuf> {
    if lang.is_empty() || !lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return None;
    }
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("enchant").join(format!("{lang}.dic")))
}

#[tauri::command]
fn get_custom_words(languages: Vec<String>) -> Vec<String> {
    let mut words: Vec<String> = languages
        .iter()
        .filter_map(|lang| personal_dictionary(lang))
        .filter_map(|path| std::fs::read_to_string(path).ok())
        .flat_map(|text| text.lines().map(|l| l.trim().to_string()).collect::<Vec<_>>())
        .filter(|w| !w.is_empty())
        .collect();
    words.sort();
    words.dedup();
    words
}

#[tauri::command]
fn set_custom_words(languages: Vec<String>, words: Vec<String>) -> Result<(), String> {
    let clean: Vec<String> = words
        .iter()
        .map(|w| w.trim().to_string())
        .filter(|w| !w.is_empty() && !w.contains(char::is_whitespace) && w.len() < 100)
        .collect();
    for lang in &languages {
        if let Some(path) = personal_dictionary(lang) {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, clean.join("\n") + "\n").map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// A desktop notification through the system's notification daemon (notify-send), so it looks
// like the other notifications. `kind` picks the icon: a Quickshell notification icon set when
// there is one (~/.config/quickshell/assets/icons/notifications), else a theme icon.
// Windows shows toasts under the app's AppUserModelID (the installer's shortcut carries it).
#[cfg(windows)]
pub(crate) const WINDOWS_APP_ID: &str = "io.github.juliuszjk.noted";

#[cfg(windows)]
#[tauri::command]
fn notify(app: tauri::AppHandle, summary: String, body: String, kind: String) -> Result<(), String> {
    let _ = kind;
    // A click on the toast opens the window.
    tauri_winrt_notification::Toast::new(WINDOWS_APP_ID)
        .title(&summary)
        .text1(&body)
        .on_activated(move |_| {
            show_main(&app);
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn notify(summary: String, body: String, kind: String) -> Result<(), String> {
    let custom = std::env::var("HOME").ok().map(|home| {
        let name = if kind == "image" { "picture.png" } else { "upload.png" };
        std::path::PathBuf::from(home).join(".config/quickshell/assets/icons/notifications").join(name)
    });
    let icon = match custom {
        Some(path) if path.is_file() => path.to_string_lossy().into_owned(),
        _ => if kind == "image" { "image-x-generic".into() } else { "document-save".into() },
    };
    std::process::Command::new("notify-send")
        .args(["-a", "Noted", "-u", "low", "-i", &icon, "-h", "string:x-canonical-private-synchronous:noted-download", &summary, &body])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// Opens a folder in the file manager (only folders: never runs a file).
#[tauri::command]
fn open_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !std::path::Path::new(&path).is_dir() {
        return Err("Not a folder".into());
    }
    #[cfg(target_os = "linux")]
    if let Some(mut command) = terminal_file_manager(&path) {
        return command.spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

// xdg-open starts a terminal file manager (Terminal=true, e.g. yazi) without a terminal, so
// it quits at once. Such a manager is started inside a terminal here instead.
#[cfg(target_os = "linux")]
fn terminal_file_manager(path: &str) -> Option<std::process::Command> {
    use std::process::Command;
    let out = Command::new("xdg-mime").args(["query", "default", "inode/directory"]).output().ok()?;
    let desktop = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if desktop.is_empty() || desktop.contains('/') {
        return None;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs = vec![std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| format!("{home}/.local/share"))];
    dirs.extend(
        std::env::var("XDG_DATA_DIRS")
            .unwrap_or_else(|_| "/usr/local/share:/usr/share".into())
            .split(':')
            .map(String::from),
    );
    let text = dirs.iter().find_map(|d| std::fs::read_to_string(format!("{d}/applications/{desktop}")).ok())?;
    let mut in_entry = false;
    let (mut terminal, mut exec) = (false, None);
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
        } else if in_entry {
            if line == "Terminal=true" {
                terminal = true;
            } else if let Some(value) = line.strip_prefix("Exec=") {
                exec = Some(value.to_string());
            }
        }
    }
    if !terminal {
        return None;
    }
    // The program and its arguments, without field codes; the folder goes last.
    let mut args: Vec<String> = exec?
        .split_whitespace()
        .filter(|a| !(a.len() == 2 && a.starts_with('%')))
        .map(String::from)
        .collect();
    if args.is_empty() {
        return None;
    }
    args.push(path.to_string());
    let on_path = |name: &str| {
        std::env::var("PATH")
            .unwrap_or_default()
            .split(':')
            .any(|dir| std::path::Path::new(dir).join(name).is_file())
    };
    let term = std::env::var("TERMINAL").ok().filter(|t| on_path(t)).or_else(|| {
        ["kitty", "foot", "alacritty", "wezterm", "ghostty", "konsole", "gnome-terminal", "xfce4-terminal", "xterm"]
            .into_iter()
            .find(|t| on_path(t))
            .map(String::from)
    })?;
    let mut command = Command::new(&term);
    match term.as_str() {
        "wezterm" => { command.args(["start", "--"]); }
        "gnome-terminal" => { command.arg("--"); }
        _ => { command.arg("-e"); }
    }
    command.args(&args).current_dir(path);
    Some(command)
}

// Windows 11 paints the native title bar in the app's colours (DWM caption / text / border
// colour, `#rrggbb` from the theme); older Windows ignores the attributes. Elsewhere the window
// manager draws the frame.
#[cfg(windows)]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(hwnd: *mut std::ffi::c_void, attribute: u32, value: *const std::ffi::c_void, size: u32) -> i32;
}

#[cfg(windows)]
fn colorref(hex: &str) -> Option<u32> {
    let hex = hex.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let rgb = u32::from_str_radix(hex, 16).ok()?;
    // COLORREF is 0x00BBGGRR.
    Some(((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff))
}

#[tauri::command]
fn set_title_bar_colors(window: tauri::WebviewWindow, background: String, text: String, border: String) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        const DWMWA_BORDER_COLOR: u32 = 34;
        const DWMWA_CAPTION_COLOR: u32 = 35;
        const DWMWA_TEXT_COLOR: u32 = 36;
        for (attribute, hex) in [(DWMWA_CAPTION_COLOR, &background), (DWMWA_TEXT_COLOR, &text), (DWMWA_BORDER_COLOR, &border)] {
            if let Some(color) = colorref(hex) {
                unsafe {
                    DwmSetWindowAttribute(hwnd.0 as *mut _, attribute, &color as *const u32 as *const _, 4);
                }
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (window, background, text, border);
}

const AUTOSTART_ARG: &str = "--autostart";

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// Same limit as the server's blobs (30 MB of plain bytes).
const PASTED_FILE_LIMIT: u64 = 30 * 1024 * 1024;

// A file copied in a file manager and pasted into a note (the clipboard holds its path; the fs
// plugin's scope does not cover arbitrary paths). Only regular files up to the blob limit.
#[tauri::command]
fn read_local_file(path: String) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("Not an absolute path".into());
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > PASTED_FILE_LIMIT {
        return Err("File is larger than 30 MB".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

// Files copied in a file manager (yazi `c y`, Nautilus) are a text/uri-list on the clipboard.
// WebKitGTK tells the page the type but gives it neither the list nor the files (it pastes
// the paths as text), so the page asks here: GTK's clipboard, read on the main thread.
#[cfg(target_os = "linux")]
#[tauri::command]
async fn clipboard_file_paths(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();
    app.run_on_main_thread(move || {
        let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
        clipboard.request_uris(move |_, uris| {
            let paths = uris
                .iter()
                .filter_map(|uri| glib::filename_from_uri(uri).ok())
                .map(|(path, _)| path.to_string_lossy().into_owned())
                .collect();
            let _ = tx.send(paths);
        });
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

// Elsewhere the WebView hands pasted files to the page itself.
#[cfg(not(target_os = "linux"))]
#[tauri::command]
async fn clipboard_file_paths() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

// Touchpad / touchscreen pinch: WebKitGTK magnifies the whole page and the page cannot stop it
// (no setting, the viewport meta is ignored). WebKit keeps its GtkGestureZoom on the view
// under "wk-view-zoom-gesture" with handlers whose data is the view; those are disconnected
// and the gesture is sent to the page instead ("noted:pinch"), which zooms only the note.
#[cfg(target_os = "linux")]
fn redirect_pinch_zoom(app: tauri::AppHandle, view: &webkit2gtk::WebView) {
    use glib::translate::FromGlibPtrNone;
    use gtk::prelude::*;
    use tauri::Emitter;
    unsafe {
        let object: *mut glib::gobject_ffi::GObject = view.as_ptr() as *mut _;
        let data = glib::gobject_ffi::g_object_get_data(object, c"wk-view-zoom-gesture".as_ptr());
        if data.is_null() {
            return;
        }
        let gesture = gtk::GestureZoom::from_glib_none(data as *mut gtk::ffi::GtkGestureZoom);
        let removed = glib::gobject_ffi::g_signal_handlers_disconnect_matched(
            gesture.as_ptr() as *mut _,
            glib::gobject_ffi::G_SIGNAL_MATCH_DATA,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            object as *mut _,
        );
        if removed == 0 {
            return;
        }
        let emit = move |phase: &str, scale: f64| {
            let _ = app.emit("noted:pinch", serde_json::json!({ "phase": phase, "scale": scale }));
        };
        let on_begin = emit.clone();
        gesture.connect_begin(move |_, _| on_begin("begin", 1.0));
        let on_change = emit.clone();
        gesture.connect_scale_changed(move |_, scale| on_change("change", scale));
        gesture.connect_end(move |_, _| emit("end", 1.0));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // One installed app at a time (one database): starting Noted again (launcher, autostart
    // while it already runs in the tray) shows the running window instead. Must be the first
    // plugin. Debug builds skip it: the second test profile (CLAUDE.md) runs the debug binary.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        if !args.iter().any(|a| a == AUTOSTART_ARG) {
            show_main(app);
        }
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Remembers folders picked in dialogs (the automatic backup folder) across restarts.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // Updates from the GitHub releases (only release builds made by CI ask, see updates.ts).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // The autostart entry starts the app with `--autostart`: it then stays in the tray.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![AUTOSTART_ARG])))
        .manage(TrayBehaviour::default())
        .manage(reminders::Reminders::default())
        .setup(|app| {
            reminders::start(app.handle().clone(), app.state::<reminders::Reminders>().inner().clone());
            // Tray icon: click shows the window; the menu has Show and Quit.
            let show = MenuItem::with_id(app, "show", "Show Noted", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Noted")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            // The window starts hidden (tauri.conf.json); shown at once unless autostarted.
            if !std::env::args().any(|a| a == AUTOSTART_ARG) {
                show_main(app.handle());
            }
            // Memory: WebKit's default cache model is a web browser's (keeps pages, decoded images
            // and resources around for going back and forth). One page that stays open needs
            // the smallest model; the release build also has no web inspector.
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                use webkit2gtk::{CacheModel, WebContextExt, WebViewExt};
                let handle = app.handle().clone();
                let _ = window.with_webview(move |webview| {
                    let view = webview.inner();
                    redirect_pinch_zoom(handle, &view);
                    if let Some(context) = view.context() {
                        context.set_cache_model(CacheModel::DocumentViewer);
                    }
                    #[cfg(not(debug_assertions))]
                    if let Some(settings) = WebViewExt::settings(&view) {
                        webkit2gtk::SettingsExt::set_enable_developer_extras(&settings, false);
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let behaviour = window.state::<TrayBehaviour>();
            match event {
                WindowEvent::CloseRequested { api, .. } if behaviour.close_to_tray.load(Ordering::Relaxed) => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Resized(_) if behaviour.minimize_to_tray.load(Ordering::Relaxed) => {
                    if window.is_minimized().unwrap_or(false) {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_tray_behaviour,
            can_self_update,
            set_title_bar_colors,
            spellcheck_languages_available,
            set_spellcheck,
            get_custom_words,
            set_custom_words,
            open_folder,
            notify,
            read_local_file,
            clipboard_file_paths,
            reminders::set_reminder_notices
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

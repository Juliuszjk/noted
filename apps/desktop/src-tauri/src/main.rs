// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Memory: glibc gives every thread its own malloc arena and keeps freed memory in them;
    // with tokio's and WebKit's many threads that adds up. Two arenas are plenty for a notes
    // app. The variable is inherited by WebKit's helper processes too.
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    {
        std::env::set_var("MALLOC_ARENA_MAX", "2");
        unsafe {
            libc::mallopt(libc::M_ARENA_MAX, 2);
        }
    }
    #[cfg(target_os = "linux")]
    move_old_data();
    desktop_lib::run()
}

// The app identifier was "com.apollo.desktop" before 0.1 (2026-10-18): its folders (database in
// the config dir, WebView storage with the key and settings in the data dir, cache) move to the
// new identifier once, before anything opens them. Never over an existing new folder.
#[cfg(target_os = "linux")]
fn move_old_data() {
    use std::path::PathBuf;
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return };
    let base = |var: &str, fallback: &str| std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| home.join(fallback));
    for dir in [base("XDG_DATA_HOME", ".local/share"), base("XDG_CONFIG_HOME", ".config"), base("XDG_CACHE_HOME", ".cache")] {
        let (old, new) = (dir.join("com.apollo.desktop"), dir.join("io.github.juliuszjk.noted"));
        if old.is_dir() && !new.exists() {
            if let Err(e) = std::fs::rename(&old, &new) {
                eprintln!("Could not move {} to {}: {e}", old.display(), new.display());
            }
        }
    }
}

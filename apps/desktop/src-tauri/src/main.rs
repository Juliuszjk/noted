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
    desktop_lib::run()
}

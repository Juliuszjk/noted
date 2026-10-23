// Reminder notifications (packages/ui/src/reminder-notify.ts builds the list). The timer runs
// here, not in the page, so a window hidden in the tray still notifies on time. A notification
// has buttons; a press is sent to the page as `noted:reminder-action` {id, action}, which
// changes the reminder (and syncs it). A notice that leaves the list (done or moved, here or
// on another device) closes its notification.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

#[derive(Deserialize, Clone)]
pub struct Notice {
    id: String,
    due: i64,
    title: String,
    body: String,
}

#[derive(Serialize, Clone)]
struct ActionEvent {
    id: String,
    action: String,
}

#[derive(Default)]
struct Inner {
    notices: Vec<Notice>,
    // Notices already shown (this run, or an earlier one: `set_reminder_notices`' `shown`).
    fired: HashSet<String>,
    #[cfg(target_os = "linux")]
    open: HashMap<String, notify_rust::NotificationHandle>,
    #[cfg(not(target_os = "linux"))]
    open: HashMap<String, ()>,
}

#[derive(Default, Clone)]
pub struct Reminders {
    inner: Arc<(Mutex<Inner>, Condvar)>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

// The whole list of notices (from the page, after every change). `shown` = ids the page saw
// shown before (kept across restarts), so a restart does not notify them again.
#[tauri::command]
pub fn set_reminder_notices(state: State<Reminders>, notices: Vec<Notice>, shown: Vec<String>) {
    let (lock, wake) = &*state.inner;
    let mut inner = lock.lock().unwrap();
    inner.fired.extend(shown);
    let keep: HashSet<String> = notices.iter().map(|n| n.id.clone()).collect();
    let gone: Vec<String> = inner.open.keys().filter(|id| !keep.contains(*id)).cloned().collect();
    for id in gone {
        #[cfg(target_os = "linux")]
        if let Some(handle) = inner.open.remove(&id) {
            handle.close();
        }
        #[cfg(not(target_os = "linux"))]
        inner.open.remove(&id);
    }
    inner.notices = notices;
    wake.notify_all();
}

pub fn start(app: AppHandle, reminders: Reminders) {
    std::thread::spawn(move || {
        let (lock, wake) = &*reminders.inner;
        let mut inner = lock.lock().unwrap();
        loop {
            let now = now_ms();
            let due: Vec<Notice> = inner.notices.iter().filter(|n| n.due <= now && !inner.fired.contains(&n.id)).cloned().collect();
            for notice in due {
                inner.fired.insert(notice.id.clone());
                let _ = app.emit("noted:reminder-shown", notice.id.clone());
                #[cfg(target_os = "linux")]
                if let Some(handle) = show(&app, &reminders, &notice) {
                    inner.open.insert(notice.id.clone(), handle);
                }
                #[cfg(windows)]
                show(&app, &notice);
            }
            let next = inner.notices.iter().filter(|n| !inner.fired.contains(&n.id)).map(|n| n.due).min();
            // At most a minute: the clock jumps after a suspend.
            let wait = next.map(|due| (due - now).clamp(0, 60_000)).unwrap_or(60_000) as u64;
            inner = wake.wait_timeout(inner, Duration::from_millis(wait.max(50))).unwrap().0;
        }
    });
}

#[cfg(target_os = "linux")]
fn show(app: &AppHandle, reminders: &Reminders, notice: &Notice) -> Option<notify_rust::NotificationHandle> {
    use notify_rust::{Hint, Notification, Timeout};
    let handle = Notification::new()
        .appname("Noted")
        .summary(&notice.title)
        .body(&notice.body)
        // The app's own icon (hicolor "noted", installed by install-linux.sh).
        .icon("noted")
        .hint(Hint::DesktopEntry("noted".into()))
        .hint(Hint::Category("reminder".into()))
        .action("default", "Open")
        .action("done", "Done")
        .action("hour", "In 1 hour")
        .action("tomorrow", "Tomorrow")
        .timeout(Timeout::Never)
        .show()
        .ok()?;
    let nid = handle.id();
    let id = notice.id.clone();
    let app = app.clone();
    let reminders = reminders.clone();
    std::thread::spawn(move || {
        let _ = notify_rust::handle_action(nid, |response| {
            if let notify_rust::ActionResponse::Custom(action) = response {
                if *action == "default" {
                    crate::show_main(&app);
                }
                let _ = app.emit("noted:reminder-action", ActionEvent { id: id.clone(), action: action.to_string() });
            }
        });
        reminders.inner.0.lock().unwrap().open.remove(&id);
    });
    Some(handle)
}

// notify-rust's Windows toasts have no buttons, so the toast is built here. The `reminder`
// scenario keeps it on screen until it is answered; a click on the toast itself (no button)
// opens the window like Linux's "default" action.
#[cfg(windows)]
fn show(app: &AppHandle, notice: &Notice) {
    use tauri_winrt_notification::{Scenario, Toast};
    let id = notice.id.clone();
    let app = app.clone();
    let _ = Toast::new(crate::WINDOWS_APP_ID)
        .title(&notice.title)
        .text1(&notice.body)
        .scenario(Scenario::Reminder)
        .add_button("Done", "done")
        .add_button("In 1 hour", "hour")
        .add_button("Tomorrow", "tomorrow")
        .on_activated(move |action| {
            let action = action.unwrap_or_else(|| "default".to_string());
            if action == "default" {
                crate::show_main(&app);
            }
            let _ = app.emit("noted:reminder-action", ActionEvent { id: id.clone(), action });
            Ok(())
        })
        .show();
}

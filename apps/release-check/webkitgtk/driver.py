#!/usr/bin/env python3
"""Runs the release harness in the real WebKitGTK of the Linux app (webkit2gtk-4.1) and saves
each note's layout facts and PDF. The PDF goes through the same calls as print_pdf in
apps/desktop/src-tauri/src/lib.rs (WebKit PrintOperation, Print to File, A4, 6.35 mm margins).
Started by run.mjs inside a headless Weston: no window ever reaches the desktop."""
import json
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

BASE, OUT = sys.argv[1], sys.argv[2]
FIXTURES = ["wrap", "collapsed", "pages", "kitchen"]
TIMEOUT_S = 40

window = Gtk.Window()
window.set_default_size(1280, 820)
view = WebKit2.WebView.new_with_context(WebKit2.WebContext.new_ephemeral())
window.add(view)
window.show_all()


def wait(start):
    """Runs the GTK loop until start(done) calls done(value)."""
    loop = GLib.MainLoop()
    box = {}

    def done(value=None, error=None):
        if box:  # A failed print also reports "finished": the first answer counts.
            return
        box.update(value=value, error=error)
        loop.quit()

    timer = GLib.timeout_add_seconds(TIMEOUT_S, lambda: done(error="timed out"))
    start(done)
    loop.run()
    if box.get("error") != "timed out":
        GLib.source_remove(timer)
    if box.get("error"):
        raise RuntimeError(box["error"])
    return box["value"]


def run_js(code):
    def start(done):
        view.evaluate_javascript(code, -1, None, None, None, lambda v, res, _: done(v.evaluate_javascript_finish(res).to_string()), None)

    return wait(start)


def call(expression):
    """Evaluates an expression that may be a promise; returns its JSON value."""
    run_js(f"window.__r = null; Promise.resolve().then(() => {expression}).then((v) => {{ window.__r = JSON.stringify({{ ok: v ?? null }}); }}, (e) => {{ window.__r = JSON.stringify({{ error: String(e) }}); }}); 0")

    def start(done):
        def poll():
            text = run_js("window.__r || ''")
            if text:
                done(json.loads(text))
                return False
            return True

        GLib.timeout_add(40, poll)

    answer = wait(start)
    if "error" in answer:
        raise RuntimeError(f"{expression}: {answer['error']}")
    return answer["ok"]


def load(url):
    def start(done):
        def changed(_view, event):
            if event == WebKit2.LoadEvent.FINISHED:
                view.disconnect(handler)
                done()

        handler = view.connect("load-changed", changed)
        view.load_uri(url)

    wait(start)


def print_pdf(path):
    settings = Gtk.PrintSettings()
    settings.set_printer("Print to File")
    settings.set(Gtk.PRINT_SETTINGS_OUTPUT_FILE_FORMAT, "pdf")
    settings.set(Gtk.PRINT_SETTINGS_OUTPUT_URI, GLib.filename_to_uri(path, None))
    setup = Gtk.PageSetup()
    setup.set_paper_size(Gtk.PaperSize.new(Gtk.PAPER_NAME_A4))
    for margin in (setup.set_top_margin, setup.set_bottom_margin, setup.set_left_margin, setup.set_right_margin):
        margin(6.35, Gtk.Unit.MM)
    operation = WebKit2.PrintOperation.new(view)
    operation.set_print_settings(settings)
    operation.set_page_setup(setup)

    def start(done):
        operation.connect("failed", lambda _o, error: done(error=str(error)))
        operation.connect("finished", lambda _o: done())
        operation.print_()

    wait(start)


load(f"{BASE}/index.html")
results = {"userAgent": call("navigator.userAgent"), "notes": {}}
for name in FIXTURES:
    call(f"window.__h.openFixture('{name}')")
    results["notes"][name] = {"sheets": call("window.__h.sheets()")}
    call("window.__h.mountPrint()")
    print_pdf(os.path.join(OUT, f"{name}.pdf"))
    call("document.getElementById('noted-print')?.remove()")
call("window.__h.openFixture('fold')")
results["foldPress"] = call("window.__h.foldPressProbe()")
with open(os.path.join(OUT, "result.json"), "w", encoding="utf-8") as out:
    json.dump(results, out, indent=1)
print("webkitgtk: done")

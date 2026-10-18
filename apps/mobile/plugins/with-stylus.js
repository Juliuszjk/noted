// Expo config plugin: stylus input for the WebView editor (drawing blocks), in MainActivity.
// - Unbuffered pen events: Android batches touch events to one per frame (~60 Hz) unless the
//   window asks otherwise; Chrome does, a WebView does not. With it the page gets ~480 Hz.
// - S Pen side button: Chromium turns a touch with the button held into a context click, so the
//   page never sees the stroke. A contact that starts with the button held is passed on as the
//   eraser end of a pen (TOOL_TYPE_ERASER), which the page sees as `buttons & 32`; the button
//   bit is cleared from every stylus event.
// - The system back gesture: a stroke to the screen edge (a cut across a drawing) was taken
//   for "back". While the pen is near the screen, the edges at its height are left out of the
//   gesture (Android allows 200 dp per edge); fingers keep it everywhere else.
// - Hover: a WebView never passes the pen above the screen on to its page. Its position (in
//   the page's CSS pixels) and the side button go straight to the visible WebViews
//   (window.__notedPenHover), about 60 times a second, so a drawing can show the eraser ring.
// - No haptics in the WebViews: Chromium ticks the vibration motor each time a selection
//   handle moves on by a character, a buzz under the finger while the text scrolls.
const { withMainActivity } = require('expo/config-plugins');

const MARKER = 'Noted stylus input (plugins/with-stylus.js)';
const ANCHOR = '  override fun getMainComponentName()';

const METHODS = `
  // ${MARKER}: unbuffered pen events and the side button
  // held at the start of a contact = eraser.
  private var notedPenEraser = false
  private val notedHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private var notedExcludedY = -1f
  private val notedClearEdges = Runnable {
    notedExcludedY = -1f
    if (Build.VERSION.SDK_INT >= 29) window.decorView.systemGestureExclusionRects = emptyList()
  }

  // The pen near the screen: the edges at its height are no back gesture.
  private fun notedExcludeEdges(y: Float) {
    if (Build.VERSION.SDK_INT < 29) return
    notedHandler.removeCallbacks(notedClearEdges)
    val density = resources.displayMetrics.density
    if (notedExcludedY >= 0 && kotlin.math.abs(y - notedExcludedY) < 24 * density) return
    notedExcludedY = y
    val view = window.decorView
    val half = (100 * density).toInt()
    val edge = (48 * density).toInt()
    val top = (y.toInt() - half).coerceAtLeast(0)
    val bottom = (y.toInt() + half).coerceAtMost(view.height)
    view.systemGestureExclusionRects = listOf(
      android.graphics.Rect(0, top, edge, bottom),
      android.graphics.Rect(view.width - edge, top, view.width, bottom),
    )
  }

  // The pen gone: the edges are the system's again a moment later.
  private fun notedReleaseEdges() {
    notedHandler.removeCallbacks(notedClearEdges)
    notedHandler.postDelayed(notedClearEdges, 1500)
  }

  private var notedHoverAt = 0L
  private var notedHovering = false

  private fun notedWebViews(view: android.view.View, out: MutableList<android.webkit.WebView>) {
    if (view is android.webkit.WebView) {
      if (view.isShown) out.add(view)
      return
    }
    if (view is android.view.ViewGroup) for (i in 0 until view.childCount) notedWebViews(view.getChildAt(i), out)
  }

  // The pen above the screen (null = gone) to the pages.
  private fun notedSendHover(e: MotionEvent?) {
    val now = android.os.SystemClock.uptimeMillis()
    if (e != null && now - notedHoverAt < 16) return
    if (e == null && !notedHovering) return
    notedHoverAt = now
    notedHovering = e != null
    val views = mutableListOf<android.webkit.WebView>()
    notedWebViews(window.decorView, views)
    val density = resources.displayMetrics.density
    val at = IntArray(2)
    for (w in views) {
      val js = if (e == null) {
        "window.__notedPenHover&&window.__notedPenHover(null,0,false)"
      } else {
        w.getLocationInWindow(at)
        var x = e.x
        var y = e.y
        for (i in 0 until e.pointerCount) if (e.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) { x = e.getX(i); y = e.getY(i) }
        val button = (e.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY) != 0
        "window.__notedPenHover&&window.__notedPenHover(\${(x - at[0]) / density},\${(y - at[1]) / density},$button)"
      }
      w.evaluateJavascript(js, null)
    }
  }

  private fun notedStylusY(e: MotionEvent): Float {
    for (i in 0 until e.pointerCount) if (e.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) return e.getY(i)
    return e.y
  }

  private fun notedHasStylus(e: MotionEvent): Boolean {
    for (i in 0 until e.pointerCount) if (e.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) return true
    return false
  }

  // The WebViews' haptics off (selection handles ticking); checked at each first touch, as the
  // editor's WebView comes later than the Activity.
  private fun notedQuietWebViews() {
    val views = mutableListOf<android.webkit.WebView>()
    notedWebViews(window.decorView, views)
    for (w in views) if (w.isHapticFeedbackEnabled) w.isHapticFeedbackEnabled = false
  }

  override fun dispatchTouchEvent(e: MotionEvent): Boolean {
    if (e.actionMasked == MotionEvent.ACTION_DOWN) notedQuietWebViews()
    if (!notedHasStylus(e)) return super.dispatchTouchEvent(e)
    val action = e.actionMasked
    val actionTool = e.getToolType(e.actionIndex)
    if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) notedReleaseEdges()
    else notedExcludeEdges(notedStylusY(e))
    if ((action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) && actionTool == MotionEvent.TOOL_TYPE_STYLUS) {
      if (Build.VERSION.SDK_INT >= 30) window.decorView.requestUnbufferedDispatch(e)
      notedPenEraser = (e.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY) != 0
    }
    val ending = (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL ||
      (action == MotionEvent.ACTION_POINTER_UP && actionTool == MotionEvent.TOOL_TYPE_STYLUS))
    val stylusButtons = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY
    if (!notedPenEraser && (e.buttonState and stylusButtons) == 0) {
      if (ending) notedPenEraser = false
      return super.dispatchTouchEvent(e)
    }
    val n = e.pointerCount
    val props = Array(n) { i ->
      MotionEvent.PointerProperties().also { p ->
        e.getPointerProperties(i, p)
        if (notedPenEraser && p.toolType == MotionEvent.TOOL_TYPE_STYLUS) p.toolType = MotionEvent.TOOL_TYPE_ERASER
      }
    }
    val coords = Array(n) { i -> MotionEvent.PointerCoords().also { c -> e.getPointerCoords(i, c) } }
    val copy = MotionEvent.obtain(e.downTime, e.eventTime, e.action, n, props, coords, e.metaState,
      e.buttonState and stylusButtons.inv(), e.xPrecision, e.yPrecision, e.deviceId, e.edgeFlags, e.source, e.flags)
    try {
      return super.dispatchTouchEvent(copy)
    } finally {
      copy.recycle()
      if (ending) notedPenEraser = false
    }
  }

  // The side button pressed during a contact would reach Chromium as a context click.
  override fun dispatchGenericMotionEvent(e: MotionEvent): Boolean {
    val a = e.actionMasked
    if (notedHasStylus(e)) {
      if (a == MotionEvent.ACTION_HOVER_ENTER || a == MotionEvent.ACTION_HOVER_MOVE) {
        notedExcludeEdges(notedStylusY(e))
        notedSendHover(e)
      } else if (a == MotionEvent.ACTION_HOVER_EXIT) {
        notedReleaseEdges()
        notedSendHover(null)
      }
    }
    if ((a == MotionEvent.ACTION_BUTTON_PRESS || a == MotionEvent.ACTION_BUTTON_RELEASE) && notedHasStylus(e)) return true
    return super.dispatchGenericMotionEvent(e)
  }
`;

module.exports = (config) => withMainActivity(config, (cfg) => {
  let src = cfg.modResults.contents;
  if (cfg.modResults.language !== 'kt') throw new Error('with-stylus: MainActivity must be Kotlin');
  if (!src.includes('import android.view.MotionEvent')) src = src.replace(/^(package [^\n]+\n)/, '$1\nimport android.view.MotionEvent\n');
  if (!src.includes('import android.os.Build')) src = src.replace(/^(package [^\n]+\n)/, '$1\nimport android.os.Build\n');
  // An older copy of these methods (an earlier prebuild) is replaced.
  const marker = src.indexOf(`// ${MARKER}`);
  if (marker >= 0) {
    const old = src.lastIndexOf('\n', marker) + 1;
    src = src.slice(0, old) + src.slice(src.indexOf(ANCHOR, old));
  }
  const anchor = src.indexOf(ANCHOR);
  if (anchor < 0) throw new Error('with-stylus: getMainComponentName not found in MainActivity');
  src = `${src.slice(0, anchor)}${METHODS.replace(/^\n/, '')}\n${src.slice(anchor)}`;
  cfg.modResults.contents = src;
  return cfg;
});

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

  private fun notedStylusY(e: MotionEvent): Float {
    for (i in 0 until e.pointerCount) if (e.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) return e.getY(i)
    return e.y
  }

  private fun notedHasStylus(e: MotionEvent): Boolean {
    for (i in 0 until e.pointerCount) if (e.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) return true
    return false
  }

  override fun dispatchTouchEvent(e: MotionEvent): Boolean {
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
      if (a == MotionEvent.ACTION_HOVER_ENTER || a == MotionEvent.ACTION_HOVER_MOVE) notedExcludeEdges(notedStylusY(e))
      else if (a == MotionEvent.ACTION_HOVER_EXIT) notedReleaseEdges()
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

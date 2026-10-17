// Expo config plugin: stylus input for the WebView editor (drawing blocks), in MainActivity.
// - Unbuffered pen events: Android batches touch events to one per frame (~60 Hz) unless the
//   window asks otherwise; Chrome does, a WebView does not. With it the page gets ~480 Hz.
// - S Pen side button: Chromium turns a touch with the button held into a context click, so the
//   page never sees the stroke. A contact that starts with the button held is passed on as the
//   eraser end of a pen (TOOL_TYPE_ERASER), which the page sees as `buttons & 32`; the button
//   bit is cleared from every stylus event.
const { withMainActivity } = require('expo/config-plugins');

const MARKER = 'Noted stylus input (plugins/with-stylus.js)';

const METHODS = `
  // ${MARKER}: unbuffered pen events and the side button
  // held at the start of a contact = eraser.
  private var notedPenEraser = false

  private fun notedHasStylus(e: MotionEvent): Boolean {
    for (i in 0 until e.pointerCount) if (e.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) return true
    return false
  }

  override fun dispatchTouchEvent(e: MotionEvent): Boolean {
    if (!notedHasStylus(e)) return super.dispatchTouchEvent(e)
    val action = e.actionMasked
    val actionTool = e.getToolType(e.actionIndex)
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
    if ((a == MotionEvent.ACTION_BUTTON_PRESS || a == MotionEvent.ACTION_BUTTON_RELEASE) && notedHasStylus(e)) return true
    return super.dispatchGenericMotionEvent(e)
  }
`;

module.exports = (config) => withMainActivity(config, (cfg) => {
  let src = cfg.modResults.contents;
  if (cfg.modResults.language !== 'kt') throw new Error('with-stylus: MainActivity must be Kotlin');
  if (!src.includes(MARKER)) {
    if (!src.includes('import android.view.MotionEvent')) src = src.replace(/^(package [^\n]+\n)/, '$1\nimport android.view.MotionEvent\n');
    if (!src.includes('import android.os.Build')) src = src.replace(/^(package [^\n]+\n)/, '$1\nimport android.os.Build\n');
    const anchor = src.indexOf('  override fun getMainComponentName()');
    if (anchor < 0) throw new Error('with-stylus: getMainComponentName not found in MainActivity');
    src = `${src.slice(0, anchor)}${METHODS.trimStart()}\n${src.slice(anchor)}`;
  }
  cfg.modResults.contents = src;
  return cfg;
});

import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, Dimensions } from 'react-native';
import WebView from 'react-native-webview';
import { mdiClose } from '@mdi/js';
import { T, Icon, themed } from './ui';
import { PDF_HTML } from './pdfHtml.generated';

// "/pdf": the note on A4 sheets in the lower part of the note (like a split view), and the page
// that makes every PDF of the phone (editor/pdf.ts). Its WebView has no text zoom: the editor's
// follows the system font size, which scales the type but not the spacing, and its pages broke
// elsewhere than the computer's. Mounted once needed; closed it stays, hidden, for exports.

// Notes whose preview is open: it belongs to the note (its tab), and comes back with it after
// another tab was shown (the editor is made again then).
export const pdfOpenNotes = new Set<string>();

export interface PdfPaneHandle {
  // The note's flow from the editor page ({type:'pdfFlow'}): shown, and printed when it asks.
  flow(msg: { html: string; pictures?: Record<string, string>; title?: string; save?: boolean }): void;
}

const MIN_SHARE = 0.25;
const MAX_SHARE = 0.7;

export const PdfPane = forwardRef<PdfPaneHandle, {
  open: boolean;
  // Height the keyboard takes (0 = none): typing keeps most of the room for the note.
  keyboard: number;
  onClose: () => void;
  // The page is (again) ready: it holds no pictures yet.
  onReady: () => void;
  // The page made the PDF of the sheets (asked by a flow with `save`, or by Save PDF).
  onPdf: (html: string, fromButton: boolean) => void;
}>(function PdfPane({ open, keyboard, onClose, onReady, onPdf }, ref) {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const buttonRef = useRef(false);
  const [pages, setPages] = useState(0);
  const [share, setShare] = useState(0.45);
  const shareRef = useRef(share);
  shareRef.current = share;

  const send = (msg: Record<string, unknown>) => {
    const literal = JSON.stringify(JSON.stringify(msg));
    const script = `window.__noted && window.__noted.receive(${literal}); true;`;
    if (readyRef.current) webViewRef.current?.injectJavaScript(script);
    else queueRef.current.push(script);
  };
  useImperativeHandle(ref, () => ({
    flow: (msg) => {
      buttonRef.current = false;
      send({ type: 'flow', ...msg });
    },
  }));

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    let msg: any;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      readyRef.current = true;
      for (const script of queueRef.current.splice(0)) webViewRef.current?.injectJavaScript(script);
      onReady();
    } else if (msg.type === 'pages') {
      setPages(msg.count);
    } else if (msg.type === 'pdf' && typeof msg.html === 'string') {
      onPdf(msg.html, buttonRef.current);
      buttonRef.current = false;
    } else if (msg.type === 'log') {
      console.warn('[pdf]', msg.message);
    }
  };

  // Dragging the grip: the pane's share of the screen follows the finger.
  const grip = useMemo(() => {
    let start = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { start = shareRef.current; },
      onPanResponderMove: (_e, g) => {
        const height = Dimensions.get('window').height;
        setShare(Math.min(MAX_SHARE, Math.max(MIN_SHARE, start - g.dy / height)));
      },
    });
  }, []);

  const room = Dimensions.get('window').height - keyboard;
  const height = Math.round(keyboard > 0 ? Math.min(room * share, room * 0.3) : room * share);
  return (
    <View style={open ? [styles.pane, { height }] : styles.hidden} pointerEvents={open ? 'auto' : 'none'}>
      {open ? (
        <>
          <View {...grip.panHandlers} style={styles.grip}><View style={styles.gripBar} /></View>
          <View style={styles.head}>
            <Text style={styles.info} numberOfLines={1}>PDF preview{pages ? ` · ${pages} ${pages === 1 ? 'page' : 'pages'}` : ''}</Text>
            <TouchableOpacity style={styles.save} disabled={!pages} onPress={() => { buttonRef.current = true; send({ type: 'save' }); }}>
              <Text style={styles.saveText}>Save PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.close} onPress={onClose} accessibilityLabel="Close the preview">
              <Icon path={mdiClose} size={20} />
            </TouchableOpacity>
          </View>
        </>
      ) : null}
      {/* @ts-expect-error - React 19 type clash with react-native-webview */}
      <WebView
        ref={webViewRef}
        source={{ html: PDF_HTML }}
        originWhitelist={['*']}
        onMessage={handleMessage}
        textZoom={100}
        style={styles.web}
      />
    </View>
  );
});

const styles = themed(() => StyleSheet.create({
  pane: { backgroundColor: T.surface_container_low, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.outline_variant },
  // Closed: still laid out (a PDF from the note menu is made here), never seen.
  hidden: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, opacity: 0 },
  grip: { height: 22, alignItems: 'center', justifyContent: 'center' },
  gripBar: { width: 44, height: 4, borderRadius: 2, backgroundColor: T.on_surface_variant, opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 6, gap: 6 },
  info: { flex: 1, color: T.on_surface_variant, fontSize: 13 },
  save: { backgroundColor: T.primary, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  saveText: { color: T.on_primary, fontWeight: 'bold', fontSize: 13 },
  close: { borderRadius: 16, padding: 6, backgroundColor: T.surface_container_high },
  web: { flex: 1, backgroundColor: 'transparent' },
}));

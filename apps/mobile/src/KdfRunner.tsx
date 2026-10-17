import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import WebView from 'react-native-webview';
import { base64ToBytes } from '@noted/crypto';
import { KDF_HTML } from './kdfHtml.generated';

// Derives the master key in a hidden WebView (see editor/kdf.ts for why).

const KDF_TIMEOUT_MS = 120000;

export interface KdfHandle {
  derive(passphrase: string, saltB64: string): Promise<Uint8Array>;
}

interface Pending {
  resolve: (key: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const KdfRunner = forwardRef<KdfHandle>(function KdfRunner(_props, ref) {
  const webViewRef = useRef<WebView>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  const nextIdRef = useRef(1);
  const readyRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!readyRef.current) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    readyRef.current = { promise, resolve };
  }

  useImperativeHandle(ref, () => ({
    derive: async (passphrase: string, saltB64: string) => {
      await readyRef.current!.promise;
      const id = nextIdRef.current++;
      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRef.current.delete(id);
          reject(new Error('Key derivation timed out.'));
        }, KDF_TIMEOUT_MS);
        pendingRef.current.set(id, { resolve, reject, timer });
        const literal = JSON.stringify(JSON.stringify({ id, passphrase, salt: saltB64 }));
        webViewRef.current?.injectJavaScript(`window.__kdf.derive(${literal}); true;`);
      });
    },
  }));

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        readyRef.current!.resolve();
        return;
      }
      const entry = pendingRef.current.get(msg.id);
      if (!entry) return;
      pendingRef.current.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.type === 'key') entry.resolve(base64ToBytes(msg.key));
      else entry.reject(new Error(msg.message || 'Key derivation failed.'));
    } catch (e) {
      console.error('Bad KDF message:', e);
    }
  };

  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
      {/* @ts-expect-error - React 19 type clash with react-native-webview */}
      <WebView
        ref={webViewRef}
        source={{ html: KDF_HTML }}
        originWhitelist={['*']}
        onMessage={handleMessage}
      />
    </View>
  );
});

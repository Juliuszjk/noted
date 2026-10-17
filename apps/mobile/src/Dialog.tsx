import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { mdiAlertCircleOutline, mdiDeleteOutline, mdiInformationOutline } from '@mdi/js';
import { T, Icon } from './ui';

// The app's own dialogs in the theme's colours, used instead of `Alert.alert` (Android's
// AlertDialog is a grey box that ignores the app's theme). `appAlert` takes the same arguments;
// `<DialogHost />` (mounted once in App) draws the open dialogs, the newest on top.

export interface AppAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface OpenDialog {
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

let dialogs: OpenDialog[] = [];
let nextId = 1;
const listeners = new Set<(list: OpenDialog[]) => void>();
const shownListeners = new Set<() => void>();
const publish = () => listeners.forEach((l) => l(dialogs));

export const appAlert = (title: string, message?: string, buttons?: AppAlertButton[]): void => {
  dialogs = [...dialogs, { id: nextId++, title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] }];
  publish();
  shownListeners.forEach((l) => l());
};

// Called when a dialog opens: a modal takes the window focus, so the keyboard's hide event
// does not reach the editor (EditorScreen resets its keyboard room itself).
export const onDialogShown = (listener: () => void): (() => void) => {
  shownListeners.add(listener);
  return () => { shownListeners.delete(listener); };
};

const close = (dialog: OpenDialog, button?: AppAlertButton) => {
  dialogs = dialogs.filter((d) => d.id !== dialog.id);
  publish();
  button?.onPress?.();
};

// Back and a tap outside act like the cancel button (or just close when there is none and
// the dialog only informs).
const dismiss = (dialog: OpenDialog) => {
  const cancel = dialog.buttons.find((b) => b.style === 'cancel');
  if (cancel || dialog.buttons.length === 1) close(dialog, cancel ?? dialog.buttons[0]);
};

function DialogBox({ dialog }: { dialog: OpenDialog }) {
  const danger = dialog.buttons.some((b) => b.style === 'destructive');
  const info = dialog.buttons.length === 1 && !dialog.buttons[0].onPress;
  const icon = danger ? mdiDeleteOutline : info ? mdiInformationOutline : mdiAlertCircleOutline;
  const last = dialog.buttons.length - 1;
  return (
    <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => dismiss(dialog)}>
      <Pressable style={styles.backdrop} onPress={() => dismiss(dialog)}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.head}>
            <View style={styles.iconWrap}>
              <Icon path={icon} size={22} color={danger ? T.error : T.primary} />
            </View>
            <Text style={styles.title}>{dialog.title}</Text>
          </View>
          {!!dialog.message && <Text style={styles.message}>{dialog.message}</Text>}
          <View style={styles.buttons}>
            {dialog.buttons.map((b, i) => {
              const kind = b.style === 'destructive' ? 'danger' : b.style === 'cancel' || i !== last ? 'plain' : 'primary';
              return (
                <TouchableOpacity
                  key={`${i}-${b.text}`}
                  onPress={() => close(dialog, b)}
                  style={[styles.button, kind === 'plain' ? styles.buttonPlain : { backgroundColor: kind === 'danger' ? T.error : T.primary }]}
                >
                  <Text style={[styles.buttonText, { color: kind === 'plain' ? T.on_surface : kind === 'danger' ? T.background : T.on_primary }]}>{b.text}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function DialogHost() {
  const [list, setList] = useState<OpenDialog[]>(dialogs);
  useEffect(() => {
    listeners.add(setList);
    setList(dialogs);
    return () => { listeners.delete(setList); };
  }, []);
  return <>{list.map((d) => <DialogBox key={d.id} dialog={d} />)}</>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: T.surface_container_high, borderRadius: 28, padding: 24, paddingBottom: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: T.outline_variant },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconWrap: { padding: 8, borderRadius: 999, backgroundColor: T.surface_container_highest },
  title: { flex: 1, color: T.on_surface, fontSize: 20, fontWeight: '700' },
  message: { color: T.on_surface_variant, fontSize: 15, lineHeight: 22, marginTop: 14 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 22 },
  button: { minWidth: 88, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center' },
  buttonPlain: { borderWidth: 1, borderColor: T.outline_variant },
  buttonText: { fontSize: 15, fontWeight: '600' },
});

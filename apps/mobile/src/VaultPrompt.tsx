import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { mdiLockOutline } from '@mdi/js';
import { T, Icon, PasswordField } from './ui';

// Vault password: open the vault (unlock) or choose its password (create). `onSubmit` resolves
// to an error message, or null when it worked.
export function VaultPrompt({ mode, onSubmit, onClose }: {
  mode: 'create' | 'unlock';
  onSubmit: (password: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    if (mode === 'create') {
      if (password.length < 6) return setError('Use at least 6 characters.');
      if (password !== repeat) return setError('The passwords do not match.');
    }
    setBusy(true);
    try {
      setError(await onSubmit(password));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon path={mdiLockOutline} size={22} color={T.primary} />
          <Text style={styles.title}>{mode === 'create' ? 'Create the vault' : 'Open the vault'}</Text>
        </View>
        <Text style={styles.text}>
          {mode === 'create'
            ? 'Locked notes are encrypted once more with this password. It is separate from your passphrase and cannot be recovered.'
            : 'Enter the vault password to open locked notes.'}
        </Text>
        <PasswordField value={password} onChangeText={setPassword} placeholder="Vault password" style={styles.input} />
        {mode === 'create' ? <PasswordField value={repeat} onChangeText={setRepeat} placeholder="Repeat the password" style={styles.input} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
          <TouchableOpacity onPress={onClose} style={styles.button}><Text style={styles.buttonText}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity onPress={submit} disabled={busy} style={[styles.button, styles.primary]}>
            {busy ? <ActivityIndicator color={T.on_primary} /> : <Text style={[styles.buttonText, { color: T.on_primary }]}>{mode === 'create' ? 'Create' : 'Open'}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { position: 'absolute', left: 20, right: 20, top: '25%', padding: 20, borderRadius: 18, backgroundColor: T.surface_container_high },
  title: { color: T.on_surface, fontSize: 19, fontWeight: 'bold' },
  text: { color: T.on_surface_variant, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  input: { backgroundColor: T.surface_container, color: T.on_surface, padding: 12, borderRadius: 10, fontSize: 16, marginBottom: 10 },
  error: { color: T.error, fontSize: 13, marginBottom: 10 },
  button: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 20, borderWidth: 1, borderColor: T.outline_variant, minWidth: 80, alignItems: 'center' },
  primary: { backgroundColor: T.primary, borderColor: T.primary },
  buttonText: { color: T.on_surface, fontSize: 15, fontWeight: '600' },
});

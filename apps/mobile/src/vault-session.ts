// The vault key of locked notes, in memory only: until the app locks (App lock), the user
// locks the vault in Settings, or the app is closed.
let vaultKey: Uint8Array | null = null;
const listeners = new Set<() => void>();

export const getVaultKey = () => vaultKey;
export const setVaultKey = (key: Uint8Array | null) => {
  vaultKey = key;
  listeners.forEach((l) => l());
};
export const onVaultKeyChange = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

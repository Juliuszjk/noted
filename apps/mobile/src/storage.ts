import * as SecureStore from 'expo-secure-store';
import { bytesToBase64, base64ToBytes } from '@noted/crypto';
import { KEY_STORAGE } from '@noted/config';

export const saveMasterKey = async (key: Uint8Array): Promise<void> => {
  await SecureStore.setItemAsync(KEY_STORAGE, bytesToBase64(key));
};

export const getMasterKey = async (): Promise<Uint8Array | null> => {
  const stored = await SecureStore.getItemAsync(KEY_STORAGE);
  return stored ? base64ToBytes(stored) : null;
};

export const clearMasterKey = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(KEY_STORAGE);
};

// Auth token epoch of this device (Settings > Log out from all other devices moves it on).
const EPOCH_KEY = 'noted_auth_epoch';
export const getAuthEpochStored = async (): Promise<number> => Number(await SecureStore.getItemAsync(EPOCH_KEY)) || 0;
export const saveAuthEpoch = async (epoch: number): Promise<void> => { await SecureStore.setItemAsync(EPOCH_KEY, String(epoch)); };

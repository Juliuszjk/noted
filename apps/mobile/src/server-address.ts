import * as SecureStore from 'expo-secure-store';
import { SERVER_STORAGE, configureServerStorage } from '@noted/config';
import { configureLocalVault } from '@noted/sync';

// The server this phone talks to (chosen on the unlock screen), kept in SecureStore. Imported
// first by index.ts: the headless tasks (notification buttons, widget, background sync) sync too.
configureServerStorage(() => SecureStore.getItem(SERVER_STORAGE), (text) => SecureStore.setItem(SERVER_STORAGE, text));
// Without a server the vault's data (salt, verifier, envelopes) lives here instead.
configureLocalVault({ load: () => SecureStore.getItem('noted_local_vault'), save: (text) => SecureStore.setItem('noted_local_vault', text) });

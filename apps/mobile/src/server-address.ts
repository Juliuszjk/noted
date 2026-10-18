import * as SecureStore from 'expo-secure-store';
import { SERVER_STORAGE, configureServerStorage } from '@noted/config';

// The server this phone talks to (chosen on the unlock screen), kept in SecureStore. Imported
// first by index.ts: the headless tasks (notification buttons, widget, background sync) sync too.
configureServerStorage(() => SecureStore.getItem(SERVER_STORAGE), (text) => SecureStore.setItem(SERVER_STORAGE, text));

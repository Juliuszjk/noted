import './src/polyfill';
// The server address before anything can sync.
import './src/server-address';
import { registerRootComponent } from 'expo';
// Defines the background task of notification buttons (runs headless with the app closed).
import './src/reminder-notifications';
// Draws the home screen widget when Android asks (also headless).
import './src/reminder-widget-task';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

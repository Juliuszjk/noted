import { Dimensions } from 'react-native';

// The keyboard's last height (EditorScreen sees it; modals do not get keyboard events, so a
// field in a modal lifts its sheet by this much).
let height = 0;
export const rememberKeyboardHeight = (value: number) => { if (value > 100) height = value; };
export const keyboardHeight = (): number => height || Math.round(Dimensions.get('window').height * 0.42);

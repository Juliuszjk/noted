import { createRoot } from 'react-dom/client';
import { resolveTheme, themeToCssVars } from '@noted/theme';
import { LiveApp } from './LiveApp';
import './live.css';

// Entry of the live note page (scripts/build-live.mjs bundles it for the public server).
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  for (const [name, value] of Object.entries(themeToCssVars(resolveTheme('auto', null, dark.matches)))) {
    document.documentElement.style.setProperty(name, value);
  }
};
applyTheme();
dark.addEventListener('change', applyTheme);

createRoot(document.getElementById('app')!).render(<LiveApp />);

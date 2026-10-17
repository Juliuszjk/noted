// The plain part of Settings > Editor (no Tiptap: React Native uses it too).
export { formatTitleTemplate } from './title-template';
import { CODE_THEMES, codeThemeVars } from './code-themes';
import { DEFAULT_REMINDER_TIMES, parseClock } from './reminder-time';

export type DefaultFont = 'sans' | 'serif' | 'mono';

export interface EditorPrefs {
  // Title given to a note left without one once it has text; "" = off. Tokens: $date$, $time$.
  titleTemplate: string;
  // Font of notes that have no font of their own.
  defaultFont: DefaultFont;
  // Base text size of notes, px.
  fontSize: number;
  // Typing -> becomes →, != becomes ≠, ...
  ligatures: boolean;
  spellcheck: boolean;
  // Dictionaries of the spell checker (desktop), e.g. ["pl_PL", "en_US"].
  spellLanguages: string[];
  // Code block colours: a theme id (code-themes.ts), and other themes for some languages.
  codeTheme: string;
  codeThemeByLanguage: Record<string, string>;
  // "Morning" and "evening" of the reminder picker's quick choices, "HH:MM".
  reminderMorning: string;
  reminderEvening: string;
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  titleTemplate: '',
  defaultFont: 'sans',
  fontSize: 16,
  ligatures: true,
  spellcheck: true,
  spellLanguages: [],
  codeTheme: 'app',
  codeThemeByLanguage: {},
  reminderMorning: DEFAULT_REMINDER_TIMES.morning,
  reminderEvening: DEFAULT_REMINDER_TIMES.evening,
};
const clockOr = (value: unknown, fallback: string): string => {
  const clock = typeof value === 'string' ? parseClock(value) : null;
  return clock ? `${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}` : fallback;
};
const isTheme = (id: unknown): id is string => typeof id === 'string' && CODE_THEMES.some((t) => t.id === id);

export const parseEditorPrefs = (text: string | null): EditorPrefs => {
  try {
    const d = JSON.parse(text ?? '{}');
    return {
      titleTemplate: typeof d.titleTemplate === 'string' ? d.titleTemplate.slice(0, 120) : DEFAULT_EDITOR_PREFS.titleTemplate,
      defaultFont: d.defaultFont === 'serif' || d.defaultFont === 'mono' ? d.defaultFont : 'sans',
      fontSize: typeof d.fontSize === 'number' && d.fontSize >= 10 && d.fontSize <= 32 ? d.fontSize : DEFAULT_EDITOR_PREFS.fontSize,
      ligatures: d.ligatures !== false,
      spellcheck: d.spellcheck !== false,
      spellLanguages: Array.isArray(d.spellLanguages) ? d.spellLanguages.filter((l: unknown) => typeof l === 'string').slice(0, 8) : [],
      codeTheme: isTheme(d.codeTheme) ? d.codeTheme : 'app',
      codeThemeByLanguage: Object.fromEntries(Object.entries(d.codeThemeByLanguage && typeof d.codeThemeByLanguage === 'object' ? d.codeThemeByLanguage : {})
        .filter((e): e is [string, string] => typeof e[0] === 'string' && isTheme(e[1])).slice(0, 40)),
      reminderMorning: clockOr(d.reminderMorning, DEFAULT_EDITOR_PREFS.reminderMorning),
      reminderEvening: clockOr(d.reminderEvening, DEFAULT_EDITOR_PREFS.reminderEvening),
    };
  } catch {
    return { ...DEFAULT_EDITOR_PREFS };
  }
};

// CSS variables read by content.css (and the editor pages): the base size and the default
// font of notes without their own font.
// The code theme's colours too (an empty value = back to content.css's defaults).
export const editorPrefsCssVars = (prefs: EditorPrefs): Record<string, string> => {
  const code = codeThemeVars(prefs.codeTheme);
  const keys = Object.keys(codeThemeVars('github-dark') ?? {});
  return {
    '--editor-font-size': `${prefs.fontSize}px`,
    '--editor-font': `var(--font-${prefs.defaultFont})`,
    ...Object.fromEntries(keys.map((k) => [k, code?.[k] ?? ''])),
  };
};


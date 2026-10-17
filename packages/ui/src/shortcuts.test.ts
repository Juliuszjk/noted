import { describe, expect, it, afterEach } from 'vitest';
import { comboOf, matchesShortcut, setShortcutOverrides, shortcutConflict, shortcutKeys, shortcutMatches, SHORTCUT_ACTIONS } from './shortcuts';

const key = (code: string, key: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

afterEach(() => setShortcutOverrides({}));

describe('shortcuts', () => {
  it('builds combos from physical keys', () => {
    expect(comboOf(key('KeyK', 'k', { ctrlKey: true }))).toBe('Ctrl+K');
    expect(comboOf(key('BracketLeft', '{', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+[');
    expect(comboOf(key('Digit8', '*', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+8');
    expect(comboOf(key('Tab', 'Tab', { ctrlKey: true }))).toBe('Ctrl+Tab');
    expect(comboOf(key('ArrowLeft', 'ArrowLeft', { altKey: true }))).toBe('Alt+ArrowLeft');
    expect(comboOf(key('ControlLeft', 'Control', { ctrlKey: true }))).toBeNull();
  });

  it('matches defaults and the user’s keys', () => {
    expect(matchesShortcut(key('BracketRight', ']', { ctrlKey: true }), 'nextTab')).toBe(true);
    setShortcutOverrides({ nextTab: ['Alt+L'] });
    expect(matchesShortcut(key('BracketRight', ']', { ctrlKey: true }), 'nextTab')).toBe(false);
    expect(matchesShortcut(key('KeyL', 'l', { altKey: true }), 'nextTab')).toBe(true);
    expect(shortcutKeys('nextTab')).toEqual(['Alt+L']);
  });

  it('finds clashes', () => {
    expect(shortcutConflict('Ctrl+N', 'gotoNote')?.id).toBe('newNote');
    expect(shortcutConflict('Ctrl+Alt+Q', 'gotoNote')).toBeNull();
  });

  it('has no clashes among the defaults', () => {
    const seen = new Map<string, string>();
    for (const a of SHORTCUT_ACTIONS) for (const k of a.defaults) {
      expect(seen.get(k), `${k}: ${a.id} and ${seen.get(k)}`).toBeUndefined();
      seen.set(k, a.id);
    }
  });

  it('finds actions by name, group and keys', () => {
    expect(shortcutMatches('remind', ['Add / edit reminder', 'Note', 'Ctrl+Alt+R'])).toBe(true);
    expect(shortcutMatches('ctrl+alt+r', ['Add / edit reminder', 'Note', 'Ctrl+Alt+R'])).toBe(true);
    expect(shortcutMatches('note link', ['Insert / edit link', 'Note', 'Ctrl+K'])).toBe(true);
    expect(shortcutMatches('bold', ['Insert / edit link', 'Note', 'Ctrl+K'])).toBe(false);
    expect(matchesShortcut(key('KeyR', 'r', { ctrlKey: true, altKey: true }), 'reminder')).toBe(true);
  });
});

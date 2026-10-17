import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME, parseTheme, themeToCss, themeToCssVars } from './index';

describe('theme', () => {
  it('reads matugen roles and keeps defaults for missing or bad ones', () => {
    const theme = parseTheme(JSON.stringify({ primary: '#112233', on_surface: 'red', background: '#abcdef80' }));
    expect(theme.primary).toBe('#112233');
    expect(theme.on_surface).toBe(DEFAULT_THEME.on_surface);
    expect(theme.background).toBe('#abcdef80');
    expect(parseTheme('not json')).toEqual(DEFAULT_THEME);
    expect(parseTheme(JSON.stringify({ colors: { primary: '#000000' } })).primary).toBe('#000000');
  });
  it('maps roles to the CSS variables the app uses', () => {
    const vars = themeToCssVars(DEFAULT_THEME);
    expect(vars['--primary']).toBe(DEFAULT_THEME.primary);
    expect(vars['--bg-base']).toBe(DEFAULT_THEME.background);
    expect(themeToCss(DEFAULT_THEME)).toContain(`--text-main: ${DEFAULT_THEME.on_surface};`);
  });
});

describe('theme modes', () => {
  it('picks the scheme for a mode from the matugen file or the built-in ones', async () => {
    const { resolveTheme, DEFAULT_THEME, LIGHT_THEME } = await import('./index');
    expect(resolveTheme('light', null, true)).toEqual(LIGHT_THEME);
    expect(resolveTheme('auto', null, true)).toEqual(DEFAULT_THEME);
    expect(resolveTheme('auto', null, false)).toEqual(LIGHT_THEME);
    const file = JSON.stringify({ background: '#111111', light: { background: '#eeeeee' }, dark: { background: '#222222' } });
    expect(resolveTheme('auto', file, false).background).toBe('#111111');
    expect(resolveTheme('light', file, true).background).toBe('#eeeeee');
    expect(resolveTheme('dark', file, false).background).toBe('#222222');
    // An old file (one scheme only): light / dark fall back to the built-in schemes.
    expect(resolveTheme('light', JSON.stringify({ background: '#111111' }), true)).toEqual(LIGHT_THEME);
    expect(resolveTheme('nord', file, true).background).toBe('#2e3440');
  });
});

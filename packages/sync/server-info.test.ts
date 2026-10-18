import { describe, it, expect } from 'vitest';
import { normalizeServerUrl, configureServerStorage, setServerAddress, apiUrl, publicUrl, wsUrl } from '@noted/config';

describe('normalizeServerUrl', () => {
  it('adds http for IP addresses and localhost, https for host names', () => {
    expect(normalizeServerUrl('100.64.0.1:3333')).toBe('http://100.64.0.1:3333');
    expect(normalizeServerUrl('localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeServerUrl(' notes.example.com ')).toBe('https://notes.example.com');
    expect(normalizeServerUrl('notes.example.com/noted/')).toBe('https://notes.example.com/noted');
  });
  it('keeps a given scheme and refuses junk', () => {
    expect(normalizeServerUrl('http://notes.example.com')).toBe('http://notes.example.com');
    expect(normalizeServerUrl('HTTPS://Notes.example.com:8443')).toBe('https://notes.example.com:8443');
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('https://a.com/?x=1')).toBeNull();
    expect(normalizeServerUrl('http://')).toBeNull();
  });
});

describe('server address storage', () => {
  it('reads the stored address and stores changes', () => {
    let stored: string | null = JSON.stringify({ api: 'https://a.example', public: 'https://p.example' });
    configureServerStorage(() => stored, (text) => { stored = text; });
    expect(apiUrl()).toBe('https://a.example');
    expect(wsUrl()).toBe('wss://a.example/ws');
    setServerAddress({ api: 'http://10.0.0.1:3333', public: '' });
    expect(JSON.parse(stored!)).toEqual({ api: 'http://10.0.0.1:3333', public: '' });
    expect(publicUrl()).toBe('');
  });
});

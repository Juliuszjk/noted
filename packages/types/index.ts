export interface NoteRecord {
  id: string;
  content: string;
  yjs_state: string | null;
  updated_at: number;
}

export interface RemoteNote {
  id: string;
  encrypted_html: string;
  encrypted_yjs: string;
  updated_at: number;
}

export type VaultMode =
  | { kind: 'loading' }
  | { kind: 'create' }
  | { kind: 'unlock'; salt: string; verifier: string };

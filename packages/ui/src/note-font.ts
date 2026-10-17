import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { getNoteFont, getNoteSettings } from '@noted/sync';
import type { NoteFont } from '@noted/sync';

// The note's font, kept in sync with the doc (remote changes included).
export const useNoteFont = (ydoc: Y.Doc): NoteFont | null => {
  const [font, setFont] = useState(() => getNoteFont(ydoc));
  useEffect(() => {
    const settings = getNoteSettings(ydoc);
    const update = () => setFont(getNoteFont(ydoc));
    settings.observe(update);
    update();
    return () => settings.unobserve(update);
  }, [ydoc]);
  return font;
};

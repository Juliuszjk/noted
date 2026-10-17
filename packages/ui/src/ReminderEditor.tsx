import { useMemo } from 'react';
import type { Editor } from '@tiptap/core';
import { commitReminderEdit, getReminderTimes } from '@noted/editor';
import type { ReminderEditRequest } from '@noted/editor';
import { ReminderPopover } from './ReminderPopover';

// The picker of a reminder chip: below the chip, or below the cursor for a new reminder.
export function ReminderEditor({ editor, request, onClose }: { editor: Editor; request: ReminderEditRequest; onClose: () => void }) {
  const anchor = useMemo(() => {
    const dom = request.mode === 'edit' ? (editor.view.nodeDOM(request.pos) as HTMLElement | null) : null;
    if (dom?.getBoundingClientRect) return dom.getBoundingClientRect();
    const coords = editor.view.coordsAtPos(Math.min(request.pos, editor.state.doc.content.size));
    return { top: coords.top, bottom: coords.bottom, left: coords.left };
  }, [editor, request]);

  return (
    <ReminderPopover
      anchor={anchor}
      title={request.mode === 'edit' ? 'Reminder' : 'New reminder'}
      initial={request.mode === 'edit' ? request.attrs : undefined}
      times={getReminderTimes(editor)}
      onCommit={(commit) => commitReminderEdit(editor, request, commit)}
      onCancel={() => {
        if (!editor.isDestroyed) editor.commands.focus();
        onClose();
      }}
      onClose={onClose}
    />
  );
}

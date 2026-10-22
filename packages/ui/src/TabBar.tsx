import type React from 'react';
import { mdiArrowLeft, mdiArrowRight, mdiClose, mdiFileDocumentOutline, mdiPlus } from '@mdi/js';
import { Icon } from './Icon';
import { IconBtn } from './menu-parts';
import type { ReactNode } from 'react';

export interface TabInfo {
  id: string;
  title: string;
  // Where the note is (tooltip).
  place?: string;
}

interface Props {
  tabs: TabInfo[];
  activeId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onNewNote: () => void;
  onBack: () => void;
  onForward: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  // Pressing a tab may start dragging it (desktop split view, or to another place among the tabs).
  onDragNote?: (id: string, e: React.MouseEvent) => void;
  // While a note is dragged over the tabs: where it would land (0..tabs.length).
  dropAt?: number | null;
  // Extra controls at the start (column toggles) and on the right (note chips, properties).
  left?: ReactNode;
  right?: ReactNode;
}

// Where a note dragged to (x, y) lands among the tabs, or null when the point is not over
// the tab strip ([data-tab-strip], tabs marked [data-tab-id]).
export const tabDropIndex = (x: number, y: number): number | null => {
  const strip = document.querySelector<HTMLElement>('[data-tab-strip]');
  if (!strip) return null;
  const r = strip.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top - 4 || y > r.bottom + 4) return null;
  const tabs = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]'));
  const index = tabs.findIndex((t) => {
    const b = t.getBoundingClientRect();
    return x < b.left + b.width / 2;
  });
  return index < 0 ? tabs.length : index;
};

// The tab list with `id` put at `index` (an index among the current tabs, before the move);
// a note without a tab gets one there.
export const placeTab = (tabs: string[], id: string, index: number): string[] => {
  const from = tabs.indexOf(id);
  const rest = tabs.filter((t) => t !== id);
  const at = from >= 0 && from < index ? index - 1 : index;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
};

// Browser-like tabs above the editor: new note, history arrows, one tab per open note.
export function TabBar({ tabs, activeId, canGoBack, canGoForward, onNewNote, onBack, onForward, onSelect, onClose, onDragNote, dropAt, left, right }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 40, padding: '0 8px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-low)' }}>
      {left}
      <IconBtn
        icon={mdiPlus}
        title="New note (Ctrl+N)"
        onClick={onNewNote}
        style={{ borderRadius: 15, backgroundColor: 'var(--text-main)', color: 'var(--bg-base)' }}
      />
      <IconBtn icon={mdiArrowLeft} title="Back (Alt+Left)" onClick={onBack} disabled={!canGoBack} />
      <IconBtn icon={mdiArrowRight} title="Forward (Alt+Right)" onClick={onForward} disabled={!canGoForward} />
      <div data-tab-strip style={{ display: 'flex', alignItems: 'stretch', alignSelf: 'stretch', flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          // The drop place: a line on the left of the tab after it (or right of the last one).
          const marks = [
            active ? 'inset 0 -2px 0 var(--primary)' : '',
            dropAt === i ? 'inset 3px 0 0 var(--primary)' : '',
            dropAt === tabs.length && i === tabs.length - 1 ? 'inset -3px 0 0 var(--primary)' : '',
          ].filter(Boolean);
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              title={tab.place ? `${tab.title}\n${tab.place}` : tab.title}
              // Selected on click: pressing and moving drags the tab (split view) instead.
              onMouseDown={(e) => { if (e.button === 0) onDragNote?.(tab.id, e); }}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, maxWidth: 200, minWidth: 90, padding: '0 6px 0 10px',
                cursor: 'pointer', fontSize: 13, borderRight: '1px solid var(--border)',
                color: active ? 'var(--primary)' : 'var(--text-muted)',
                backgroundColor: active ? 'var(--bg-base)' : 'transparent',
                boxShadow: marks.length ? marks.join(', ') : 'none',
              }}
            >
              <Icon path={mdiFileDocumentOutline} size={14} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title}</span>
              <button
                type="button"
                title="Close tab (Ctrl+W)"
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onClose(tab.id); }}
                style={{ display: 'flex', border: 'none', background: 'transparent', color: 'inherit', padding: 2, borderRadius: 4, cursor: 'pointer', opacity: active ? 1 : 0.7 }}
              >
                <Icon path={mdiClose} size={14} />
              </button>
            </div>
          );
        })}
        {tabs.length === 0 && dropAt != null && <div style={{ width: 3, backgroundColor: 'var(--primary)' }} />}
      </div>
      {right}
    </div>
  );
}

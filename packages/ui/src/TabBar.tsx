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
  // Pressing a tab may start dragging it (desktop split view).
  onDragNote?: (id: string, e: React.MouseEvent) => void;
  // Extra controls at the start (column toggles) and on the right (note chips, properties).
  left?: ReactNode;
  right?: ReactNode;
}

// Browser-like tabs above the editor: new note, history arrows, one tab per open note.
export function TabBar({ tabs, activeId, canGoBack, canGoForward, onNewNote, onBack, onForward, onSelect, onClose, onDragNote, left, right }: Props) {
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
      <div style={{ display: 'flex', alignItems: 'stretch', alignSelf: 'stretch', flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
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
                boxShadow: active ? 'inset 0 -2px 0 var(--primary)' : 'none',
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
      </div>
      {right}
    </div>
  );
}

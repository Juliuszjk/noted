import type { NoteSummary } from './NoteEditor';

// "Linked from": notes whose body links to this note (from their metadata, built locally).
export function Backlinks({ noteId, notes, onOpenNote }: { noteId: string; notes: NoteSummary[]; onOpenNote?: (id: string) => void }) {
  const sources = notes
    .filter((n) => n.id !== noteId && n.links.includes(noteId))
    .sort((a, b) => a.title.localeCompare(b.title));
  if (sources.length === 0) return null;

  return (
    <div className="backlinks" style={{ marginTop: 48, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
        Linked from {sources.length}
      </div>
      {sources.map((n) => (
        <div
          key={n.id}
          onClick={() => onOpenNote?.(n.id)}
          style={{ padding: '4px 6px', margin: '0 -6px', borderRadius: 6, cursor: 'pointer', fontSize: 14, color: 'var(--primary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          ↗ {n.title}
          {n.place && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{n.place}</span>}
        </div>
      ))}
    </div>
  );
}

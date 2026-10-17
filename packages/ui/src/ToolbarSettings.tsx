import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { mdiPlus, mdiDotsVertical, mdiChevronDown, mdiTableEdit, mdiTableCog } from '@mdi/js';
import {
  toolbarGroups, toolbarItem, CELL_TOOLBAR_ITEMS, unusedToolbarItems, toolbarMove, toolbarRemoveAt, toolbarInsertAt, pruneToolbar, toolbarGroupParts,
} from '@noted/editor';
import type { ToolbarConfig, ToolbarGroup, ToolbarPlatform, ToolbarPreset, ToolbarSlot } from '@noted/editor';
import { Icon } from './Icon';
import { dropIndex, inBox } from './drop-index';
import type { Box } from './drop-index';

// Settings > Toolbar (like Notesnook's "Customize toolbar"): the toolbar drawn as above a note
// and edited in place. Drag a button to another place, into the row a ⋮ button opens, or down
// to "Not in the toolbar" (and back). Every edit turns the toolbar into "Custom".

const PRESETS: [ToolbarPreset, string][] = [['default', 'Default'], ['minimal', 'Minimal'], ['custom', 'Custom']];

type Place = { zone: string; index: number };

const zoneSlot = (zone: string): Omit<ToolbarSlot, 'index'> | null => {
  const [kind, g, s] = zone.split(':');
  if (kind === 'g') return { group: Number(g), sub: null };
  if (kind === 's') return { group: Number(g), sub: Number(s) };
  return null;
};

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

// One button as the top toolbar shows it.
function ButtonPicture({ id, platform }: { id: string; platform: ToolbarPlatform }) {
  const item = toolbarItem(id);
  const text = id === 'headings' ? 'Paragraph' : id === 'fontSize' ? '16' : id === 'font' ? 'Font'
    : platform === 'desktopTable' && id === 'rowProps' ? 'Row' : platform === 'desktopTable' && id === 'columnProps' ? 'Column' : null;
  const base: CSSProperties = { display: 'flex', alignItems: 'center', gap: 2, height: 30, minWidth: 30, padding: text ? '0 8px' : 0, justifyContent: 'center', borderRadius: 6, fontSize: 13, color: 'var(--text-main)' };
  return (
    <span title={item?.label ?? id} style={base}>
      {text && item && platform === 'desktopTable' && <Icon path={item.icon} size={16} />}
      {text ?? (item ? <Icon path={item.icon} size={18} /> : id)}
      {text && <Icon path={mdiChevronDown} size={14} />}
    </span>
  );
}

const Sep = () => <span style={{ width: 1, height: 18, margin: '0 4px', backgroundColor: 'var(--border)', alignSelf: 'center' }} />;

const emptyBox = (text: string) => (
  <span style={{ display: 'flex', alignItems: 'center', height: 30, padding: '0 10px', borderRadius: 6, border: '1px dashed var(--border-focus)', fontSize: 12, color: 'var(--text-muted)' }}>{text}</span>
);
const heading: CSSProperties = { margin: '18px 0 6px', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--primary)' };
const button: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontSize: 13 };

export function ToolbarSettings({ platform, config, onChange }: {
  platform: ToolbarPlatform;
  config: ToolbarConfig | null;
  onChange: (config: ToolbarConfig | null) => void;
}) {
  const preset = config?.preset ?? 'default';
  const groups: ToolbarGroup[] = preset === 'custom' ? config!.groups : toolbarGroups(platform, config);
  const unused = unusedToolbarItems(platform, groups);
  const parts = groups.map(toolbarGroupParts);
  // The table menu shows a subgroup as a Cell / Table dropdown, the other toolbars as ⋮.
  const subIcon = (sub: string[]) => (platform !== 'desktopTable' ? mdiDotsVertical : sub.every((id) => CELL_TOOLBAR_ITEMS.has(id)) ? mdiTableEdit : mdiTableCog);
  const save = (next: ToolbarGroup[]) => onChange({ preset: 'custom', groups: next });
  const board = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: Place; id: string; x: number; y: number; target: Place | null } | null>(null);
  const measured = useRef<{ zones: Map<string, Box>; items: Map<string, Box[]> } | null>(null);
  const pending = useRef<{ from: Place; id: string; x: number; y: number } | null>(null);

  const pickPreset = (p: ToolbarPreset) => {
    if (p === 'custom') onChange({ preset: 'custom', groups });
    else onChange(p === 'default' ? null : { preset: p, groups: [] });
  };

  const findTarget = (x: number, y: number): Place | null => {
    const m = measured.current;
    if (!m) return null;
    let best: { zone: string; area: number } | null = null;
    for (const [zone, box] of m.zones) {
      if (!inBox(box, x, y, 4)) continue;
      const area = box.w * box.h;
      if (!best || area < best.area) best = { zone, area };
    }
    return best ? { zone: best.zone, index: dropIndex(m.items.get(best.zone) ?? [], x, y) } : null;
  };
  const measure = () => {
    const root = board.current;
    if (!root) return;
    const zones = new Map<string, Box>();
    root.querySelectorAll<HTMLElement>('[data-drop-zone]').forEach((el) => zones.set(el.dataset.dropZone!, boxOf(el)));
    const items = new Map<string, Box[]>();
    root.querySelectorAll<HTMLElement>('[data-drag-zone]').forEach((el) => {
      const list = items.get(el.dataset.dragZone!) ?? [];
      list[Number(el.dataset.dragIndex)] = boxOf(el);
      items.set(el.dataset.dragZone!, list);
    });
    measured.current = { zones, items };
  };

  const drop = (from: Place, to: Place) => {
    const fromSlot = zoneSlot(from.zone);
    const toSlot = zoneSlot(to.zone);
    if (!fromSlot && !toSlot) return;
    if (!fromSlot) {
      const id = unused[from.index]?.id;
      if (id) save(pruneToolbar(toolbarInsertAt(groups, { ...toSlot!, index: to.index }, id)));
    } else if (!toSlot) {
      save(pruneToolbar(toolbarRemoveAt(groups, { ...fromSlot, index: from.index })));
    } else {
      const next = toolbarMove(groups, { ...fromSlot, index: from.index }, { ...toSlot, index: to.index });
      if (next !== groups) save(pruneToolbar(next));
    }
  };

  // A button starts moving after the mouse moved a few pixels with the button held.
  const onItemDown = (from: Place, id: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pending.current = { from, id, x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      const p = pending.current;
      if (p && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 4) {
        measure();
        pending.current = null;
        setDrag({ from: p.from, id: p.id, x: ev.clientX, y: ev.clientY, target: findTarget(ev.clientX, ev.clientY) });
        return;
      }
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY, target: findTarget(ev.clientX, ev.clientY) } : d));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      pending.current = null;
      setDrag((d) => {
        if (d?.target) setTimeout(() => drop(d.from, d.target!), 0);
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const item = (zone: string, index: number, id: string, picture: ReactNode) => (
    <span
      key={`${zone}-${id}-${index}`}
      data-drag-zone={zone}
      data-drag-index={index}
      onPointerDown={onItemDown({ zone, index }, id)}
      style={{ display: 'flex', cursor: 'grab', borderRadius: 6, opacity: drag?.from.zone === zone && drag.from.index === index ? 0.3 : 1 }}
      onMouseEnter={(e) => { if (!drag) e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {picture}
    </span>
  );

  // Where the button would land.
  let marker: CSSProperties | null = null;
  const m = measured.current;
  if (drag?.target && m && board.current) {
    const origin = board.current.getBoundingClientRect();
    const list = (m.items.get(drag.target.zone) ?? []).filter(Boolean);
    const zone = m.zones.get(drag.target.zone);
    if (list.length === 0 && zone) {
      marker = { left: zone.x - origin.left, top: zone.y - origin.top, width: zone.w, height: zone.h, border: '2px solid var(--primary)', borderRadius: 8 };
    } else if (list.length) {
      const at = list[Math.min(drag.target.index, list.length - 1)];
      const x = drag.target.index < list.length ? at.x - 2 : at.x + at.w + 1;
      marker = { left: x - origin.left, top: at.y - origin.top + 3, width: 2, height: at.h - 6, borderRadius: 1, backgroundColor: 'var(--primary)' };
    }
  }

  return (
    <>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '8px 0 12px' }}>
        Drag a button to another place, into the row a <Icon path={mdiDotsVertical} size={14} style={{ verticalAlign: 'middle' }} /> button opens, or down to “Not in the toolbar”. Lines separate the groups.
      </div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10 }}>
        {PRESETS.map(([p, label]) => (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
            <input type="radio" checked={preset === p} onChange={() => pickPreset(p)} style={{ accentColor: 'var(--primary)', margin: 0 }} /> {label}
          </label>
        ))}
      </div>

      <div ref={board} style={{ position: 'relative', userSelect: 'none' }}>
        <div style={heading}>Toolbar</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: 6, borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)' }}>
          {parts.map((g, gi) => (
            <span key={gi} style={{ display: 'contents' }}>
              {gi > 0 && <Sep />}
              <span data-drop-zone={`g:${gi}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, minHeight: 30, minWidth: 30, flexGrow: gi === parts.length - 1 ? 1 : 0 }}>
                {g.items.length === 0 && g.subs.length === 0 && emptyBox('Empty group')}
                {g.items.map((id, i) => item(`g:${gi}`, i, id, <ButtonPicture id={id} platform={platform} />))}
                {g.subs.map((sub, si) => <span key={`o${si}`} title="Opens the row below" style={{ display: 'flex', width: 30, height: 30, alignItems: 'center', justifyContent: 'center', color: 'var(--text-main)' }}><Icon path={subIcon(sub)} size={18} /></span>)}
              </span>
            </span>
          ))}
        </div>
        {parts.flatMap((g, gi) => g.subs.map((sub, si) => (
          <div key={`s${gi}-${si}`} style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              <Icon path={subIcon(sub)} size={14} /> opens this {platform === 'desktopTable' ? 'menu' : 'row'} (group {gi + 1})
            </div>
            <div data-drop-zone={`s:${gi}:${si}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, minHeight: 30, padding: 6, borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-high)', width: 'fit-content', minWidth: 160 }}>
              {sub.length === 0 && emptyBox('Drop buttons here')}
              {sub.map((id, i) => item(`s:${gi}:${si}`, i, id, <ButtonPicture id={id} platform={platform} />))}
            </div>
          </div>
        )))}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => save([...groups, []])} style={button}><Icon path={mdiPlus} size={16} /> Group</button>
          <button type="button" onClick={() => save(groups.length ? groups.map((g, i) => (i === groups.length - 1 ? [...g, []] : g)) : [[[]]])} style={button}>
            <Icon path={mdiDotsVertical} size={16} /> Row in the last group
          </button>
          {preset === 'custom' && <button type="button" onClick={() => onChange(null)} style={button}>Reset to the default</button>}
        </div>

        <div style={heading}>Not in the toolbar</div>
        <div data-drop-zone="unused" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 44, padding: 6, borderRadius: 8, border: '1px dashed var(--border-focus)' }}>
          {unused.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)', padding: 6 }}>Every button is in the toolbar. Drag one here to take it out.</span>}
          {unused.map((u, i) => item('unused', i, u.id, (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 6, backgroundColor: 'var(--bg-surface-high)', fontSize: 13 }}>
              <Icon path={u.icon} size={16} /> {u.label}
            </span>
          )))}
        </div>

        {marker && <div style={{ position: 'absolute', pointerEvents: 'none', ...marker }} />}
      </div>
      {drag && (
        <div style={{ position: 'fixed', left: drag.x + 8, top: drag.y + 8, zIndex: 100000, pointerEvents: 'none', padding: 2, borderRadius: 8, backgroundColor: 'var(--bg-surface-highest)', boxShadow: '0 6px 16px rgba(0,0,0,0.4)' }}>
          <ButtonPicture id={drag.id} platform={platform} />
        </div>
      )}
    </>
  );
}

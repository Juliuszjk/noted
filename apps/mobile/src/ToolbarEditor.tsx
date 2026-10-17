import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { mdiDotsVertical, mdiChevronUp, mdiMinus, mdiPlus, mdiPinOutline, mdiTableCog, mdiTableEdit, mdiDotsHorizontal } from '@mdi/js';
import {
  toolbarGroups, toolbarItem, unusedToolbarItems, toolbarMove, toolbarRemoveAt, toolbarInsertAt, pruneToolbar, toolbarGroupParts,
  CELL_TOOLBAR_ITEMS,
} from '@noted/editor/toolbar-items';
import type { ToolbarConfig, ToolbarGroup, ToolbarPlatform, ToolbarPreset, ToolbarSlot } from '@noted/editor/toolbar-items';
import { T, Icon } from './ui';
import { DragBoard, DropZone, DragItem } from './DragBoard';
import type { DragPlace } from './DragBoard';

// Settings > Toolbar on the phone: the toolbar drawn as in a note, edited in place. Hold a
// button and drag it to another place, into a ⋮ row (above the bar, like in the editor), or
// down to "Not in the toolbar"; from there back up. Any change makes the toolbar "Custom".

const PRESETS: [ToolbarPreset, string][] = [['default', 'Default'], ['minimal', 'Minimal'], ['custom', 'Custom']];
const BTN = 40;

const Btn = ({ icon, caret }: { icon: string; caret?: boolean }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', height: BTN, minWidth: caret ? BTN + 10 : BTN, justifyContent: 'center' }}>
    <Icon path={icon} size={22} color={T.on_surface} />
    {caret ? <Icon path={mdiChevronUp} size={14} color={T.on_surface_variant} /> : null}
  </View>
);
const Label = ({ text }: { text: string }) => (
  <View style={{ height: BTN, justifyContent: 'center', paddingHorizontal: 8 }}>
    <Text style={{ color: T.on_surface, fontSize: 14 }}>{text}</Text>
  </View>
);
const Sep = () => <View style={{ width: 1, height: 24, marginHorizontal: 4, alignSelf: 'center', backgroundColor: T.outline_variant }} />;

// One button as the phone's toolbar shows it.
const ButtonPicture = ({ id }: { id: string }) => {
  if (id === 'headings') return <Label text="Paragraph" />;
  if (id === 'font') return <Label text="Sans" />;
  if (id === 'fontSize') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Btn icon={mdiMinus} /><Text style={{ color: T.on_surface, fontSize: 14, paddingHorizontal: 2 }}>16</Text><Btn icon={mdiPlus} />
      </View>
    );
  }
  const item = toolbarItem(id);
  return item ? <Btn icon={item.icon} caret={['highlight', 'textColor', 'bullets', 'numbers'].includes(id)} /> : null;
};

const emptyBox = (text: string) => (
  <View style={{ height: BTN, minWidth: 96, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: T.outline, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: T.on_surface_variant, fontSize: 12 }}>{text}</Text>
  </View>
);
const heading = { color: T.primary, fontSize: 12, fontWeight: 'bold' as const, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 18, marginBottom: 6 };
const pill = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: T.outline_variant };

const zoneSlot = (zone: string): Omit<ToolbarSlot, 'index'> | null => {
  const [kind, g, s] = zone.split(':');
  if (kind === 'g') return { group: Number(g), sub: null };
  if (kind === 's') return { group: Number(g), sub: Number(s) };
  return null;
};

export function ToolbarEditor({ platform = 'mobile', config, onChange, onDragging }: {
  // 'mobileTable': the extra buttons while the cursor is in a table.
  platform?: Extract<ToolbarPlatform, 'mobile' | 'mobileTable'>;
  config: ToolbarConfig | null;
  onChange: (config: ToolbarConfig | null) => void;
  // The settings scroll view must not scroll while a button is dragged.
  onDragging: (dragging: boolean) => void;
}) {
  const preset = config?.preset ?? 'default';
  const table = platform === 'mobileTable';
  const groups: ToolbarGroup[] = preset === 'custom' ? config!.groups : toolbarGroups(platform, config);
  const unused = unusedToolbarItems(platform, groups);
  const save = (next: ToolbarGroup[]) => onChange({ preset: 'custom', groups: next });

  const pickPreset = (p: ToolbarPreset) => {
    if (p === 'custom') onChange({ preset: 'custom', groups });
    else onChange(p === 'default' ? null : { preset: p, groups: [] });
  };
  const onMove = (from: DragPlace, to: DragPlace) => {
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
  const opener = (sub: string[]) => (table ? (sub.length && sub.every((id) => CELL_TOOLBAR_ITEMS.has(id)) ? mdiTableEdit : mdiTableCog) : mdiDotsVertical);
  const parts = groups.map(toolbarGroupParts);

  return (
    <>
      <Text style={{ color: T.on_surface_variant, fontSize: 13, lineHeight: 19 }}>
        {table
          ? 'Buttons shown first while the cursor is in a table. Hold a button, then drag it: to another place, into a row its Table / Cell button opens, or down to "Not in the toolbar".'
          : 'Hold a button, then drag it: to another place, into a row a ⋮ button opens, or down to "Not in the toolbar". Lines separate the groups.'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 18, marginTop: 10 }}>
        {PRESETS.map(([p, label]) => (
          <TouchableOpacity key={p} onPress={() => pickPreset(p)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: preset === p ? T.primary : T.outline, alignItems: 'center', justifyContent: 'center' }}>
              {preset === p ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: T.primary }} /> : null}
            </View>
            <Text style={{ color: T.on_surface, fontSize: 15 }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <DragBoard onMove={onMove} onDragging={onDragging}>
        {/* The rows the ⋮ (or Table / Cell) buttons open, above the bar like in a note. */}
        {parts.flatMap((g, gi) => g.subs.map((sub, si) => (
          <View key={`s${gi}-${si}`} style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Icon path={opener(sub)} size={16} color={T.on_surface_variant} />
              <Text style={{ color: T.on_surface_variant, fontSize: 12 }}>opens this row (group {gi + 1})</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, backgroundColor: T.surface_container_high, padding: 4 }}>
              <DropZone id={`s:${gi}:${si}`} style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', minHeight: BTN }}>
                {sub.length === 0 ? emptyBox('Drop buttons here') : sub.map((id, i) => (
                  <DragItem key={`${id}-${i}`} zone={`s:${gi}:${si}`} index={i}><ButtonPicture id={id} /></DragItem>
                ))}
              </DropZone>
              <Sep />
              <Btn icon={mdiPinOutline} />
            </View>
          </View>
        )))}

        <Text style={heading}>Toolbar</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderRadius: 12, backgroundColor: T.surface_container_low, padding: 6 }}>
          {parts.map((g, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 ? <Sep /> : null}
              <DropZone id={`g:${gi}`} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: BTN, minWidth: BTN, flexGrow: gi === parts.length - 1 ? 1 : 0 }}>
                {g.items.length === 0 && g.subs.length === 0 ? emptyBox('Empty group') : null}
                {g.items.map((id, i) => (
                  <DragItem key={`${id}-${i}`} zone={`g:${gi}`} index={i}><ButtonPicture id={id} /></DragItem>
                ))}
                {g.subs.map((sub, si) => <Btn key={`o${si}`} icon={opener(sub)} />)}
              </DropZone>
            </React.Fragment>
          ))}
          {table ? <><Sep /><Btn icon={mdiDotsHorizontal} /></> : null}
        </View>
        {table ? <Text style={{ color: T.on_surface_variant, fontSize: 12, marginTop: 6 }}>Then the normal toolbar follows (…).</Text> : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <TouchableOpacity onPress={() => save([...groups, []])} style={pill}>
            <Icon path={mdiPlus} size={18} color={T.on_surface} /><Text style={{ color: T.on_surface, fontSize: 14, fontWeight: '600' }}>Group</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => save(groups.length ? groups.map((g, i) => (i === groups.length - 1 ? [...g, []] : g)) : [[[]]])} style={pill}>
            <Icon path={table ? mdiTableCog : mdiDotsVertical} size={18} color={T.on_surface} /><Text style={{ color: T.on_surface, fontSize: 14, fontWeight: '600' }}>Row in the last group</Text>
          </TouchableOpacity>
          {preset === 'custom' ? (
            <TouchableOpacity onPress={() => onChange(null)} style={pill}>
              <Text style={{ color: T.on_surface, fontSize: 14, fontWeight: '600' }}>Reset</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={heading}>Not in the toolbar</Text>
        <DropZone id="unused" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 56, padding: 6, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: T.outline_variant }}>
          {unused.length === 0 ? <Text style={{ color: T.on_surface_variant, fontSize: 13, padding: 8 }}>Every button is in the toolbar. Drag one here to take it out.</Text> : null}
          {unused.map((item, i) => (
            <DragItem key={item.id} zone="unused" index={i}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 40, borderRadius: 10, backgroundColor: T.surface_container_high }}>
                <Icon path={item.icon} size={20} color={T.on_surface} />
                <Text style={{ color: T.on_surface, fontSize: 13 }}>{item.label}</Text>
              </View>
            </DragItem>
          ))}
        </DropZone>
      </DragBoard>
    </>
  );
}

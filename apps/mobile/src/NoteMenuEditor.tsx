import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { mdiTrashCanOutline } from '@mdi/js';
import { T, Icon, themed } from './ui';
import { MENU_TOGGLES, MENU_ACTIONS, DEFAULT_NOTE_MENU, getNoteMenuLayout, setNoteMenuLayout } from './note-menu-layout';
import type { MenuItemDef, NoteMenuLayout } from './note-menu-layout';
import { DragBoard, DropZone, DragItem } from './DragBoard';
import type { DragPlace } from './DragBoard';

// Settings > Note menu: the menu drawn as in a note, edited in place. Hold a switch or a tile,
// then drag it to another place or down to "Hidden"; from there back up. "Move to trash"
// always stays last.

const local = themed(() => ({
  heading: { color: T.primary, fontSize: 12, fontWeight: 'bold' as const, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 18, marginBottom: 6 },
}));
const isToggle = (id: string) => MENU_TOGGLES.some((i) => i.id === id);
const byId = new Map([...MENU_TOGGLES, ...MENU_ACTIONS].map((i) => [i.id, i]));

const Switch = ({ item }: { item: MenuItemDef }) => (
  <View style={{ alignItems: 'center' }}>
    <View style={{ width: '100%', height: 46, borderRadius: 10, borderWidth: 1, borderColor: T.outline_variant, alignItems: 'center', justifyContent: 'center' }}>
      <Icon path={item.icon} size={22} color={T.on_surface} />
    </View>
    <Text style={{ color: T.on_surface, fontSize: 11, marginTop: 4 }} numberOfLines={1}>{item.label}</Text>
  </View>
);
const Tile = ({ item, danger }: { item: MenuItemDef; danger?: boolean }) => (
  <View style={{ alignItems: 'center', paddingVertical: 6, paddingHorizontal: 3 }}>
    <View style={{ width: '100%', height: 48, borderRadius: 12, backgroundColor: T.surface_container, alignItems: 'center', justifyContent: 'center' }}>
      <Icon path={item.icon} size={22} color={danger ? T.error : T.on_surface} />
    </View>
    <Text style={{ color: T.on_surface, fontSize: 11, marginTop: 4, textAlign: 'center' }} numberOfLines={2}>{item.label}</Text>
  </View>
);

export function NoteMenuEditor({ onDragging }: { onDragging: (dragging: boolean) => void }) {
  const [layout, setLayout] = useState<NoteMenuLayout>(getNoteMenuLayout);
  const save = (next: NoteMenuLayout | null) => { setNoteMenuLayout(next); setLayout(next ?? DEFAULT_NOTE_MENU); };
  const hidden = [...MENU_TOGGLES, ...MENU_ACTIONS].filter((i) => !layout.toggles.includes(i.id) && !layout.actions.includes(i.id));
  const idAt = (place: DragPlace): string | undefined =>
    place.zone === 'toggles' ? layout.toggles[place.index] : place.zone === 'actions' ? layout.actions[place.index] : hidden[place.index]?.id;

  const onMove = (from: DragPlace, to: DragPlace) => {
    const id = idAt(from);
    if (!id) return;
    const lists = { toggles: [...layout.toggles], actions: [...layout.actions] };
    let index = to.index;
    if (from.zone === 'toggles' || from.zone === 'actions') {
      const list = lists[from.zone];
      list.splice(from.index, 1);
      if (from.zone === to.zone && to.index > from.index) index--;
    }
    if (to.zone === 'toggles' || to.zone === 'actions') lists[to.zone].splice(index, 0, id);
    save(lists);
  };
  // Switches stay among switches, tiles among tiles.
  const canDrop = (from: DragPlace, zone: string) => {
    const id = idAt(from);
    return !!id && (zone === 'hidden' || zone === (isToggle(id) ? 'toggles' : 'actions'));
  };

  return (
    <>
      <Text style={{ color: T.on_surface_variant, fontSize: 13, lineHeight: 19 }}>
        The note menu ("⋮" in a note) on this phone. Hold a switch or a tile, then drag it to another place or down to "Hidden". The switches show 5 at a time (swipe for the rest).
      </Text>
      <DragBoard onMove={onMove} canDrop={canDrop} onDragging={onDragging}>
        <View style={{ marginTop: 12, borderRadius: 20, backgroundColor: T.surface_container_high, paddingVertical: 12 }}>
          <DropZone id="toggles" style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, rowGap: 10, minHeight: 64 }}>
            {layout.toggles.length === 0 ? <Text style={{ color: T.on_surface_variant, fontSize: 13, padding: 10 }}>No switches.</Text> : null}
            {layout.toggles.map((id, i) => (
              <DragItem key={id} zone="toggles" index={i} style={{ width: '20%', paddingHorizontal: 3 }}><Switch item={byId.get(id)!} /></DragItem>
            ))}
          </DropZone>
          <View style={{ height: 1, backgroundColor: T.outline_variant, marginVertical: 12 }} />
          <DropZone id="actions" style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, minHeight: 70 }}>
            {layout.actions.map((id, i) => (
              <DragItem key={id} zone="actions" index={i} style={{ width: '20%' }}><Tile item={byId.get(id)!} /></DragItem>
            ))}
            <View style={{ width: '20%', opacity: 0.6 }}><Tile item={{ id: 'trash', label: 'Move to trash', icon: mdiTrashCanOutline }} danger /></View>
          </DropZone>
        </View>

        <Text style={local.heading}>Hidden</Text>
        <DropZone id="hidden" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 56, padding: 6, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: T.outline_variant }}>
          {hidden.length === 0 ? <Text style={{ color: T.on_surface_variant, fontSize: 13, padding: 8 }}>Nothing hidden. Drag a switch or a tile here to hide it.</Text> : null}
          {hidden.map((item, i) => (
            <DragItem key={item.id} zone="hidden" index={i}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 40, borderRadius: 10, backgroundColor: T.surface_container_high }}>
                <Icon path={item.icon} size={20} color={T.on_surface} />
                <Text style={{ color: T.on_surface, fontSize: 13 }}>{item.label}</Text>
              </View>
            </DragItem>
          ))}
        </DropZone>
      </DragBoard>
      <TouchableOpacity onPress={() => save(null)} style={{ alignSelf: 'flex-start', marginTop: 16, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: T.outline_variant }}>
        <Text style={{ color: T.on_surface, fontSize: 14, fontWeight: '600' }}>Reset</Text>
      </TouchableOpacity>
    </>
  );
}

import React, { useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { mdiClose, mdiFileDocumentOutline } from '@mdi/js';
import { T, Icon, themed } from './ui';
import { SplitIcon } from './SplitIcon';
import type { SplitSide } from './SplitIcon';

interface Props {
  tabs: string[];
  titles: Record<string, string>;
  // Where each note is (tells same-titled tabs apart).
  places?: Record<string, string>;
  activeId: string | null;
  onOpen: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAll: () => void;
  // A tab dragged to an edge of the screen opens next to the current note.
  onSplit: (id: string, side: SplitSide) => void;
  onClose: () => void;
}

const SIDES: SplitSide[] = ['left', 'right', 'top', 'bottom'];

// Open tabs. Hold a tab and drag it to an edge (left, right, top, bottom) to see it next to
// the open note, like snapping windows.
export function TabsSheet({ tabs, titles, places = {}, activeId, onOpen, onCloseTab, onCloseAll, onSplit, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef<string | null>(null);

  const zoneAt = (x: number, y: number): SplitSide | null => {
    if (x < width * 0.28) return 'left';
    if (x > width * 0.72) return 'right';
    if (y < height * 0.32) return 'top';
    if (y > height * 0.68) return 'bottom';
    return null;
  };
  // Raw touch events reach this view whichever child holds the touch.
  const onTouchMove = (e: GestureResponderEvent) => {
    if (!dragRef.current) return;
    const { pageX, pageY } = e.nativeEvent;
    setDrag({ id: dragRef.current, x: pageX, y: pageY });
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    const id = dragRef.current;
    if (!id) return;
    dragRef.current = null;
    setDrag(null);
    const side = zoneAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
    if (side) {
      onClose();
      onSplit(id, side);
    }
  };
  const zone = drag ? zoneAt(drag.x, drag.y) : null;

  const zoneStyle = (side: SplitSide) => ({
    left: { left: 0, top: 0, bottom: 0, width: width * 0.28 },
    right: { right: 0, top: 0, bottom: 0, width: width * 0.28 },
    top: { top: 0, left: width * 0.28, right: width * 0.28, height: height * 0.32 },
    bottom: { bottom: 0, left: width * 0.28, right: width * 0.28, height: height * 0.32 },
  }[side]);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1 }} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, drag && { opacity: 0.25 }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Open tabs ({tabs.length})</Text>
          <Text style={styles.hint}>Hold a tab and drag it to an edge to open it next to this note.</Text>
          <ScrollView style={{ maxHeight: 420 }} scrollEnabled={!drag}>
            {tabs.map((id) => (
              <TouchableOpacity
                key={id}
                style={[styles.row, id === activeId && styles.active]}
                onPress={() => { onClose(); onOpen(id); }}
                onLongPress={(e) => {
                  dragRef.current = id;
                  setDrag({ id, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
                }}
                delayLongPress={300}
              >
                <Icon path={mdiFileDocumentOutline} size={22} color={T.on_surface_variant} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.label} numberOfLines={1}>{titles[id] ?? 'Untitled'}</Text>
                  {places[id] ? <Text style={styles.place} numberOfLines={1}>{places[id]}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => onCloseTab(id)} style={styles.trailing} accessibilityLabel="Close tab">
                  <Icon path={mdiClose} size={20} color={T.on_surface_variant} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {tabs.length ? (
            <TouchableOpacity style={styles.row} onPress={() => { onClose(); onCloseAll(); }}>
              <Icon path={mdiClose} size={22} color={T.error} />
              <Text style={[styles.label, { color: T.error }]}>Close all tabs</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {drag ? (
          <>
            {SIDES.map((side) => (
              <View key={side} pointerEvents="none" style={[styles.zone, zoneStyle(side), zone === side && styles.zoneOn]}>
                <SplitIcon side={side} size={40} color={zone === side ? T.on_primary_container : T.on_surface_variant} />
              </View>
            ))}
            <View pointerEvents="none" style={[styles.ghost, { left: Math.min(drag.x - 90, width - 190), top: drag.y - 28 }]}>
              <Text style={styles.ghostText} numberOfLines={1}>{titles[drag.id] ?? 'Untitled'}</Text>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: T.surface_container_high, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 28, paddingHorizontal: 8 },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: T.outline, opacity: 0.6, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: 'bold', color: T.on_surface, paddingHorizontal: 16, paddingTop: 10 },
  hint: { fontSize: 13, color: T.on_surface_variant, paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, minHeight: 54, borderRadius: 12 },
  active: { backgroundColor: T.secondary_container },
  label: { fontSize: 16, color: T.on_surface },
  place: { fontSize: 12, color: T.on_surface_variant },
  trailing: { padding: 8 },
  zone: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderRadius: 16, margin: 6, borderWidth: 2, borderStyle: 'dashed', borderColor: T.outline, backgroundColor: 'rgba(0,0,0,0.35)' },
  zoneOn: { borderStyle: 'solid', borderColor: T.primary, backgroundColor: T.primary_container },
  ghost: { position: 'absolute', width: 180, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: T.surface_container_highest, elevation: 8 },
  ghostText: { color: T.on_surface, fontSize: 15, fontWeight: '600' },
}));

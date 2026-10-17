import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { dropIndex, inBox } from '@noted/ui/src/drop-index';
import type { Box } from '@noted/ui/src/drop-index';
import { T } from './ui';

// Drag and drop on the settings pictures (toolbar, note menu): hold a button for a moment,
// then drag it to another place in a zone (a group, a row, the list of unused ones). Zones and
// buttons are measured when a drag starts; the page does not scroll while dragging.

export interface DragPlace {
  zone: string;
  index: number;
}

const HOLD_MS = 250;

interface BoardApi {
  zoneRef: (zone: string) => (view: View | null) => void;
  itemRef: (zone: string, index: number) => (view: View | null) => void;
  begin: (from: DragPlace, node: React.ReactNode, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (drop: boolean) => void;
  dragging: DragPlace | null;
}

const BoardContext = createContext<BoardApi | null>(null);

const measure = (view: View | null | undefined): Promise<Box | null> => new Promise((resolve) => {
  if (!view) return resolve(null);
  view.measureInWindow((x, y, w, h) => resolve(w || h ? { x, y, w, h } : null));
});

export function DragBoard({ onMove, canDrop, onDragging, children }: {
  onMove: (from: DragPlace, to: DragPlace) => void;
  // A zone that does not take this button (e.g. a switch among the action tiles).
  canDrop?: (from: DragPlace, zone: string) => boolean;
  onDragging: (dragging: boolean) => void;
  children: React.ReactNode;
}) {
  const root = useRef<View | null>(null);
  const zones = useRef(new Map<string, View>());
  const items = useRef(new Map<string, View>());
  const boxes = useRef<{ root: Box; zones: Map<string, Box>; items: Map<string, Box[]> } | null>(null);
  const [drag, setDrag] = useState<{ from: DragPlace; node: React.ReactNode; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<DragPlace | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const targetRef = useRef(target);
  targetRef.current = target;

  const findTarget = (from: DragPlace, x: number, y: number): DragPlace | null => {
    const b = boxes.current;
    if (!b) return null;
    // The smallest zone under the point (zones may sit inside bigger ones).
    let best: { zone: string; area: number } | null = null;
    for (const [zone, box] of b.zones) {
      if (!inBox(box, x, y, 6) || (canDrop && !canDrop(from, zone))) continue;
      const area = box.w * box.h;
      if (!best || area < best.area) best = { zone, area };
    }
    if (!best) return null;
    return { zone: best.zone, index: dropIndex(b.items.get(best.zone) ?? [], x, y) };
  };

  const api: BoardApi = {
    zoneRef: (zone) => (view) => { if (view) zones.current.set(zone, view); else zones.current.delete(zone); },
    itemRef: (zone, index) => (view) => { const key = `${zone}\u0000${index}`; if (view) items.current.set(key, view); else items.current.delete(key); },
    begin: (from, node, x, y) => {
      onDragging(true);
      setDrag({ from, node, x, y });
      boxes.current = null;
      (async () => {
        const rootBox = await measure(root.current);
        const zoneBoxes = new Map<string, Box>();
        for (const [zone, view] of zones.current) { const box = await measure(view); if (box) zoneBoxes.set(zone, box); }
        const itemBoxes = new Map<string, Box[]>();
        for (const [key, view] of items.current) {
          const [zone, index] = key.split('\u0000');
          const box = await measure(view);
          if (!box) continue;
          const list = itemBoxes.get(zone) ?? [];
          list[Number(index)] = box;
          itemBoxes.set(zone, list);
        }
        for (const [zone, list] of itemBoxes) itemBoxes.set(zone, list.filter(Boolean));
        boxes.current = { root: rootBox ?? { x: 0, y: 0, w: 0, h: 0 }, zones: zoneBoxes, items: itemBoxes };
        const d = dragRef.current;
        if (d) setTarget(findTarget(d.from, d.x, d.y));
      })();
    },
    move: (x, y) => {
      const d = dragRef.current;
      if (!d) return;
      setDrag({ ...d, x, y });
      setTarget(findTarget(d.from, x, y));
    },
    end: (drop) => {
      const d = dragRef.current;
      const t = targetRef.current;
      setDrag(null);
      setTarget(null);
      onDragging(false);
      if (drop && d && t) onMove(d.from, t);
    },
    dragging: drag?.from ?? null,
  };

  // Where the button would land: a bar before the button at that place (or after the last),
  // or the whole zone when it is empty.
  let marker: StyleProp<ViewStyle> = null;
  const b = boxes.current;
  if (drag && target && b) {
    const list = b.items.get(target.zone) ?? [];
    const zone = b.zones.get(target.zone);
    if (list.length === 0 && zone) {
      marker = { left: zone.x - b.root.x, top: zone.y - b.root.y, width: zone.w, height: zone.h, borderWidth: 2, borderColor: T.primary, borderRadius: 12 };
    } else {
      const at = list[Math.min(target.index, list.length - 1)];
      const x = target.index < list.length ? at.x - 2 : at.x + at.w + 1;
      marker = { left: x - b.root.x, top: at.y - b.root.y + 4, width: 3, height: at.h - 8, borderRadius: 2, backgroundColor: T.primary };
    }
  }

  return (
    <BoardContext.Provider value={api}>
      <View ref={root}>
        {children}
        {marker ? <View pointerEvents="none" style={[{ position: 'absolute' }, marker]} /> : null}
        {drag && b ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: drag.x - b.root.x - 24, top: drag.y - b.root.y - 56, opacity: 0.9, borderRadius: 12, backgroundColor: T.surface_container_highest, padding: 2, elevation: 6 }}>
            {drag.node}
          </View>
        ) : null}
      </View>
    </BoardContext.Provider>
  );
}

// A zone: a group, a row, the unused list.
export function DropZone({ id, style, children }: { id: string; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const board = useContext(BoardContext);
  return <View ref={board?.zoneRef(id)} collapsable={false} style={style}>{children}</View>;
}

// A button that can be dragged: hold it still, then move. Moving at once scrolls the page.
export function DragItem({ zone, index, children, style }: { zone: string; index: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const board = useContext(BoardContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0 });
  const active = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clear, []);
  const dragging = board?.dragging?.zone === zone && board.dragging.index === index;
  return (
    <View
      ref={board?.itemRef(zone, index)}
      collapsable={false}
      style={[style, dragging && { opacity: 0.3 }]}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => !active.current}
      onResponderGrant={(e) => {
        const { pageX, pageY } = e.nativeEvent;
        start.current = { x: pageX, y: pageY };
        last.current = { x: pageX, y: pageY };
        active.current = false;
        clear();
        timer.current = setTimeout(() => {
          active.current = true;
          board?.begin({ zone, index }, children, last.current.x, last.current.y);
        }, HOLD_MS);
      }}
      onResponderMove={(e) => {
        const { pageX, pageY } = e.nativeEvent;
        last.current = { x: pageX, y: pageY };
        if (active.current) board?.move(pageX, pageY);
        else if (Math.hypot(pageX - start.current.x, pageY - start.current.y) > 8) clear();
      }}
      onResponderRelease={() => {
        clear();
        if (active.current) board?.end(true);
        active.current = false;
      }}
      onResponderTerminate={() => {
        clear();
        if (active.current) board?.end(false);
        active.current = false;
      }}
    >
      {children}
    </View>
  );
}

import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet } from 'react-native';
import { T, Icon } from './ui';

export interface SheetRow {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  active?: boolean;
  onPress: () => void;
  // Small button at the end of the row (e.g. close a tab).
  trailing?: { icon: string; label: string; onPress: () => void };
}

// Bottom sheet with a title and rows (note actions, open tabs).
export function Sheet({ title, rows, footer, onClose }: { title: string; rows: SheetRow[]; footer?: SheetRow; onClose: () => void }) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <ScrollView style={{ maxHeight: 420 }}>
          {rows.map((row) => (
            <TouchableOpacity key={row.key} style={[styles.row, row.active && styles.active]} onPress={() => { onClose(); row.onPress(); }}>
              {row.icon ? <Icon path={row.icon} size={22} color={row.danger ? T.error : T.on_surface_variant} /> : null}
              <Text style={[styles.label, row.danger && { color: T.error }]} numberOfLines={1}>{row.label}</Text>
              {row.trailing ? (
                <TouchableOpacity onPress={row.trailing.onPress} style={styles.trailing} accessibilityLabel={row.trailing.label}>
                  <Icon path={row.trailing.icon} size={20} color={T.on_surface_variant} />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
        {footer ? (
          <TouchableOpacity style={styles.row} onPress={() => { onClose(); footer.onPress(); }}>
            {footer.icon ? <Icon path={footer.icon} size={22} color={footer.danger ? T.error : T.primary} /> : null}
            <Text style={[styles.label, { color: footer.danger ? T.error : T.primary }]}>{footer.label}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: T.surface_container_high, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 28, paddingHorizontal: 8 },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: T.outline, opacity: 0.6, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: 'bold', color: T.on_surface, paddingHorizontal: 16, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, minHeight: 54, borderRadius: 12 },
  active: { backgroundColor: T.secondary_container },
  label: { flex: 1, fontSize: 16, color: T.on_surface },
  trailing: { padding: 8 },
});

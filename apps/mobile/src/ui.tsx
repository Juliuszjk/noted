import Svg, { Path } from 'react-native-svg';
import React, { useState } from 'react';
import { Appearance, View, Text, TextInput, TouchableOpacity, Switch as RNSwitch, StyleSheet } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { mdiEyeOutline, mdiEyeOffOutline, mdiChevronDown, mdiCheck } from '@mdi/js';
import * as SecureStore from 'expo-secure-store';
import { resolveTheme, THEME_PRESETS } from '@noted/theme';
import type { ThemeMode } from '@noted/theme';
import { getMaterial3Theme, isDynamicThemeSupported } from '@pchmn/expo-material3-theme';

// Colours of the native screens: the same Material 3 roles as the editor page and the desktop.
// Android 12+ gives the wallpaper's Material You palette (light and dark), used unless turned
// off in Settings > Appearance; a ready-made theme replaces it. The styles are made once at
// start, so a change of theme reloads the app (a second; nothing is lost).
export const THEME_MODE_KEY = 'noted_theme_mode';
export const MATERIAL_YOU_KEY = 'noted_material_you';
const readMode = (): ThemeMode => {
  try {
    const value = SecureStore.getItem(THEME_MODE_KEY);
    return value === 'light' || value === 'dark' || THEME_PRESETS.some((p) => p.id === value) ? value! : 'auto';
  } catch {
    return 'auto';
  }
};
export const materialYouAvailable = isDynamicThemeSupported;
export const materialYouOn = (): boolean => {
  try {
    return SecureStore.getItem(MATERIAL_YOU_KEY) !== '0';
  } catch {
    return true;
  }
};
// The system palette in the shape of a theme file ({light, dark} with our role names).
const materialYouFile = (): string | null => {
  if (!materialYouAvailable || !materialYouOn()) return null;
  try {
    const m = getMaterial3Theme();
    const roles = (c: typeof m.dark) => ({
      background: c.background, surface_container_low: c.surfaceContainerLow, surface_container: c.surfaceContainer,
      surface_container_high: c.surfaceContainerHigh, surface_container_highest: c.surfaceContainerHighest,
      on_surface: c.onSurface, on_surface_variant: c.onSurfaceVariant, primary: c.primary, on_primary: c.onPrimary,
      primary_container: c.primaryContainer, on_primary_container: c.onPrimaryContainer, secondary_container: c.secondaryContainer,
      on_secondary_container: c.onSecondaryContainer, outline: c.outline, outline_variant: c.outlineVariant, error: c.error,
    });
    return JSON.stringify({ light: roles(m.light), dark: roles(m.dark) });
  } catch {
    return null;
  }
};
export const themeMode = readMode();
// What the colours were made from: when it changes (system light / dark, new wallpaper,
// another choice in Settings) the app reloads to show the new colours.
export const themeSignature = (): string => {
  const mode = readMode();
  return `${mode}|${materialYouFile() ?? ''}|${mode === 'auto' ? Appearance.getColorScheme() : ''}`;
};
export const startThemeSignature = themeSignature();
export const T = resolveTheme(themeMode, materialYouFile(), Appearance.getColorScheme() !== 'light');

// Material Design Icons (@mdi/js paths).
export function Icon({ path, size = 24, color = T.on_surface }: { path: string; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={path} fill={color} />
    </Svg>
  );
}

// A password field with an eye button that shows what was typed. The outer margins of `style`
// go to the wrapper, so the eye is centred on the field itself.
export function PasswordField({ value, onChangeText, placeholder, style, onFocus, onBlur, onPressIn }: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
  onFocus?: () => void;
  onBlur?: () => void;
  onPressIn?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const { margin, marginTop, marginBottom, marginVertical, marginHorizontal, marginLeft, marginRight, ...field } = StyleSheet.flatten(style) ?? {};
  return (
    <View style={{ margin, marginTop, marginBottom, marginVertical, marginHorizontal, marginLeft, marginRight }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onPressIn={onPressIn}
        placeholder={placeholder}
        placeholderTextColor={T.on_surface_variant}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        style={[field, { paddingRight: 48 }]}
      />
      <TouchableOpacity onPress={() => setVisible((v) => !v)} accessibilityLabel={visible ? 'Hide' : 'Show'}
        style={{ position: 'absolute', right: 4, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 10 }}>
        <Icon path={visible ? mdiEyeOffOutline : mdiEyeOutline} size={22} color={T.on_surface_variant} />
      </TouchableOpacity>
    </View>
  );
}

// On / off switch in the theme's colours (Material 3: primary track, light thumb), not
// Android's default accent.
export function ThemedSwitch({ value, onValueChange, disabled }: { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ true: T.primary, false: T.surface_container_highest }}
      thumbColor={value ? T.on_primary : T.outline}
      ios_backgroundColor={T.surface_container_highest}
    />
  );
}

// A row of equal segments (one choice), like the desktop's.
export function Segmented<V extends string | number>({ value, options, onChange }: { value: V; options: [V, string][]; onChange: (v: V) => void }) {
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: T.outline_variant, borderRadius: 20, overflow: 'hidden' }}>
      {options.map(([v, label], i) => {
        const on = v === value;
        return (
          <TouchableOpacity key={String(v)} onPress={() => onChange(v)} style={{
            flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, paddingVertical: 9,
            backgroundColor: on ? T.secondary_container : 'transparent',
            borderLeftWidth: i ? 1 : 0, borderLeftColor: T.outline_variant,
          }}>
            {on ? <Icon path={mdiCheck} size={16} color={T.on_secondary_container} /> : null}
            <Text style={{ color: on ? T.on_secondary_container : T.on_surface, fontSize: 14 }} numberOfLines={1}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// A dropdown: the current choice, tapping it lists the others below.
export function Select<V extends string>({ value, options, onChange }: { value: V; options: [V, string][]; onChange: (v: V) => void }) {
  const [open, setOpen] = useState(false);
  const label = options.find(([v]) => v === value)?.[1] ?? '';
  return (
    <View>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} style={{
        flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10,
        borderWidth: 1, borderColor: open ? T.primary : T.outline_variant, borderRadius: 10,
      }}>
        <Text style={{ flex: 1, color: T.on_surface, fontSize: 15 }}>{label}</Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><Icon path={mdiChevronDown} size={20} color={T.on_surface_variant} /></View>
      </TouchableOpacity>
      {open ? (
        <View style={{ marginTop: 4, borderRadius: 10, borderWidth: 1, borderColor: T.outline_variant, backgroundColor: T.surface_container_high, overflow: 'hidden' }}>
          {options.map(([v, text]) => (
            <TouchableOpacity key={v} onPress={() => { setOpen(false); onChange(v); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: v === value ? T.secondary_container : 'transparent' }}>
              <Text style={{ flex: 1, color: v === value ? T.on_secondary_container : T.on_surface, fontSize: 15 }}>{text}</Text>
              {v === value ? <Icon path={mdiCheck} size={18} color={T.on_secondary_container} /> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

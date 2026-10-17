import { useEffect, useReducer, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CALLOUT_ICONS, CALLOUT_VARIANTS, EDITOR_COLORS } from '@noted/editor';
import type { CalloutAttributes } from '@noted/editor';
import { Btn, Sep, toolbarStyle, popoverStyle, blockToolbarTop } from './menu-parts';

type Popover = 'variant' | 'color' | 'icon' | null;

const swatchStyle = { minWidth: 26, height: 26, padding: 0, border: '1px solid var(--border-focus)' } as const;

// Toolbar above the callout the cursor is in: kind, colour, icon, unwrap.
export function CalloutMenu({ editor }: { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [popover, setPopover] = useState<Popover>(null);

  useEffect(() => {
    const update = () => rerender();
    editor.on('transaction', update);
    editor.on('focus', update);
    editor.on('blur', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.off('transaction', update);
      editor.off('focus', update);
      editor.off('blur', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  const { selection } = editor.state;
  // Text selections show the FormatMenu and tables their own menu; both would overlap this one.
  const hidden =
    !editor.isFocused ||
    !editor.isActive('callout') ||
    editor.isActive('table') ||
    !(selection instanceof TextSelection) ||
    !selection.empty;

  useEffect(() => {
    if (hidden && popover) setPopover(null);
  }, [hidden, popover]);

  if (hidden) return null;

  // The innermost callout around the cursor.
  const { $from } = selection;
  let calloutPos = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'callout') {
      calloutPos = $from.before(depth);
      break;
    }
  }
  const callout = calloutPos >= 0 ? editor.state.doc.nodeAt(calloutPos) : null;
  const dom = calloutPos >= 0 ? (editor.view.nodeDOM(calloutPos) as HTMLElement | null) : null;
  if (!callout || !dom) return null;

  const attrs = callout.attrs as CalloutAttributes;
  const variant = CALLOUT_VARIANTS.find((v) => v.name === attrs.variant) ?? CALLOUT_VARIANTS[0];
  const rect = dom.getBoundingClientRect();
  const top = blockToolbarTop(rect);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 420));
  const toggle = (name: Popover) => setPopover((current) => (current === name ? null : name));

  // Changes only this callout (updateAttributes would also touch callouts around it).
  const setAttrs = (changes: Partial<CalloutAttributes>) => {
    const tr = editor.state.tr.setNodeMarkup(calloutPos, undefined, { ...attrs, ...changes });
    editor.view.dispatch(tr);
    editor.view.focus();
    setPopover(null);
  };

  return (
    <div style={{ ...toolbarStyle, top, left }}>
      <span style={{ position: 'relative', display: 'flex' }}>
        <Btn title="Callout kind" active={popover === 'variant'} onClick={() => toggle('variant')}>{variant.icon} {variant.label} ▾</Btn>
        {popover === 'variant' && (
          <div style={{ ...popoverStyle, top: 'calc(100% + 10px)', minWidth: 140 }}>
            {CALLOUT_VARIANTS.map((v) => (
              <Btn
                key={v.name}
                title={v.label}
                active={v.name === attrs.variant}
                onClick={() => setAttrs({ variant: v.name })}
                style={{ display: 'block', width: '100%', textAlign: 'left', height: 'auto', padding: '6px 8px' }}
              >
                {v.icon} {v.label}
              </Btn>
            ))}
          </div>
        )}
      </span>
      <span style={{ position: 'relative', display: 'flex' }}>
        <Btn title="Colour" active={popover === 'color'} onClick={() => toggle('color')}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, verticalAlign: -1, backgroundColor: `var(--c-${attrs.color ?? variant.color})` }} /> ▾
        </Btn>
        {popover === 'color' && (
          <div style={{ ...popoverStyle, top: 'calc(100% + 10px)', minWidth: 0, width: 160, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Btn title="Default for this kind" active={!attrs.color} onClick={() => setAttrs({ color: null })} style={swatchStyle}>⌀</Btn>
            {EDITOR_COLORS.map((c) => (
              <Btn
                key={c.name}
                title={c.label}
                active={attrs.color === c.name}
                onClick={() => setAttrs({ color: c.name })}
                style={{ ...swatchStyle, backgroundColor: c.background, borderColor: c.text }}
              >
                {' '}
              </Btn>
            ))}
          </div>
        )}
      </span>
      <span style={{ position: 'relative', display: 'flex' }}>
        <Btn title="Icon" active={popover === 'icon'} onClick={() => toggle('icon')}>{attrs.icon ?? variant.icon} ▾</Btn>
        {popover === 'icon' && (
          <div style={{ ...popoverStyle, top: 'calc(100% + 10px)', minWidth: 0, width: 236 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {CALLOUT_ICONS.map((icon) => (
                <Btn key={icon} title={icon} active={attrs.icon === icon} onClick={() => setAttrs({ icon })} style={{ minWidth: 28, padding: 0, fontSize: 16 }}>
                  {icon}
                </Btn>
              ))}
            </div>
            <Btn title="Default icon for this kind" active={!attrs.icon} onClick={() => setAttrs({ icon: null })} style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }}>
              Default ({variant.icon})
            </Btn>
          </div>
        )}
      </span>
      <Sep />
      <Btn title="Remove the callout, keep its content" onClick={() => { editor.chain().focus().unsetCallout().run(); }}>Unwrap</Btn>
    </div>
  );
}

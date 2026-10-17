import { Fragment, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { matchesShortcut } from './shortcuts';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
  mdiFormatBold, mdiFormatItalic, mdiFormatUnderline, mdiDotsVertical, mdiFormatStrikethrough, mdiCodeTags,
  mdiFormatSubscript, mdiFormatSuperscript, mdiMarker, mdiFormatColorText, mdiMinus, mdiPlus, mdiChevronDown,
  mdiFormatListBulleted, mdiFormatListNumbered, mdiFormatListCheckbox, mdiLinkPlus, mdiVectorLink,
  mdiFormatAlignLeft, mdiFormatAlignCenter, mdiFormatAlignRight, mdiFormatAlignJustify, mdiInvertColorsOff,
  mdiPaletteOutline, mdiMagnify, mdiGesture, mdiFunctionVariant, mdiFormatIndentDecrease, mdiFormatIndentIncrease,
} from '@mdi/js';
import { EDITOR_COLORS, EDITOR_FONT_SIZES, toolbarGroups, requestMathEdit, onDrawingChange, setMouseDraws } from '@noted/editor';
import type { ToolbarConfig } from '@noted/editor';
import { IconBtn, Sep, popoverStyle } from './menu-parts';
import { InsertLinkDialog, LinkBubble } from './LinkEditors';
import { ColorPicker } from './ColorPicker';

// Formatting toolbar fixed above the note (the alternative to the floating FormatMenu).

const BASE_FONT_PX = 16;
const ALIGN_ICONS = { left: mdiFormatAlignLeft, center: mdiFormatAlignCenter, right: mdiFormatAlignRight, justify: mdiFormatAlignJustify } as const;
// List styles drawn like the slash menu tiles: markers next to text bars.
const BULLETS: { style: string; label: string; markers: string[] }[] = [
  { style: 'disc', label: 'Disc', markers: ['•', '•', '•'] },
  { style: 'circle', label: 'Circle', markers: ['◦', '◦', '◦'] },
  { style: 'square', label: 'Square', markers: ['▪', '▪', '▪'] },
  { style: 'square-open', label: 'Open square', markers: ['▫', '▫', '▫'] },
  { style: 'outline', label: 'Outline list (collapsible)', markers: ['▾', '  ▸', '▸'] },
];
const NUMBERS: { style: string; label: string; markers: string[] }[] = [
  { style: 'decimal', label: '1, 2, 3', markers: ['1.', '2.', '3.'] },
  { style: 'upper-alpha', label: 'A, B, C', markers: ['A.', 'B.', 'C.'] },
  { style: 'lower-alpha', label: 'a, b, c', markers: ['a.', 'b.', 'c.'] },
  { style: 'upper-roman', label: 'I, II, III', markers: ['I.', 'II.', 'III.'] },
  { style: 'lower-roman', label: 'i, ii, iii', markers: ['i.', 'ii.', 'iii.'] },
  { style: 'lower-greek', label: 'α, β, γ', markers: ['α.', 'β.', 'γ.'] },
];
const FONT_LABELS = { sans: 'Sans', serif: 'Serif', mono: 'Mono' } as const;
export type NoteFontChoice = keyof typeof FONT_LABELS;

type Menu = 'highlight' | 'textColor' | 'size' | 'type' | 'font' | 'bullets' | 'numbers' | 'align' | 'insertLink' | null;

const menuItem: CSSProperties = { display: 'block', width: '100%', padding: '6px 10px', border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-main)', fontSize: 13, textAlign: 'left', cursor: 'pointer' };

// Dropdown under its button. Rendered into <body> and fixed to the window: inside the toolbar
// (a sticky stacking context that scrolls sideways) WebKit cut it off and painted the note and
// the tab bar over it. Kept inside the window, scrollable when taller than the space below. It
// follows its button when the toolbar scrolls (clicking a half hidden button scrolls it).
function Drop({ open, children, width, fixedWidth }: { open: boolean; children: ReactNode; width?: number; fixedWidth?: number }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const button = anchor.current?.parentElement?.getBoundingClientRect();
      if (!button) return;
      const w = box.current?.offsetWidth ?? fixedWidth ?? width ?? 160;
      setPos({ top: button.bottom + 4, left: Math.max(8, Math.min(button.left, window.innerWidth - w - 8)) });
    };
    place();
    // Once more after the box got its real size.
    const frame = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <span ref={anchor} style={{ display: 'none' }} />
      {createPortal(<div
        ref={box}
        data-toolbar-drop=""
        style={{
          ...popoverStyle, position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? 0, minWidth: width ?? 160, zIndex: 9000,
          ...(fixedWidth ? { width: fixedWidth, boxSizing: 'border-box' as const } : {}),
          maxHeight: pos ? window.innerHeight - pos.top - 8 : undefined, overflowY: 'auto',
        }}
      >
        {children}
      </div>, document.body)}
    </>
  );
}

function MenuButton({ active, onPick, children, style }: { active?: boolean; onPick: () => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      style={{ ...menuItem, backgroundColor: active ? 'var(--secondary-container)' : 'transparent', ...style }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'var(--bg-surface-highest)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {children}
    </button>
  );
}

// A list style as a small picture (like the slash menu tiles).
function ListTile({ markers, label, active, onPick }: { markers: string[]; label: string; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: active ? 'var(--secondary-container)' : 'transparent', border: '1px solid var(--border)' }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-surface-highest)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {markers.map((marker, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 16 }}>
          <span style={{ width: 22, textAlign: 'right', fontSize: 11, color: 'var(--text-main)', whiteSpace: 'pre' }}>{marker}</span>
          <span style={{ width: 36, height: 6, borderRadius: 3, backgroundColor: 'var(--border-focus)' }} />
        </div>
      ))}
    </button>
  );
}

const swatch = (on: boolean, color: string): CSSProperties => ({
  width: 26, height: 26, borderRadius: 13, cursor: 'pointer', padding: 0,
  border: on ? '2px solid var(--text-main)' : '1px solid var(--border)', backgroundColor: color,
});

export function TopToolbar({ editor, linkEditRequest = 0, align = 'center', noteFont, onNoteFont, onOpenLink, onFind, toolbarConfig }: {
  editor: Editor;
  // Settings > Toolbar (null = every button in the default order).
  toolbarConfig?: ToolbarConfig | null;
  // Opens the find and replace bar.
  onFind?: () => void;
  onOpenLink?: (href: string) => void;
  linkEditRequest?: number;
  // 'left' with the full-width layout, 'center' otherwise.
  align?: 'left' | 'center';
  noteFont: NoteFontChoice;
  onNoteFont: (font: NoteFontChoice) => void;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [menu, setMenu] = useState<Menu>(null);
  // Open subgroup ("⋮" dropdown), by its group index.
  const [sub, setSub] = useState<number | null>(null);
  const [sizeText, setSizeText] = useState('');
  const [bubble, setBubble] = useState(false);
  // Custom colour picker open for text or highlight (inside the "more" dropdown).
  const [customFor, setCustomFor] = useState<'text' | 'highlight' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // "Draw with the mouse" shows whether it is on.
  useEffect(() => onDrawingChange(editor, rerender), [editor]);
  useEffect(() => {
    editor.on('transaction', rerender);
    // Ctrl+K: link field right above the word (with the cursor inside a link, that link).
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut(e, 'insertLink') && !editor.isActive('codeBlock')) {
        e.preventDefault();
        if (editor.state.selection.empty && editor.isActive('link')) editor.commands.extendMarkRange('link');
        setMenu(null);
        setBubble(true);
      }
    };
    editor.view.dom.addEventListener('keydown', onKeyDown);
    return () => {
      editor.off('transaction', rerender);
      editor.view.dom.removeEventListener('keydown', onKeyDown);
    };
  }, [editor]);
  useEffect(() => {
    if (!menu && sub === null) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest?.('[data-toolbar-drop]')) { setMenu(null); setSub(null); }
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [menu, sub]);
  // "Edit link" from the link context menu (the link is already selected).
  useEffect(() => {
    if (linkEditRequest) setBubble(true);
  }, [linkEditRequest]);

  const chain = () => editor.chain().focus();
  const toggle = (name: Menu) => { setCustomFor(null); setMenu((m) => (m === name ? null : name)); };
  const pick = (fn: () => void) => () => { fn(); setMenu(null); };

  const fontSize = editor.getAttributes('textStyle').fontSize as string | undefined;
  const px = fontSize ? parseInt(fontSize, 10) : BASE_FONT_PX;
  const setPx = (value: number) => chain().setFontSize(`${Math.max(6, Math.min(96, Math.round(value)))}px`).run();
  useEffect(() => setSizeText(String(px)), [px]);

  const level = ([1, 2, 3, 4, 5, 6] as const).find((l) => editor.isActive('heading', { level: l }));
  const alignment = (['center', 'right', 'justify'] as const).find((k) => editor.isActive({ textAlign: k })) ?? 'left';
  const textColor = editor.getAttributes('textStyle').color as string | undefined;
  const hasSelection = !editor.state.selection.empty;
  const selectionFont = (Object.keys(FONT_LABELS) as NoteFontChoice[]).find((f) => editor.getAttributes('textStyle').fontFamily === `var(--font-${f})`) ?? null;
  const shownFont: NoteFontChoice = hasSelection ? selectionFont ?? noteFont : noteFont;
  const highlight = editor.getAttributes('highlight').color as string | undefined;

  const setBullets = (style: string) => {
    const c = chain();
    if (!editor.isActive('bulletList')) c.toggleBulletList();
    if (style === 'outline') c.updateAttributes('bulletList', { outline: true });
    else c.updateAttributes('bulletList', { bulletStyle: style === 'disc' ? null : style, outline: false });
    c.run();
  };
  const setNumbers = (style: string) => {
    const c = chain();
    if (!editor.isActive('orderedList')) c.toggleOrderedList();
    c.updateAttributes('orderedList', { numberStyle: style === 'decimal' ? null : style }).run();
  };
  const bulletAttrs = editor.getAttributes('bulletList');
  const currentBullet = bulletAttrs.outline ? 'outline' : bulletAttrs.bulletStyle ?? 'disc';
  const currentNumber = editor.getAttributes('orderedList').numberStyle ?? 'decimal';

  const chevron = (open: boolean) => (
    <svg width={14} height={14} viewBox="0 0 24 24" style={{ transform: open ? 'rotate(180deg)' : undefined }}><path d={mdiChevronDown} fill="currentColor" /></svg>
  );
  const rel = { position: 'relative', display: 'flex', alignItems: 'center' } as const;

  // Palette swatches plus a custom colour (stored as a plain hex value).
  const colorRow = (kind: 'text' | 'highlight') => {
    const current = kind === 'text' ? textColor : highlight;
    const set = (color: string) => (kind === 'text' ? chain().setColor(color).run() : chain().setHighlight({ color }).run());
    const custom = current && !EDITOR_COLORS.some((c) => c.text === current || c.background === current) ? current : null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <IconBtn icon={mdiInvertColorsOff} title="None" size={16} onClick={() => (kind === 'text' ? chain().unsetColor().run() : chain().unsetHighlight().run())} style={{ border: '1px solid var(--border)', borderRadius: 13, minWidth: 26, height: 26 }} />
        {EDITOR_COLORS.map((c) => {
          const value = kind === 'text' ? c.text : c.background;
          return <button key={c.name} type="button" title={c.label} onMouseDown={(e) => { e.preventDefault(); set(value); }} style={swatch(current === value, value)} />;
        })}
        <button
          type="button"
          title="Custom colour"
          onMouseDown={(e) => { e.preventDefault(); setCustomFor(customFor === kind ? null : kind); }}
          style={{ ...swatch(!!custom || customFor === kind, custom ?? 'transparent'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-main)' }}
        >
          {!custom && <svg width={16} height={16} viewBox="0 0 24 24"><path d={mdiPaletteOutline} fill="currentColor" /></svg>}
        </button>
      </div>
    );
  };
  // The custom colour picker takes the place of both palettes while it is open.
  const customPicker = (kind: 'text' | 'highlight') => {
    const current = kind === 'text' ? textColor : highlight;
    const custom = current && !EDITOR_COLORS.some((c) => c.text === current || c.background === current) ? current : null;
    return (
      <ColorPicker
        initial={custom ?? undefined}
        onApply={(hex) => { if (kind === 'text') chain().setColor(hex).run(); else chain().setHighlight({ color: hex }).run(); setCustomFor(null); }}
        onCancel={() => setCustomFor(null)}
      />
    );
  };

  // Every button (group) by its id; Settings > Toolbar decides which show and in what order.
  const parts: Record<string, ReactNode> = {
    bold: <IconBtn icon={mdiFormatBold} title="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />,
    italic: <IconBtn icon={mdiFormatItalic} title="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />,
    underline: <IconBtn icon={mdiFormatUnderline} title="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()} />,
    strike: <IconBtn icon={mdiFormatStrikethrough} title="Strikethrough" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />,
    code: <IconBtn icon={mdiCodeTags} title="Inline code (code inside a sentence)" active={editor.isActive('code')} onClick={() => chain().toggleCode().run()} />,
    subscript: <IconBtn icon={mdiFormatSubscript} title="Subscript" active={editor.isActive('subscript')} onClick={() => chain().toggleSubscript().run()} />,
    superscript: <IconBtn icon={mdiFormatSuperscript} title="Superscript" active={editor.isActive('superscript')} onClick={() => chain().toggleSuperscript().run()} />,
    math: <IconBtn icon={mdiFunctionVariant} title="Inline math" onClick={() => { setSub(null); requestMathEdit(editor, { mode: 'insert', kind: 'inline', pos: editor.state.selection.from }); }} />,
    outdent: <IconBtn icon={mdiFormatIndentDecrease} title="Outdent (Shift+Tab)" onClick={() => chain().outdentContent().run()} />,
    indent: <IconBtn icon={mdiFormatIndentIncrease} title="Indent (Tab)" onClick={() => chain().indentContent().run()} />,
    ...Object.fromEntries((['highlight', 'textColor'] as const).map((id) => {
      const kind = id === 'textColor' ? 'text' : 'highlight';
      const current = kind === 'text' ? textColor : highlight;
      return [id, (
        <div style={rel}>
          <IconBtn
            icon={kind === 'text' ? mdiFormatColorText : mdiMarker}
            title={kind === 'text' ? 'Text colour' : 'Highlight'}
            active={menu === id}
            style={current ? { color: kind === 'text' ? current : undefined, boxShadow: kind === 'highlight' ? `inset 0 -3px 0 ${current}` : undefined } : undefined}
            onClick={() => toggle(id)}
          />
          <Drop open={menu === id} fixedWidth={262}>
            {customFor === kind ? customPicker(kind) : colorRow(kind)}
          </Drop>
        </div>
      )];
    })),
    fontSize: (
      <>
      <IconBtn icon={mdiMinus} title="Smaller text" onClick={() => setPx(px - 1)} size={16} />
      <div style={rel}>
        <input
          value={sizeText}
          title="Font size in px (Enter to apply)"
          onChange={(e) => setSizeText(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={() => setMenu('size')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const value = parseInt(sizeText, 10);
              if (value) setPx(value);
              setMenu(null);
            } else if (e.key === 'Escape') {
              setSizeText(String(px));
              setMenu(null);
              editor.commands.focus();
            }
          }}
          onBlur={() => setSizeText(String(px))}
          style={{ width: 44, height: 26, textAlign: 'center', fontSize: 13, color: 'var(--text-main)', background: 'transparent', border: '1px solid transparent', borderRadius: 6, outline: 'none' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
        />
        <Drop open={menu === 'size'} width={90}>
          <MenuButton active={!fontSize} onPick={pick(() => chain().unsetFontSize().run())}>Default</MenuButton>
          {EDITOR_FONT_SIZES.map((size) => (
            <MenuButton key={size} active={fontSize === `${size}px`} onPick={pick(() => chain().setFontSize(`${size}px`).run())}>{size}px</MenuButton>
          ))}
        </Drop>
      </div>
      <IconBtn icon={mdiPlus} title="Bigger text" onClick={() => setPx(px + 1)} size={16} />
      </>
    ),
    headings: (
      <>
      <div style={rel}>
        <IconBtn title="Text type" label={<>{level ? `Heading ${level}` : 'Paragraph'}{chevron(menu === 'type')}</>} active={menu === 'type'} onClick={() => toggle('type')} />
        <Drop open={menu === 'type'}>
          <MenuButton active={!level} onPick={pick(() => chain().setParagraph().run())}>Paragraph</MenuButton>
          {([1, 2, 3, 4, 5, 6] as const).map((l) => (
            <MenuButton key={l} active={level === l} onPick={pick(() => chain().setHeading({ level: l }).run())} style={{ fontSize: [20, 18, 16, 15, 14, 12][l - 1], fontWeight: 700 }}>
              Heading {l}
            </MenuButton>
          ))}
        </Drop>
      </div>
      </>
    ),
    font: (
      <>
      <div style={rel}>
        {/* With a selection the font applies to the selected text, otherwise to the whole note. */}
        <IconBtn
          title={hasSelection ? 'Font of the selected text' : 'Font of this note'}
          label={<><span style={{ fontFamily: `var(--font-${shownFont})` }}>{FONT_LABELS[shownFont]}</span>{chevron(menu === 'font')}</>}
          active={menu === 'font'}
          onClick={() => toggle('font')}
        />
        <Drop open={menu === 'font'} width={150}>
          {hasSelection && <MenuButton active={!selectionFont} onPick={pick(() => chain().unsetTextFont().run())} style={{ fontSize: 13 }}>Same as the note</MenuButton>}
          {(Object.keys(FONT_LABELS) as NoteFontChoice[]).map((f) => (
            <MenuButton
              key={f}
              active={hasSelection ? selectionFont === f : noteFont === f}
              onPick={pick(() => (hasSelection ? chain().setTextFont(f).run() : onNoteFont(f)))}
              style={{ fontFamily: `var(--font-${f})`, fontSize: 14 }}
            >
              {FONT_LABELS[f]}
            </MenuButton>
          ))}
        </Drop>
      </div>
      </>
    ),
    bullets: (
      <>
      <IconBtn icon={mdiFormatListBulleted} title="Bullet list" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()} />
      <div style={rel}>
        <IconBtn icon={mdiChevronDown} title="Bullet styles" size={14} style={{ minWidth: 16 }} onClick={() => toggle('bullets')} />
        <Drop open={menu === 'bullets'} width={0}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, auto)', gap: 4 }}>
            {BULLETS.map((b) => <ListTile key={b.style} markers={b.markers} label={b.label} active={editor.isActive('bulletList') && currentBullet === b.style} onPick={pick(() => setBullets(b.style))} />)}
          </div>
        </Drop>
      </div>
      </>
    ),
    numbers: (
      <>
      <IconBtn icon={mdiFormatListNumbered} title="Numbered list" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()} />
      <div style={rel}>
        <IconBtn icon={mdiChevronDown} title="Numbering styles" size={14} style={{ minWidth: 16 }} onClick={() => toggle('numbers')} />
        <Drop open={menu === 'numbers'} width={0}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 4 }}>
            {NUMBERS.map((n) => <ListTile key={n.style} markers={n.markers} label={n.label} active={editor.isActive('orderedList') && currentNumber === n.style} onPick={pick(() => setNumbers(n.style))} />)}
          </div>
        </Drop>
      </div>
      </>
    ),
    tasks: (
      <>
      <IconBtn icon={mdiFormatListCheckbox} title="Task list" active={editor.isActive('taskList')} onClick={() => chain().toggleTaskList().run()} />
      </>
    ),
    link: (
      <>
      <div style={rel}>
        <IconBtn
          icon={mdiLinkPlus}
          title="Insert link"
          active={editor.isActive('link') || menu === 'insertLink'}
          onClick={() => {
            if (menu !== 'insertLink' && editor.state.selection.empty && editor.isActive('link')) editor.commands.extendMarkRange('link');
            toggle('insertLink');
          }}
        />
        <Drop open={menu === 'insertLink'} fixedWidth={300}>
          <InsertLinkDialog editor={editor} embedded onClose={() => setMenu(null)} />
        </Drop>
      </div>
      </>
    ),
    noteLink: (
      <>
      <IconBtn icon={mdiVectorLink} title="Link to note ([[)" onClick={() => chain().insertContent('[[').run()} />
      </>
    ),
    align: (
      <>
      <div style={rel}>
        <IconBtn icon={ALIGN_ICONS[alignment]} title="Alignment" label={chevron(menu === 'align')} active={menu === 'align'} onClick={() => toggle('align')} />
        <Drop open={menu === 'align'} width={0}>
          <div style={{ display: 'flex', gap: 2 }}>
            {(['left', 'center', 'right', 'justify'] as const).map((k) => (
              <IconBtn key={k} icon={ALIGN_ICONS[k]} title={`Align ${k}`} active={alignment === k} onClick={pick(() => (k === 'left' ? chain().unsetTextAlign().run() : chain().setTextAlign(k).run()))} />
            ))}
          </div>
        </Drop>
      </div>
      </>
    ),
    find: onFind ? <IconBtn icon={mdiMagnify} title="Find and replace (Ctrl+F)" onClick={onFind} /> : null,
    // Like the S Pen: dragging on an empty line or under the note starts a drawing there.
    drawMode: (
      <IconBtn
        icon={mdiGesture}
        title={editor.storage.drawing.mouseDraws ? 'Drawing with the mouse: drag on an empty line or under the note (click to stop)' : 'Draw with the mouse'}
        active={editor.storage.drawing.mouseDraws}
        onClick={() => setMouseDraws(editor, !editor.storage.drawing.mouseDraws)}
      />
    ),
  };

  return (
    <div
      ref={ref}
      style={{ position: 'sticky', top: 0, zIndex: 40, overflowX: 'auto', scrollbarWidth: 'thin', backgroundColor: 'var(--bg-base)', borderBottom: '1px solid var(--border)' }}
    >
    {/* One row; scrolls sideways when the window is narrow. Auto margins centre it without
        cutting off its start when it overflows. */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, width: 'max-content', padding: align === 'left' ? '6px 48px' : '6px 8px', margin: align === 'left' ? 0 : '0 auto' }}>
      {toolbarGroups('desktop', toolbarConfig ?? null).map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <Sep />}
          {group.map((part) => (typeof part === 'string' ? <Fragment key={part}>{parts[part]}</Fragment> : (
            <div key={`sub-${gi}`} style={rel}>
              <IconBtn icon={mdiDotsVertical} title="More" active={sub === gi} onClick={() => { setMenu(null); setCustomFor(null); setSub(sub === gi ? null : gi); }} />
              <Drop open={sub === gi} width={0}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, maxWidth: 300 }}>
                  {part.map((id) => <Fragment key={id}>{parts[id]}</Fragment>)}
                </div>
              </Drop>
            </div>
          )))}
        </Fragment>
      ))}

      {bubble && createPortal(<LinkBubble editor={editor} onOpenLink={onOpenLink} onClose={() => setBubble(false)} />, document.body)}
    </div>
    </div>
  );
}

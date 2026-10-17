import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { matchesShortcut } from './shortcuts';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { EDITOR_COLORS, EDITOR_FONT_SIZES, normalizeLinkUrl } from '@noted/editor';
import { Btn, Sep, toolbarStyle, popoverStyle } from './menu-parts';

type Popover = 'type' | 'size' | 'color' | 'align' | 'link' | null;

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const HEADING_PX = [20, 18, 16, 15, 14, 12];
// Used for the first frame, before the real width is measured.
const FALLBACK_WIDTH = 460;

const AlignIcon = ({ kind }: { kind: 'left' | 'center' | 'right' | 'justify' }) => {
  const widths = [14, 9, 14, 9];
  const offset = (w: number) => (kind === 'left' || kind === 'justify' ? 0 : kind === 'center' ? (14 - w) / 2 : 14 - w);
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor">
      {widths.map((w, i) => {
        const width = kind === 'justify' ? 14 : w;
        return <rect key={i} x={1 + (kind === 'justify' ? 0 : offset(w))} y={1 + i * 3.5} width={width} height="1.8" rx="0.9" />;
      })}
    </svg>
  );
};

type Box = { top: number; bottom: number; left: number; right: number };

const textBox = (editor: Editor): Box => {
  const { from, to } = editor.state.selection;
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  return {
    top: Math.min(start.top, end.top),
    bottom: Math.max(start.bottom, end.bottom),
    left: Math.min(start.left, end.left),
    right: Math.max(start.right, end.right),
  };
};

// Bounding box of the selected table cells.
const cellsBox = (editor: Editor): Box => {
  const box = { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity };
  editor.view.dom.querySelectorAll('.selectedCell').forEach((cell) => {
    const rect = cell.getBoundingClientRect();
    box.top = Math.min(box.top, rect.top);
    box.bottom = Math.max(box.bottom, rect.bottom);
    box.left = Math.min(box.left, rect.left);
    box.right = Math.max(box.right, rect.right);
  });
  return Number.isFinite(box.top) ? box : textBox(editor);
};

// Floating toolbar above a text selection: block type, marks, link, colours, alignment.
export function FormatMenu({ editor, onOpenLink, linkEditRequest = 0 }: {
  editor: Editor;
  onOpenLink?: (href: string) => void;
  // Each change opens the link input (the link must already be selected).
  linkEditRequest?: number;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [popover, setPopover] = useState<Popover>(null);
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const [url, setUrl] = useState('');
  const [urlInvalid, setUrlInvalid] = useState(false);
  const selectingRef = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  const showLinkInput = () => {
    setUrl((editor.getAttributes('link').href as string | undefined) ?? '');
    setUrlInvalid(false);
    setPopover('link');
  };

  useEffect(() => {
    const update = () => rerender();
    const onMouseDown = () => { selectingRef.current = true; };
    const onMouseUp = () => {
      if (selectingRef.current) {
        selectingRef.current = false;
        rerender();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, 'insertLink')) return;
      const { selection } = editor.state;
      if (!(selection instanceof TextSelection) || editor.isActive('codeBlock')) return;
      if (selection.empty) {
        // Cursor somewhere inside a link: select the whole link and edit it.
        if (!editor.isActive('link')) return;
        editor.commands.extendMarkRange('link');
      }
      event.preventDefault();
      showLinkInput();
    };
    editor.on('transaction', update);
    editor.on('focus', update);
    editor.on('blur', update);
    editor.view.dom.addEventListener('mousedown', onMouseDown);
    editor.view.dom.addEventListener('keydown', onKeyDown);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.off('transaction', update);
      editor.off('focus', update);
      editor.off('blur', update);
      editor.view.dom.removeEventListener('mousedown', onMouseDown);
      editor.view.dom.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  useEffect(() => {
    if (linkEditRequest) showLinkInput();
  }, [linkEditRequest]);

  const { selection } = editor.state;
  // Several table cells (dragged across, or picked with Select in the table menu).
  const cells = selection instanceof CellSelection;
  const visible =
    ((selection instanceof TextSelection && !selection.empty) || cells) &&
    !editor.isActive('codeBlock') &&
    !selectingRef.current &&
    (editor.isFocused || toolbarFocused);

  useEffect(() => {
    if (!visible && popover) setPopover(null);
  }, [visible, popover]);

  // The toolbar width changes with the block type label, so it is measured, not guessed.
  useLayoutEffect(() => {
    const measured = toolbarRef.current?.offsetWidth;
    if (measured && measured !== width) setWidth(measured);
  });

  if (!visible) return null;

  const box = cells ? cellsBox(editor) : textBox(editor);
  const centerX = (box.left + box.right) / 2;
  let top = box.top - 44;
  if (top < 8) top = box.bottom + 8;
  const left = Math.max(8, Math.min(centerX - width / 2, window.innerWidth - width - 8));

  const level = HEADING_LEVELS.find((l) => editor.isActive('heading', { level: l }));
  const typeLabel = level ? `Heading ${level}` : 'Text';
  const textColor = editor.getAttributes('textStyle').color as string | undefined;
  const fontSize = editor.getAttributes('textStyle').fontSize as string | undefined;
  const toggle = (name: Popover) => setPopover((current) => (current === name ? null : name));

  const applyLink = () => {
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setPopover(null);
      return;
    }
    const href = normalizeLinkUrl(url);
    if (!href) {
      setUrlInvalid(true);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setPopover(null);
  };

  return (
    <div
      ref={toolbarRef}
      style={{ ...toolbarStyle, top, left }}
      onFocusCapture={() => setToolbarFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setToolbarFocused(false);
      }}
    >
      <Btn title="Text type" onClick={() => toggle('type')} active={popover === 'type'}>{typeLabel} ▾</Btn>
      <span style={{ position: 'relative', display: 'flex' }}>
        <Btn title="Font size" onClick={() => toggle('size')} active={popover === 'size'}>{fontSize ? fontSize.replace('px', '') : 'Size'} ▾</Btn>
        {popover === 'size' && (
          <div style={{ ...popoverStyle, top: 'calc(100% + 10px)', minWidth: 0, maxHeight: 300, overflowY: 'auto' }}>
            <Btn title="Default size" active={!fontSize} onClick={() => { editor.chain().focus().unsetFontSize().run(); setPopover(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px' }}>Default</Btn>
            {EDITOR_FONT_SIZES.map((px) => (
              <Btn
                key={px}
                title={`${px} px`}
                active={fontSize === `${px}px`}
                onClick={() => { editor.chain().focus().setFontSize(`${px}px`).run(); setPopover(null); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px' }}
              >
                {px}
              </Btn>
            ))}
          </div>
        )}
      </span>
      <Sep />
      <Btn title="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} style={{ fontWeight: 700 }}>B</Btn>
      <Btn title="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} style={{ fontStyle: 'italic' }}>I</Btn>
      <Btn title="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} style={{ textDecoration: 'underline' }}>U</Btn>
      <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} style={{ textDecoration: 'line-through' }}>S</Btn>
      <Btn title="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</Btn>
      <Btn title="Subscript" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}>x₂</Btn>
      <Btn title="Superscript" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>x²</Btn>
      <Sep />
      {!cells && <Btn title="Link (Ctrl+K)" active={editor.isActive('link') || popover === 'link'} onClick={() => (popover === 'link' ? setPopover(null) : showLinkInput())}>Link</Btn>}
      <Btn title="Colours" active={popover === 'color'} onClick={() => toggle('color')}>
        <span style={{ color: textColor ?? 'var(--text-main)', fontWeight: 700 }}>A</span> ▾
      </Btn>
      <Btn title="Alignment" active={popover === 'align'} onClick={() => toggle('align')}>
        <AlignIcon kind={(['center', 'right', 'justify'] as const).find((k) => editor.isActive({ textAlign: k })) ?? 'left'} /> ▾
      </Btn>

      {popover === 'type' && (
        <div style={popoverStyle}>
          <Btn title="Text" active={!level} onClick={() => { editor.chain().focus().setParagraph().run(); setPopover(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', height: 'auto', padding: '6px 8px' }}>Text</Btn>
          {HEADING_LEVELS.map((l) => (
            <Btn
              key={l}
              title={`Heading ${l}`}
              active={level === l}
              onClick={() => { editor.chain().focus().setHeading({ level: l }).run(); setPopover(null); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', height: 'auto', padding: '4px 8px', fontSize: HEADING_PX[l - 1], fontWeight: 700 }}
            >
              Heading {l}
            </Btn>
          ))}
        </div>
      )}

      {popover === 'color' && (
        <div style={{ ...popoverStyle, minWidth: 230 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 4px 6px' }}>Text colour</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Btn title="Default colour" onClick={() => { editor.chain().focus().unsetColor().run(); setPopover(null); }} style={{ minWidth: 26, height: 26, padding: 0, border: '1px solid var(--border-focus)' }}>⌀</Btn>
            {EDITOR_COLORS.map((c) => (
              <Btn
                key={c.name}
                title={c.label}
                active={textColor === c.text}
                onClick={() => { editor.chain().focus().setColor(c.text).run(); setPopover(null); }}
                style={{ minWidth: 26, height: 26, padding: 0, color: c.text, fontWeight: 700 }}
              >
                A
              </Btn>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 4px 6px' }}>Highlight</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Btn title="No highlight" onClick={() => { editor.chain().focus().unsetHighlight().run(); setPopover(null); }} style={{ minWidth: 26, height: 26, padding: 0, border: '1px solid var(--border-focus)' }}>⌀</Btn>
            {EDITOR_COLORS.map((c) => (
              <Btn
                key={c.name}
                title={c.label}
                active={editor.isActive('highlight', { color: c.background })}
                onClick={() => { editor.chain().focus().setHighlight({ color: c.background }).run(); setPopover(null); }}
                style={{ minWidth: 26, height: 26, padding: 0, backgroundColor: c.background, border: '1px solid var(--border-focus)' }}
              >
                {' '}
              </Btn>
            ))}
          </div>
        </div>
      )}

      {popover === 'align' && (
        <div style={{ ...popoverStyle, display: 'flex', gap: 2, minWidth: 0 }}>
          {(['left', 'center', 'right', 'justify'] as const).map((kind) => (
            <Btn
              key={kind}
              title={`Align ${kind}`}
              active={kind === 'left' ? !(['center', 'right', 'justify'] as const).some((k) => editor.isActive({ textAlign: k })) : editor.isActive({ textAlign: kind })}
              onClick={() => {
                if (kind === 'left') editor.chain().focus().unsetTextAlign().run();
                else editor.chain().focus().setTextAlign(kind).run();
                setPopover(null);
              }}
            >
              <AlignIcon kind={kind} />
            </Btn>
          ))}
        </div>
      )}

      {popover === 'link' && (
        <div style={{ ...popoverStyle, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            autoFocus
            value={url}
            placeholder="Paste or type a link"
            onChange={(e) => { setUrl(e.target.value); setUrlInvalid(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setPopover(null);
                editor.commands.focus();
              }
            }}
            style={{
              width: 220, padding: '6px 8px', fontSize: 13, color: 'var(--text-main)', backgroundColor: 'var(--bg-surface)',
              border: `1px solid ${urlInvalid ? '#ff8a80' : 'var(--border)'}`, borderRadius: 6, outline: 'none', boxShadow: 'none',
            }}
          />
          <Btn title="Apply" onClick={applyLink}>Apply</Btn>
          {onOpenLink && editor.isActive('link') && (
            <Btn title="Open link (Ctrl+click)" onClick={() => onOpenLink((editor.getAttributes('link').href as string | undefined) ?? '')}>Open</Btn>
          )}
          {editor.isActive('link') && (
            <Btn title="Remove link" danger onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setPopover(null); }}>Remove</Btn>
          )}
        </div>
      )}
    </div>
  );
}

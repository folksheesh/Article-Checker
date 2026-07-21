import { useEffect, useImperativeHandle, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { HighlightMark } from './HighlightMark';

export type ToolbarAction = 'bold' | 'italic' | 'underline' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'quote' | 'link' | 'image' | 'align-left' | 'align-center' | 'align-right' | 'align-justify';

export type ActiveStyleState = {
  h1?: boolean;
  h2?: boolean;
  h3?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  'align-left'?: boolean;
  'align-center'?: boolean;
  'align-right'?: boolean;
  'align-justify'?: boolean;
  bullet?: boolean;
  number?: boolean;
  quote?: boolean;
  link?: boolean;
};

export interface TipTapEditorHandle {
  getHTML: () => string;
  setContent: (html: string) => void;
  focus: () => void;
  execAction: (action: ToolbarAction) => void;
  isActive: (name: string, attrs?: Record<string, unknown>) => boolean;
  getEditorEl: () => HTMLElement | null;
  insertImage: (attrs: { src: string; alt?: string; width?: number }) => void;
}

interface Props {
  initialContent: string;
  onUpdate: (html: string) => void;
  onActiveStylesChange?: (styles: ActiveStyleState) => void;
  onEditorClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onEditorMouseOver?: (e: React.MouseEvent<HTMLDivElement>) => void;
  placeholder?: string;
}

const STYLE_MARKS = {
  strong: /font-weight:\s*(700|bold|600|800|900)/i,
  em: /font-style:\s*italic/i,
  u: /text-decoration:\s*underline/i,
  s: /text-decoration:\s*line-through/i,
};

const ALIGNMENT = /text-align:\s*(left|center|right|justify)/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createTextWithBreaks(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (i > 0 && part) {
      fragment.appendChild(document.createElement('br'));
    }
    if (part) {
      fragment.appendChild(document.createTextNode(part));
    }
  });
  return fragment;
}

function isStyled(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return false;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const style = el.getAttribute('style') || '';

  // Google Docs wrapper tags that don't add real styling
  if ((tag === 'b' || tag === 'strong') && /font-weight:\s*(normal|400)\b/i.test(style)) return false;
  if ((tag === 'i' || tag === 'em') && /font-style:\s*normal/i.test(style)) return false;
  if (tag === 'u' && /text-decoration:\s*none/i.test(style)) return false;

  const styledTags = ['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'br'];
  if (styledTags.includes(tag)) return true;
  if (tag === 'p' || tag === 'div') {
    if (ALIGNMENT.test(style)) return true;
  }
  if (tag === 'span') {
    if (Object.values(STYLE_MARKS).some((re) => re.test(style))) return true;
  }
  for (const child of Array.from(el.childNodes)) {
    if (isStyled(child)) return true;
  }
  return false;
}

function sanitizePastedHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const allowed = new Set(['p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'ul', 'ol', 'li', 'blockquote', 'a', 'span']);

  function clean(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return createTextWithBreaks(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as HTMLElement;
    let tag = el.tagName.toLowerCase();
    const style = el.getAttribute('style') || '';
    const attrs: Record<string, string> = {};

    if (!allowed.has(tag)) {
      const fragment = document.createDocumentFragment();
      el.childNodes.forEach((child) => {
        const cleaned = clean(child);
        if (cleaned) fragment.appendChild(cleaned);
      });
      return fragment;
    }

    if (tag === 'h4' || tag === 'h5' || tag === 'h6') tag = 'h3';

    const isBoldTag = tag === 'b' || tag === 'strong';
    const isItalicTag = tag === 'i' || tag === 'em';
    const isUnderlineTag = tag === 'u';
    const isStrikeTag = tag === 's' || tag === 'strike';

    const styleNegatesTag =
      (isBoldTag && /font-weight:\s*(normal|400)\b/i.test(style)) ||
      (isItalicTag && /font-style:\s*normal/i.test(style)) ||
      (isUnderlineTag && /text-decoration:\s*none/i.test(style)) ||
      (isStrikeTag && /text-decoration:\s*none/i.test(style));

    if (styleNegatesTag) {
      const fragment = document.createDocumentFragment();
      el.childNodes.forEach((child) => {
        const cleaned = clean(child);
        if (cleaned) fragment.appendChild(cleaned);
      });
      return fragment;
    }

    if (tag === 'b') tag = 'strong';
    if (tag === 'i') tag = 'em';

    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) attrs.href = href;
    }

    if (tag === 'p' || tag === 'div') {
      const align = style.match(ALIGNMENT);
      if (align) attrs.style = `text-align: ${align[1]}`;
    }

    if (tag === 'span') {
      if (STYLE_MARKS.strong.test(style)) tag = 'strong';
      else if (STYLE_MARKS.em.test(style)) tag = 'em';
      else if (STYLE_MARKS.u.test(style)) tag = 'u';
      else if (STYLE_MARKS.s.test(style)) tag = 's';
      else {
        const fragment = document.createDocumentFragment();
        el.childNodes.forEach((child) => {
          const cleaned = clean(child);
          if (cleaned) fragment.appendChild(cleaned);
        });
        return fragment;
      }
    }

    const newEl = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => newEl.setAttribute(k, v));
    el.childNodes.forEach((child) => {
      const cleaned = clean(child);
      if (cleaned) newEl.appendChild(cleaned);
    });
    return newEl;
  }

  const fragment = document.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach((child) => {
    const cleaned = clean(child);
    if (cleaned) fragment.appendChild(cleaned);
  });

  const tmp = document.createElement('div');
  tmp.appendChild(fragment);
  return tmp.innerHTML;
}

export const TipTapEditor = forwardRef<TipTapEditorHandle, Props>(({ initialContent, onUpdate, onActiveStylesChange, onEditorClick, onEditorMouseOver, placeholder }, ref) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: placeholder || 'Mulai menulis artikel Anda di sini...' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      HighlightMark,
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getHTML());
    },
    onSelectionUpdate: ({ editor }) => {
      if (!onActiveStylesChange) return;
      onActiveStylesChange({
        h1: editor.isActive('heading', { level: 1 }),
        h2: editor.isActive('heading', { level: 2 }),
        h3: editor.isActive('heading', { level: 3 }),
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        'align-left': editor.isActive({ textAlign: 'left' }),
        'align-center': editor.isActive({ textAlign: 'center' }),
        'align-right': editor.isActive({ textAlign: 'right' }),
        'align-justify': editor.isActive({ textAlign: 'justify' }),
        bullet: editor.isActive('bulletList'),
        number: editor.isActive('orderedList'),
        quote: editor.isActive('blockquote'),
        link: editor.isActive('link'),
      });
    },
    editorProps: {
      attributes: {
        class: 'editor-surface w-full h-full outline-none text-[15px] leading-relaxed text-surface-800',
      },
      handleDOMEvents: {
        mouseover: (_view, event) => {
          if (onEditorMouseOver) {
            onEditorMouseOver(event as unknown as React.MouseEvent<HTMLDivElement>);
          }
          return false;
        },
      },
      handlePaste: (view, event) => {
        const html = event.clipboardData?.getData('text/html');
        const text = event.clipboardData?.getData('text/plain');

        if (html) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const isStyledContent = Array.from(doc.body.childNodes).some(isStyled);

          if (isStyledContent) {
            event.preventDefault();
            const sanitized = sanitizePastedHtml(html);
            editor?.chain().focus().insertContent(sanitized).run();
            return true;
          }
        }

        if (text) {
          event.preventDefault();
          // Convert plain text with paragraph breaks to proper HTML
          const blocks = text.split(/\n{2,}/).filter(Boolean);
          if (blocks.length > 1) {
            const html = blocks
              .map((block) => {
                const lines = block.split('\n');
                if (lines.length <= 1) return `<p>${escapeHtml(lines[0])}</p>`;
                return `<p>${lines.map((l) => escapeHtml(l)).join('<br>')}</p>`;
              })
              .join('');
            editor?.chain().focus().insertContent(html).run();
          } else if (text.includes('\n')) {
            const lines = text.split('\n');
            const html = `<p>${lines.map((l) => escapeHtml(l)).join('<br>')}</p>`;
            editor?.chain().focus().insertContent(html).run();
          } else {
            view.dispatch(view.state.tr.insertText(text));
          }
          return true;
        }

        return false;
      },
    },
  });

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() || '',
    setContent: (html: string) => editor?.commands.setContent(html, { emitUpdate: false }),
    focus: () => editor?.commands.focus(),
    execAction: (action: ToolbarAction) => {
      if (!editor) return;
      const chain = editor.chain().focus();
      switch (action) {
        case 'bold': chain.toggleBold().run(); break;
        case 'italic': chain.toggleItalic().run(); break;
        case 'underline': chain.toggleUnderline().run(); break;
        case 'h1': chain.toggleHeading({ level: 1 }).run(); break;
        case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
        case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
        case 'bullet': chain.toggleBulletList().run(); break;
        case 'number': chain.toggleOrderedList().run(); break;
        case 'quote': chain.toggleBlockquote().run(); break;
        case 'link': {
          const url = window.prompt('Masukkan URL:', 'https://');
          if (url) chain.setLink({ href: url }).run();
          break;
        }
        case 'align-left': chain.setTextAlign('left').run(); break;
        case 'align-center': chain.setTextAlign('center').run(); break;
        case 'align-right': chain.setTextAlign('right').run(); break;
        case 'align-justify': chain.setTextAlign('justify').run(); break;
      }
    },
    isActive: (name: string, attrs?: Record<string, unknown>) => editor?.isActive(name, attrs) ?? false,
    getEditorEl: () => editor?.view.dom ?? null,
    insertImage: (attrs) => {
      editor?.chain().focus().setImage({ src: attrs.src }).run();
    },
  }), [editor]);

  useEffect(() => {
    if (editor && initialContent && editor.getHTML() !== initialContent) {
      editor.commands.setContent(initialContent, { emitUpdate: false });
    }
  }, [editor, initialContent]);

  if (!editor) return null;

  return (
    <div onClick={onEditorClick} onMouseOver={onEditorMouseOver}>
      <EditorContent editor={editor} />
    </div>
  );
});

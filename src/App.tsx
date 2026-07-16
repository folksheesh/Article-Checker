import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Upload,
  BookOpen,
  CheckCircle2,
  XCircle,
  AlertCircle,

  Sparkles,
  BrainCircuit,
  Target,
  Scale,
  Loader,
  Image as ImageIcon,
  Bot,
  RotateCcw,
} from 'lucide-react';
import { runSopChecks, evaluateWithAI, autoReviseItem, callOllamaGenerateKeyword, type CheckResult, type SopReport } from './sop';
import { callArticleChat } from './sop/articleChat';
import { OLLAMA_API_KEY } from './sop/config';

const CATEGORIES = [
  { id: 'title', label: 'Judul', checks: [1, 2] },
  { id: 'lead', label: 'Lead', checks: [3, 4] },
  { id: 'paragraph', label: 'Paragraf', checks: [8, 17, 20] },
  { id: 'heading', label: 'Heading', checks: [7, 18] },
  { id: 'body', label: 'Isi Tubuh', checks: [5, 6, 12] },
  { id: 'language', label: 'Bahasa', checks: [9, 11, 19] },
  { id: 'cta', label: 'CTA', checks: [10] },
  { id: 'seo', label: 'SEO & Meta', checks: [13, 14, 15, 16] },
];

const SUGGESTED_LABELS: Record<number, string> = {
  3: 'Buat lead 2 kalimat / ~12 kata yang langsung ke inti masalah.',
  4: 'Tambahkan alasan mengapa masalah ini penting/urgent di paragraf setelah lead.',
  8: 'Pecah paragraf panjang menjadi maksimal 3 kalimat per paragraf.',
  10: 'Tambahkan ajakan bertindak (CTA) yang persuasif di akhir artikel.',
  13: 'Tambahkan minimal 2 link internal dan 3 artikel terkait.',
  14: 'Isi meta title dan meta description agar siap tampil di Google.',
  15: 'Gambar tidak didukung di editor ini, pengecekan alt text diabaikan.',
  17: 'Pecah kalimat panjang menjadi 2 kalimat agar lebih mudah dibaca.',
  20: 'Panjang artikel idealnya 1000–1500 kata.',
};

function markdownToHtml(md: string): string {
  if (!md.trim()) return '';

  // Normalize line endings
  let html = md.replace(/\r\n/g, '\n');

  // Protect existing <mark> tags from HTML escaping (used for highlights)
  const markTags: string[] = [];
  html = html.replace(/<mark\b[^>]*>.*?<\/mark>/gs, (m) => {
    markTags.push(m);
    return `%%%MARK${markTags.length - 1}%%%`;
  });

  // Escape HTML special chars in text first, then selectively restore formatting
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Images (must be before links: ![alt](url) contains [text](url) pattern)
  html = html.replace(/!\[(.*?)\]\((.*?)\s+"(\d+)"\)/g, '<img src="$2" alt="$1" width="$3" style="max-width:100%;border-radius:8px;" />');
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;" />');

  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="editor-link">$1</a>');
  // Strip bare image file references (not markdown images)
  html = html
    .replace(/\([^)]*\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)(?:\?[^)]*)?\)/gi, '')
    .replace(/\b\w+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)\b/gi, '');

  // Bold & italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.*?)__/g, '<u>$1</u>');

  // Headings
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Blockquote
  html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

  // Lists - simple line-by-line
  const lines = html.split('\n');
  let inList: 'ul' | 'ol' | null = null;
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);

    if (ulMatch) {
      if (inList !== 'ul') {
        if (inList) out.push(`</${inList}>`);
        out.push('<ul>');
        inList = 'ul';
      }
      out.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (inList !== 'ol') {
        if (inList) out.push(`</${inList}>`);
        out.push('<ol>');
        inList = 'ol';
      }
      out.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inList) {
        out.push(`</${inList}>`);
        inList = null;
      }
      if (trimmed === '') {
        out.push('<br />');
      } else {
        out.push(`<p>${line}</p>`);
      }
    }
  }
  if (inList) out.push(`</${inList}>`);

  let finalHtml = out.join('\n');

  // Restore protected <mark> tags
  finalHtml = finalHtml.replace(/%%%MARK(\d+)%%%/g, (_, i) => markTags[parseInt(i)]);

  return finalHtml;
}

function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';

  const div = document.createElement('div');
  div.innerHTML = html;

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes)
      .map(walk)
      .join('')
      .trim();

    switch (tag) {
      case 'h1':
        return `\n# ${children}\n`;
      case 'h2':
        return `\n## ${children}\n`;
      case 'h3':
        return `\n### ${children}\n`;
      case 'h4':
      case 'h5':
      case 'h6':
        return `\n### ${children}\n`;
      case 'strong':
      case 'b':
        return `**${children}**`;
      case 'em':
      case 'i':
        return `*${children}*`;
      case 'u':
        return `__${children}__`;
      case 'a':
        return `[${children}](${el.getAttribute('href') || '#'})`;
      case 'br':
        return '\n';
      case 'li':
        return children;
      case 'ul':
        return (
          '\n' +
          Array.from(el.children)
            .map((li) => `- ${walk(li).trim()}`)
            .join('\n') +
          '\n'
        );
      case 'ol':
        return (
          '\n' +
          Array.from(el.children)
            .map((li, i) => `${i + 1}. ${walk(li).trim()}`)
            .join('\n') +
          '\n'
        );
      case 'blockquote':
        return `\n> ${children}\n`;
      case 'p':
      case 'div':
        return `${children}\n`;
      case 'img':
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || '';
        const w = el.getAttribute('width') || el.style.width;
        const wNum = w ? String(w).replace('px', '') : '';
        return wNum ? `![${alt}](${src} "${wNum}")\n` : `![${alt}](${src})\n`;
      case 'mark':
        return children;
      default:
        return children;
    }
  }

  return walk(div)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findTextMatch(text: string, query: string): { start: number; end: number } | null {
  if (!query) return null;
  const q = query.replace(/\s+/g, ' ').trim();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tryMatch = (str: string): { start: number; end: number } | null => {
    const escaped = esc(str).replace(/ /g, '\\s+');
    const re = new RegExp(escaped, 'i');
    const m = re.exec(text);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  };

  let r = tryMatch(q);
  if (r) return r;

  const clean = q.replace(/[.!?,;:]+$/g, '');
  if (clean.length > 10) { r = tryMatch(clean); if (r) return r; }

  const firstSen = q.split(/[.!?]/)[0];
  if (firstSen && firstSen.length > 10) { r = tryMatch(firstSen); if (r) return r; }

  return null;
}

function getTextContent(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function getStatusConfig(report: SopReport) {
  const { label } = report.status;
  if (label === 'HIJAU') {
    return {
      label: 'Layak Publish',
      desc: 'Artikel memenuhi standar SOP.',
      color: 'text-emerald-700',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
    };
  }
  if (label === 'KUNING') {
    return {
      label: 'Revisi Minor',
      desc: 'Beberapa poin kecil perlu diperbaiki.',
      color: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
    };
  }
  return {
    label: 'Revisi Besar',
    desc: 'Artikel butuh perbaikan signifikan.',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
  };
}

function getCategoryStatus(report: SopReport, categoryId: string) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return 'passed';
  const items = report.items.filter((item) => cat.checks.includes(item.id));
  if (items.some((item) => item.status === 'failed')) return 'failed';
  if (items.some((item) => item.status === 'deferred')) return 'deferred';
  return 'passed';
}

function getCategoryIssue(report: SopReport, categoryId: string) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return null;
  return report.items.find((item) => cat.checks.includes(item.id) && item.status === 'failed');
}

function generateSummary(report: SopReport) {
  const failedCategories = CATEGORIES.filter((c) => getCategoryStatus(report, c.id) === 'failed');
  if (failedCategories.length === 0) {
    return 'Semua poin kualitas sudah terpenuhi. Artikel siap diterbitkan.';
  }
  const issueNames = failedCategories.map((c) => c.label);
  return `Ditemukan ${failedCategories.length} area yang perlu diperbaiki: ${issueNames.join(', ')}.`;
}

function findTextNodeAndOffset(container: HTMLElement, globalOffset: number): [Node, number] | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let currentOffset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textLength = node.textContent?.length || 0;
    if (currentOffset + textLength >= globalOffset) {
      return [node, globalOffset - currentOffset];
    }
    currentOffset += textLength;
  }
  return null;
}

export default function App() {
  const [article, setArticle] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [keyword, setKeyword] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDesc, setMetaDesc] = useState('');
  const [liveReport, setLiveReport] = useState<SopReport | null>(null);
  const [report, setReport] = useState<SopReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResults, setAiResults] = useState<CheckResult[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; issue: CheckResult } | null>(null);
  const [fixingId, setFixingId] = useState<number | null>(null);
  const [flashText, setFlashText] = useState('');
  const [showKwPopup, setShowKwPopup] = useState(false);
  const [kwGenLoading, setKwGenLoading] = useState(false);
  const [kwGenError, setKwGenError] = useState('');
  const [showPassedIssues, setShowPassedIssues] = useState(false);
  const selectedImgRef = useRef<HTMLImageElement | null>(null);
  const [selectedImgInfo, setSelectedImgInfo] = useState<{ width: number; align: string; x: number; y: number; maxWidth: number } | null>(null);
  const hoverTargetRef = useRef<HTMLElement | null>(null);
  const hoverRef = useRef<typeof hover>(null);
  hoverRef.current = hover;
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string; type?: 'article' | 'answer' }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const stripImages = (text: string) => text
    .replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\([^)]*\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)(?:\?[^)]*)?\)/gi, '')
    .replace(/\[[^\]]*\]:\s*\S+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)/gi, '')
    .replace(/\b\w+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)\b/gi, '')
    .trim();

  const editorRef = useRef<HTMLDivElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const undoStackRef = useRef<{ article: string; keyword: string; metaTitle: string; metaDesc: string }[]>([]);
  const redoStackRef = useRef<{ article: string; keyword: string; metaTitle: string; metaDesc: string }[]>([]);
  const lastUndoRef = useRef(0);

  const pushUndo = () => {
    undoStackRef.current.push({ article, keyword, metaTitle, metaDesc });
    if (undoStackRef.current.length > 20) undoStackRef.current.shift();
    redoStackRef.current = [];
  };

  const handleUndo = () => {
    const cur = undoStackRef.current.pop();
    if (!cur) return;
    redoStackRef.current.push({ article, keyword, metaTitle, metaDesc });
    setHover(null);
    setKeyword(cur.keyword);
    setMetaTitle(cur.metaTitle);
    setMetaDesc(cur.metaDesc);
    setArticleFromMarkdown(cur.article);
    const restored = runSopChecks({
      article: cur.article,
      keyword: cur.keyword,
      metaTitle: cur.metaTitle,
      metaDesc: cur.metaDesc,
    });
    setLiveReport(restored);
    setReport(restored);
    requestAnimationFrame(() => applyHighlights(restored));
  };

  const handleRedo = () => {
    const cur = redoStackRef.current.pop();
    if (!cur) return;
    undoStackRef.current.push({ article, keyword, metaTitle, metaDesc });
    setHover(null);
    setKeyword(cur.keyword);
    setMetaTitle(cur.metaTitle);
    setMetaDesc(cur.metaDesc);
    setArticleFromMarkdown(cur.article);
    const restored = runSopChecks({
      article: cur.article,
      keyword: cur.keyword,
      metaTitle: cur.metaTitle,
      metaDesc: cur.metaDesc,
    });
    setLiveReport(restored);
    setReport(restored);
    requestAnimationFrame(() => applyHighlights(restored));
  };

  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedoRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const update = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      let img: HTMLImageElement | null = null;
      let n = sel.anchorNode;
      if (n && n.nodeType === Node.TEXT_NODE && n.parentElement) n = n.parentElement;
      if (n && (n as HTMLElement).tagName === 'IMG') img = n as HTMLImageElement;
      if (!img) {
        const r = sel.getRangeAt(0);
        if (r.startContainer === r.endContainer && r.startOffset + 1 === r.endOffset) {
          const c = r.startContainer.childNodes[r.startOffset];
          if (c && (c as HTMLElement).tagName === 'IMG') img = c as HTMLImageElement;
        }
      }
      if (img && editor.contains(img)) {
        selectedImgRef.current = img;
      }
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener('mouseup', update);
    return () => { document.removeEventListener('selectionchange', update); document.removeEventListener('mouseup', update); };
  }, []);

  // Scroll listener to reposition the image toolbar
  useEffect(() => {
    const el = editorWrapperRef.current;
    if (!el) return;
    const onScroll = () => {
      const img = selectedImgRef.current;
      if (!img || !document.contains(img)) { selectedImgRef.current = null; setSelectedImgInfo(null); return; }
      const rect = img.getBoundingClientRect();
      setSelectedImgInfo((prev) => prev ? { ...prev, x: rect.left + rect.width / 2, y: rect.top - 48 } : null);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll listener to reposition the hover popup
  useEffect(() => {
    const el = editorWrapperRef.current;
    if (!el) return;
    const onScroll = () => {
      const target = hoverTargetRef.current;
      if (!target || !document.contains(target)) { hoverTargetRef.current = null; return; }
      const rect = target.getBoundingClientRect();
      setHover((prev) => {
        if (!prev) return null;
        const y = rect.top - 60 < 0 ? rect.bottom + 8 : rect.top - 48;
        return { ...prev, x: rect.left + rect.width / 2, y };
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!article.trim()) {
      setLiveReport(null);
      return;
    }
    const next = runSopChecks({ article, keyword, metaTitle, metaDesc });
    setLiveReport(next);
  }, [article, keyword, metaTitle, metaDesc]);

  useEffect(() => {
    if (!article.trim()) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [article]);

  const score = useMemo(() => {
    if (!report) return 0;
    return Math.round((report.score / report.scoredTotal) * 100);
  }, [report]);

  const statusConfig = useMemo(() => (report ? getStatusConfig(report) : null), [report]);

  const wordCount = useMemo(() => {
    return getTextContent(htmlContent)
      .split(/\s+/)
      .filter(Boolean).length;
  }, [htmlContent]);

  const syncFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const html = editor.innerHTML;
    setHtmlContent(html);
    setArticle(htmlToMarkdown(html));
    const now = Date.now();
    if (now - lastUndoRef.current > 400) {
      lastUndoRef.current = now;
      pushUndo();
    }
  };

  const setEditorHtml = (html: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = html;
  };

  const setArticleFromMarkdown = (md: string) => {
    setArticle(md);
    const html = markdownToHtml(md);
    setHtmlContent(html);
    setEditorHtml(html);
  };

  const handleToolbar = (action: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    switch (action) {
      case 'h1':
        document.execCommand('formatBlock', false, 'H1');
        break;
      case 'h2':
        document.execCommand('formatBlock', false, 'H2');
        break;
      case 'h3':
        document.execCommand('formatBlock', false, 'H3');
        break;
      case 'bold':
        document.execCommand('bold');
        break;
      case 'italic':
        document.execCommand('italic');
        break;
      case 'underline':
        document.execCommand('underline');
        break;
      case 'bullet':
        document.execCommand('insertUnorderedList');
        break;
      case 'number':
        document.execCommand('insertOrderedList');
        break;
      case 'quote':
        document.execCommand('formatBlock', false, 'blockquote');
        break;
      case 'link': {
        const url = window.prompt('Masukkan URL:', 'https://');
        if (url) document.execCommand('createLink', false, url);
        break;
      }
    }

    syncFromEditor();
  };

  const handleEditorInput = () => {
    syncFromEditor();
  };

  const handleEditorPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    syncFromEditor();
  };

  const showIssuePopup = (target: HTMLElement) => {
    if (target.tagName !== 'MARK' || !target.dataset.issueId) return;
    const issueId = Number(target.dataset.issueId);
    const issue =
      liveReport?.items.find((item) => item.id === issueId) ??
      aiResults?.find((item) => item.id === issueId);
    if (!issue) return;
    hoverTargetRef.current = target;
    const rect = target.getBoundingClientRect();
    const y = rect.top - 60 < 0 ? rect.bottom + 8 : rect.top - 48;
    setHover({
      x: rect.left + rect.width / 2,
      y,
      issue,
    });
  };

  const scheduleHide = () => {
    clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => { hoverTargetRef.current = null; setHover(null); }, 300);
  };

  const handleEditorMouseOver = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (hover && target.closest('.issue-popup')) {
      clearTimeout(hideTimeoutRef.current);
      return;
    }
    if (target.tagName === 'MARK' && target.dataset.issueId) {
      clearTimeout(hideTimeoutRef.current);
      showIssuePopup(target);
    } else if (hover) {
      scheduleHide();
    }
  };

  // Native mousedown → image toolbar (more reliable than synthetic onClick)
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const handleNativeClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement;
        selectedImgRef.current = img;
        const rect = img.getBoundingClientRect();
        const wrapper = editorWrapperRef.current;
        const maxW = wrapper?.clientWidth ?? 800;
        const y = rect.top - 48 < 10 ? rect.bottom + 10 : rect.top - 48;
        setSelectedImgInfo({
          width: Math.round(rect.width),
          align: img.style.display === 'block' && img.style.marginLeft === 'auto' && img.style.marginRight === 'auto' ? 'center'
            : img.style.display === 'block' && img.style.marginLeft === 'auto' ? 'right'
            : 'inline',
          x: rect.left + rect.width / 2,
          y,
          maxWidth: maxW,
        });
      }
    };
    el.addEventListener('mousedown', handleNativeClick);
    return () => el.removeEventListener('mousedown', handleNativeClick);
  }, []);

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'MARK' && target.dataset.issueId) {
      showIssuePopup(target);
    }
  };

  const applyHighlights = (reportOverride?: SopReport) => {
    const editor = editorRef.current;
    let reportToApply = reportOverride ?? liveReport;
    if (!editor || !reportToApply) return;

    // Always include AI results in highlights if available (exclude case issues, id 56)
    if (!reportOverride && aiResults) {
      const failedAi = aiResults.filter(
        (r) => r.status === 'failed' && r.problematic_text?.trim().length > 0 && r.id !== 56,
      );
      if (failedAi.length > 0) {
        reportToApply = {
          ...reportToApply,
          items: [...reportToApply.items, ...failedAi],
        };
      }
    }

    // Save selection as text offset
    const selection = window.getSelection();
    let offsetBefore = 0;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const preRange = range.cloneRange();
      preRange.selectNodeContents(editor);
      preRange.setEnd(range.startContainer, range.startOffset);
      offsetBefore = preRange.toString().length;
    }

    const md = htmlToMarkdown(editor.innerHTML);
    const issues = reportToApply.items.filter(
      (item) => item.problematic_text?.trim().length > 0,
    );

    let highlightedMd = md;
    const ranges: { start: number; end: number; issue: CheckResult }[] = [];
    for (const issue of issues) {
      const m = findTextMatch(highlightedMd, issue.problematic_text);
      if (m) {
        ranges.push({ start: m.start, end: m.end, issue });
      }
    }
    ranges.sort((a, b) => a.start - b.start);

    let result = '';
    let lastEnd = 0;
    for (const range of ranges) {
      if (range.start < lastEnd) continue;
      result += highlightedMd.slice(lastEnd, range.start);
      const safeReason = range.issue.reason.replace(/"/g, '&quot;');
      const safeLabel = range.issue.question.replace(/"/g, '&quot;');
      let cls: string;
      if (range.issue.source === 'ai') {
        cls = range.issue.status === 'passed' ? 'issue-highlight-passed' : 'issue-highlight-ai';
      } else {
        cls = range.issue.status === 'passed' ? 'issue-highlight-passed' : 'issue-highlight';
      }
      result += `<mark class="${cls}" data-issue-id="${range.issue.id}" data-reason="${safeReason}" data-label="${safeLabel}">${highlightedMd.slice(
        range.start,
        range.end,
      )}</mark>`;
      lastEnd = range.end;
    }
    result += highlightedMd.slice(lastEnd);

    const newHtml = markdownToHtml(result);
    setHtmlContent(newHtml);
    editor.innerHTML = newHtml;

    // Restore selection
    const restore = findTextNodeAndOffset(editor, offsetBefore);
    if (restore && selection) {
      const [node, offset] = restore;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const focusIssue = (issue: CheckResult | null) => {
    const editor = editorRef.current;
    if (!editor || !issue?.problematic_text) return;

    // Try to find problematic text in editor content
    const text = getTextContent(editor.innerHTML);
    const m = findTextMatch(text, issue.problematic_text);

    if (m) {
      editor.focus();
      const start = findTextNodeAndOffset(editor, m.start);
      const end = findTextNodeAndOffset(editor, m.end);
      if (start && end) {
        const range = document.createRange();
        range.setStart(start[0], start[1]);
        range.setEnd(end[0], end[1]);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const mark = range.startContainer.parentElement?.closest('mark');
        if (mark) {
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    } else {
      // Fallback: try finding any <mark> with matching data-reason or scroll to editor
      const marks = editor.querySelectorAll('mark');
      const match = Array.from(marks).find((m) =>
        m.getAttribute('data-label')?.includes(issue.question) ||
        m.getAttribute('data-reason')?.includes(issue.reason.slice(0, 40))
      );
      if (match) {
        match.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.getSelection()?.removeAllRanges();
      } else {
        editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    setFlashText(issue.problematic_text);
    setTimeout(() => setFlashText(''), 1200);
    // Position popup near the found text
    const foundMark = editor.querySelector(`mark[data-issue-id="${issue.id}"]`) as HTMLElement | null;
    if (foundMark) {
      hoverTargetRef.current = foundMark;
      const rect = foundMark.getBoundingClientRect();
      const y = rect.top - 60 < 0 ? rect.bottom + 8 : rect.top - 48;
      setHover({
        x: rect.left + rect.width / 2,
        y,
        issue,
      });
    } else if (m) {
      // Position near the text selection regardless of mark
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const y = rect.top - 60 < 0 ? rect.bottom + 8 : rect.top - 48;
        setHover({
          x: rect.left + rect.width / 2,
          y,
          issue,
        });
      } else {
        setHover({ x: editor.clientWidth / 2, y: 100, issue });
      }
    } else {
      setHover({ x: editor.clientWidth / 2, y: 100, issue });
    }
    setTimeout(() => { hoverTargetRef.current = null; setHover(null); }, 4000);
  };

  const handleAutoCorrect = async (item: CheckResult) => {
    pushUndo();
    setFixingId(item.id);
    try {
      const result = await autoReviseItem(
        { article: stripImages(article), keyword, metaTitle, metaDesc },
        item,
        '',
      );
      const updatedKeyword = result.keyword || keyword;
      const updatedTitle = result.metaTitle || metaTitle;
      const updatedDesc = result.metaDesc || metaDesc;
      setArticleFromMarkdown(result.article);
      if (result.keyword) setKeyword(result.keyword);
      if (result.metaTitle) setMetaTitle(result.metaTitle);
      if (result.metaDesc) setMetaDesc(result.metaDesc);
      setHover(null);
      // Re-check and re-apply highlights immediately with the corrected content
      const newReport = runSopChecks({
        article: result.article,
        keyword: updatedKeyword,
        metaTitle: updatedTitle,
        metaDesc: updatedDesc,
      });
      setLiveReport(newReport);
      setReport(newReport);
      requestAnimationFrame(() => applyHighlights(newReport));
    } catch {
      setHover(null);
    } finally {
      setFixingId(null);
    }
  };

  const handleAutoCorrectCase = (item: CheckResult) => {
    const text = item.problematic_text;
    if (!text) return;
    pushUndo();
    const editor = editorRef.current;
    if (!editor) return;

    // Find the text in the markdown article and fix the case
    const md = htmlToMarkdown(editor.innerHTML);
    const m = findTextMatch(md, text);
    if (!m) return;

    const before = md.slice(Math.max(0, m.start - 3), m.start);
    const isStartOfSentence = m.start === 0 || /[.!?]\s+$/.test(before) || /^\s+$/.test(before) || /^\n+$/.test(before);
    const isAllUpper = text === text.toUpperCase() && text.length > 1;
    let corrected: string;
    if (isStartOfSentence) {
      corrected = text.charAt(0).toUpperCase() + text.slice(1);
    } else if (isAllUpper && text.length > 2) {
      corrected = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    } else {
      corrected = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    }
    if (corrected === text) {
      corrected = text.toLowerCase();
      if (corrected === text) return;
    }

    const newMd = md.slice(0, m.start) + corrected + md.slice(m.end);
    setArticleFromMarkdown(newMd);
    setHover(null);
    const newReport = runSopChecks({ article: newMd, keyword, metaTitle, metaDesc });
    setLiveReport(newReport);
    setReport(newReport);
    requestAnimationFrame(() => applyHighlights(newReport));
  };

  const handleGenerateKeyword = async () => {
    setKwGenLoading(true);
    setKwGenError('');
    try {
      const kw = await callOllamaGenerateKeyword(OLLAMA_API_KEY, stripImages(article));
      if (kw) {
        setKeyword(kw);
        setShowKwPopup(false);
      } else {
        setKwGenError('Gagal menghasilkan keyword. Coba lagi.');
      }
    } catch {
      setKwGenError('Gagal terhubung ke AI. Pastikan Ollama berjalan.');
    } finally {
      setKwGenLoading(false);
    }
  };

  const runAnalysis = () => {
    setIsAnalyzing(true);
    setAiLoading(true);
    setAiResults(null);
    const sopReport = liveReport;
    window.setTimeout(() => {
      applyHighlights();
      setReport(liveReport);
      setIsAnalyzing(false);
    }, 300);

    evaluateWithAI(
      {
        article: stripImages(article),
        keyword,
        metaTitle,
        metaDesc,
      },
      '',
    )
      .then((results) => {
        const allDeferred = results.every((r) => r.status === 'deferred');
        if (allDeferred && results.length > 0) {
          const firstReason = results[0].reason || '';
          if (/image|vision|multimodal/i.test(firstReason)) {
            setAiResults([]);
            setFlashText('Model AI tidak mendukung gambar. Gambar telah dihapus dari teks yang dikirim ke AI.');
            setTimeout(() => setFlashText(''), 4000);
            return;
          }
        }
        setAiResults(results);
        const failedAi = results.filter(
          (r) => r.status === 'failed' && r.problematic_text?.trim().length > 0 && r.id !== 56,
        );
        if (failedAi.length > 0 && sopReport) {
          applyHighlights({
            ...sopReport,
            items: [...sopReport.items, ...failedAi],
          });
        }
      })
      .catch(() => setAiResults([]))
      .finally(() => setAiLoading(false));
  };

  const loadMockArticle = () => {
    setKeyword('mendaftarkan merek');
    setMetaTitle('5 Cara Mendaftarkan Merek Usaha Anda | Legalitas');
    setMetaDesc('Panduan lengkap cara mendaftarkan merek usaha agar tidak dibajak.');
    setArticleFromMarkdown(`# 5 Cara Melindungi dan Mendaftarkan Merek Usaha
Pembajakan merek bisa menghancurkan bisnis Anda dalam semalam. Pelajari 5 strategi legal untuk melindungi aset berharga ini sebelum terlambat.

Kasus pencurian identitas brand sedang marak terjadi di kalangan UMKM tahun ini. Anda harus menyadari bahwa tanpa perlindungan hukum, nama bisnis yang Anda bangun bertahun-tahun bisa diklaim oleh kompetitor kapan saja.

Berikut adalah langkah-langkah yang harus Anda lakukan:
## 1. Lakukan Pengecekan di DJKI
Sebelum mendaftarkan merek, pastikan nama tersebut belum digunakan. Anda bisa mengeceknya melalui website resmi DJKI.

## 2. Siapkan Persyaratan Dokumen
Anda membutuhkan KTP, NPWP, dan logo merek yang jelas. Pastikan logo tidak meniru brand terkenal lainnya.

Menurut data Kemenkumham, lebih dari 30% penolakan merek terjadi karena adanya kemiripan visual dengan merek yang sudah terdaftar sebelumnya. Oleh karena itu, orisinalitas sangat penting.

Untuk mendaftarkan merek, pastikan Anda merujuk pada UU No. 20 Tahun 2016 tentang Merek dan Indikasi Geografis. Aturan ini masih berlaku penuh.

Baca juga: [Syarat Merek Terkenal](#), [Pentingnya Legalitas Usaha](#), [Cara Cek Merek Online](#)
Internal Link: [Layanan Registrasi Merek Kami](#), [Panduan HAKI](#)

Butuh bantuan mendaftarkan merek agar bebas dari risiko penolakan? Konsultasikan dengan tim legal kami hari ini juga!`);
  };


  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();

    try {
      let text = '';

      if (ext === 'pdf') {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const fontSize = 12;
          const Y_TOL = fontSize * 0.5;
          const PARA_GAP = fontSize * 1.8;
          const SPACE_GAP = fontSize * 0.3;
          const textItems = content.items.filter((it): it is any => 'str' in it);

          const avgHeight = textItems.reduce((s: number, it: any) => s + (it.height || fontSize), 0) / textItems.length;

          type Line = { words: { x: number; w: number; t: string }[]; y: number; h: number };
          const lines: Line[] = [];
          let cur: Line | null = null;
          for (const item of textItems) {
            const y = item.transform[5], x = item.transform[4];
            const w = item.width || 0, h = item.height || avgHeight || fontSize;
            if (cur && Math.abs(y - cur.y) <= Y_TOL) {
              cur.words.push({ x, w, t: item.str });
              cur.y = y;
              cur.h = Math.max(cur.h, h);
            } else {
              if (cur) lines.push(cur);
              cur = { words: [{ x, w, t: item.str }], y, h };
            }
          }
          if (cur) lines.push(cur);

          const pageLines: string[] = [];
          let prevY = -9999;
          for (const line of lines) {
            line.words.sort((a, b) => a.x - b.x);
            const parts: string[] = [];
            let lx = -9999;
            for (const w of line.words) {
              if (lx >= 0 && w.x - lx > SPACE_GAP) parts.push(' ');
              parts.push(w.t);
              lx = w.x + w.w;
            }
            const raw = parts.join('').trim();
            if (!raw) continue;

            const gap = line.y - prevY;
            let prefix = '';
            if (prevY <= -9990) { prefix = ''; }
            else if (gap > PARA_GAP) { prefix = '\n\n'; }
            else { prefix = '\n'; }

            const isHeading = line.h > avgHeight * 1.5 && raw.length < 80;
            pageLines.push(prefix + (isHeading ? '## ' + raw : raw));
            prevY = line.y;
          }

          pages.push(pageLines.join(''));
        }
        text = pages.join('\n\n');
      } else if (ext === 'docx') {
        const buf = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        text = result.value;
      } else {
        text = await file.text();
      }

      setArticleFromMarkdown(text);
    } catch (err) {
      console.error('File upload error:', err);
      setFlashText('Gagal membaca file: pastikan format file didukung.');
      setTimeout(() => setFlashText(''), 3000);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        editor.focus();
        document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="${file.name.replace(/\.[^.]+$/, '')}" style="max-width:100%;border-radius:8px;" />`);
        syncFromEditor();
      };
      reader.readAsDataURL(file);
    } catch {
      setFlashText('Gagal membaca gambar.');
      setTimeout(() => setFlashText(''), 3000);
    }
    e.target.value = '';
  };

  const deleteSelectedImg = () => {
    const img = selectedImgRef.current;
    if (!img) return;
    img.remove();
    selectedImgRef.current = null;
    setSelectedImgInfo(null);
    syncFromEditor();
  };

  const handleChatSend = async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatLoading) return;
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    setChatLoading(true);
    try {
      const result = await callArticleChat(article, prompt);
      setChatMessages((prev) => [...prev, { role: 'assistant', content: result.content, type: result.type }]);
      if (result.type === 'article') {
        pushUndo();
        setArticleFromMarkdown(result.content);
        requestAnimationFrame(() => applyHighlights());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan';
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans antialiased">
      {/* Header */}
      <header className="h-14 border-b border-slate-100 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="bg-slate-900 text-white p-1.5 rounded-md">
            <Scale className="w-4 h-4" />
          </div>
          <h1 className="text-sm font-semibold text-slate-900 tracking-tight">Article Legal Checker</h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-md transition"
          >
            <Upload className="w-3.5 h-3.5" />
            Unggah
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".txt,.md,.pdf,.docx"
            className="hidden"
          />
          <button
            type="button"
            onClick={loadMockArticle}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-md transition"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Contoh
          </button>
        </div>
      </header>

      <main className="flex h-[calc(100vh-3.5rem)]">
        {/* Editor Area */}
        <section className="w-[70%] flex flex-col min-w-0 border-r border-slate-100 relative">
          {/* Meta Header */}
          <div className="px-10 py-5 border-b border-slate-50 space-y-3">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Keyword
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="mendaftarkan merek"
                    className="flex-1 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-slate-400 outline-none py-1 text-sm text-slate-700 placeholder:text-slate-300 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKwPopup(true)}
                    className="shrink-0 p-1 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition"
                    title="Generate keyword dengan AI"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Judul
                </label>
                <input
                  type="text"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder="Judul artikel"
                  className="w-full bg-transparent border-b border-transparent hover:border-slate-200 focus:border-slate-400 outline-none py-1 text-sm font-medium text-slate-900 placeholder:text-slate-300 transition"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Deskripsi
              </label>
              <input
                type="text"
                value={metaDesc}
                onChange={(e) => setMetaDesc(e.target.value)}
                placeholder="Ringkasan singkat artikel"
                className="w-full bg-transparent border-b border-transparent hover:border-slate-200 focus:border-slate-400 outline-none py-1 text-sm text-slate-600 placeholder:text-slate-300 transition"
              />
            </div>
          </div>

          {/* Toolbar */}
          <div className="px-10 py-2 flex items-center gap-1 border-b border-slate-50">
            {[
              { icon: Heading1, action: 'h1', label: 'H1' },
              { icon: Heading2, action: 'h2', label: 'H2' },
              { icon: Heading3, action: 'h3', label: 'H3' },
            ].map((item) => (
              <button
                key={item.action}
                type="button"
                onClick={() => handleToolbar(item.action)}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
                title={item.label}
              >
                <item.icon className="w-4 h-4" />
              </button>
            ))}
            <div className="w-px h-4 bg-slate-100 mx-1" />
            {[
              { icon: Bold, action: 'bold', label: 'Bold' },
              { icon: Italic, action: 'italic', label: 'Italic' },
              { icon: Underline, action: 'underline', label: 'Underline' },
            ].map((item) => (
              <button
                key={item.action}
                type="button"
                onClick={() => handleToolbar(item.action)}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
                title={item.label}
              >
                <item.icon className="w-4 h-4" />
              </button>
            ))}
            <div className="w-px h-4 bg-slate-100 mx-1" />
            {[
              { icon: List, action: 'bullet', label: 'Bullet' },
              { icon: ListOrdered, action: 'number', label: 'Numbering' },
              { icon: Quote, action: 'quote', label: 'Quote' },
              { icon: LinkIcon, action: 'link', label: 'Link' },
              { icon: ImageIcon, action: 'image', label: 'Gambar' },
            ].map((item) => (
              <button
                key={item.action}
                type="button"
                onClick={() => {
                  if (item.action === 'image') {
                    imageInputRef.current?.click();
                  } else {
                    handleToolbar(item.action);
                  }
                }}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
                title={item.label}
              >
                <item.icon className="w-4 h-4" />
              </button>
            ))}
            <input
              type="file"
              accept="image/*"
              ref={imageInputRef}
              onChange={handleImageUpload}
              className="hidden"
            />
            <div className="flex-1" />
            <div className="flex items-center gap-0.5 mr-3">
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoStackRef.current.length === 0}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title="Undo (Ctrl+Z)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={redoStackRef.current.length === 0}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title="Redo (Ctrl+Y)"
              >
                <RotateCcw className="w-3.5 h-3.5 scale-x-[-1]" />
              </button>
            </div>
            <div className="text-xs text-slate-400">{wordCount} kata</div>
          </div>

          {/* WYSIWYG Editor */}
          <div
            ref={editorWrapperRef}
            className="flex-1 relative overflow-auto px-10 py-8"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.tagName !== 'IMG' && !target.closest('mark') && !target.closest('.issue-popup')) {
                clearTimeout(hideTimeoutRef.current);
                hoverTargetRef.current = null;
                setHover(null);
                selectedImgRef.current = null;
                setSelectedImgInfo(null);
              }
            }}
            onMouseOver={handleEditorMouseOver}
            onMouseLeave={() => { clearTimeout(hideTimeoutRef.current); hoverTargetRef.current = null; setHover(null); }}
          >
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleEditorInput}
              onPaste={handleEditorPaste}
              onClick={handleEditorClick}
              className="editor-surface w-full h-full outline-none text-base leading-7 text-slate-800 empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300 empty:before:pointer-events-none"
              data-placeholder="Mulai menulis artikel Anda di sini..."
              spellCheck={false}
            />
            {flashText && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="px-3 py-1.5 bg-slate-900 text-white text-xs rounded-full shadow-lg animate-fade-up">
                  Fokus: {flashText.slice(0, 40)}...
                </div>
              </div>
            )}
            {hover && (() => {
              const passed = hover.issue.status === 'passed';
              return (
              <div
                className="issue-popup fixed z-[100] w-72 bg-white border border-slate-100 shadow-xl rounded-xl p-4 animate-fade-up"
                style={{ left: hover.x, top: hover.y, transform: 'translateX(-50%)' }}
                onMouseEnter={() => clearTimeout(hideTimeoutRef.current)}
                onMouseLeave={scheduleHide}
              >
                <div className="flex items-start gap-2 mb-2">
                  {passed
                    ? <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
                  <h4 className="text-sm font-semibold text-slate-900 leading-tight">{hover.issue.question}</h4>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed mb-3">{hover.issue.reason}</p>
                {!passed && (
                  <div className="bg-slate-50 rounded-lg p-2.5 text-[11px] text-slate-500">
                    <div className="font-semibold text-slate-700 mb-1">SOP</div>
                    {SUGGESTED_LABELS[hover.issue.id] || 'Periksa kembali bagian ini sesuai SOP.'}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                  {!passed && hover.issue.id === 56 ? (
                    <button
                      type="button"
                      onClick={() => handleAutoCorrectCase(hover.issue)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-wait transition"
                    >
                      Auto Correct
                    </button>
                  ) : !passed && (
                    <button
                      type="button"
                      disabled={fixingId === hover.issue.id}
                      onClick={() => handleAutoCorrect(hover.issue)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-wait transition"
                    >
                      {fixingId === hover.issue.id ? 'Memperbaiki...' : 'Auto Correct'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => focusIssue(hover.issue)}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-slate-900 text-white hover:bg-slate-800"
                  >
                    Fokus
                  </button>
                </div>
              </div>
              );
            })()}
            {selectedImgInfo && (() => {
              const align = selectedImgInfo.align;
              return (
              <div
                className="fixed z-[100] bg-white border border-slate-100 shadow-xl rounded-xl p-2 animate-fade-up flex items-center gap-1.5"
                style={{ left: selectedImgInfo.x, top: selectedImgInfo.y, transform: 'translateX(-50%)' }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="range"
                  min="100"
                  max={selectedImgInfo.maxWidth}
                  value={selectedImgInfo.width}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setSelectedImgInfo({ ...selectedImgInfo, width: v });
                    const img = selectedImgRef.current;
                    if (img) { img.style.width = Math.min(v, selectedImgInfo.maxWidth) + 'px'; syncFromEditor(); }
                  }}
                  className="w-20 h-1.5"
                />
                <span className="text-[10px] text-slate-400 w-8 text-right">{selectedImgInfo.width}</span>
                <div className="w-px h-4 bg-slate-100 mx-0.5" />
                {['inline', 'center', 'right'].map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      setSelectedImgInfo({ ...selectedImgInfo, align: a });
                      const img = selectedImgRef.current;
                      if (!img) return;
                      if (a === 'inline') {
                        img.style.display = '';
                        img.style.marginLeft = '';
                        img.style.marginRight = '';
                      } else if (a === 'center') {
                        img.style.display = 'block';
                        img.style.marginLeft = 'auto';
                        img.style.marginRight = 'auto';
                      } else {
                        img.style.display = 'block';
                        img.style.marginLeft = 'auto';
                        img.style.marginRight = '0';
                      }
                      syncFromEditor();
                    }}
                    className={`p-1 rounded text-[10px] font-medium leading-none transition ${align === a ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-600'}`}
                    title={a === 'inline' ? 'Inline' : a === 'center' ? 'Tengah' : 'Kanan'}
                  >
                    {a === 'inline' ? '≡' : a === 'center' ? '⊞' : '⊟'}
                  </button>
                ))}
                <div className="w-px h-4 bg-slate-100 mx-0.5" />
                <button
                  type="button"
                  onClick={deleteSelectedImg}
                  className="p-1 rounded text-[10px] font-medium leading-none text-red-400 hover:text-red-600 hover:bg-red-50 transition"
                  title="Hapus gambar"
                >
                  ✕
                </button>
              </div>
              );
            })()}
          </div>

          {/* Chatbot */}
          <div className="absolute bottom-6 right-4 z-[100] flex flex-col items-end gap-3">
          {chatOpen && (
            <div ref={chatRef} className="w-80 sm:w-96 h-96 bg-white border border-slate-100 shadow-2xl rounded-2xl flex flex-col overflow-hidden animate-fade-up">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-50 bg-slate-50/50">
                <span className="text-sm font-semibold text-slate-700">Asisten Artikel</span>
                <button type="button" onClick={() => setChatOpen(false)} className="text-slate-300 hover:text-slate-500 transition text-lg leading-none">&times;</button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                {chatMessages.length === 0 && (
                  <div className="text-slate-400 text-center py-8">
                    <p className="font-medium text-slate-500 mb-1">Tanya Asisten Artikel</p>
                    <p className="text-[11px]">Contoh: "perbaiki grammar", "tambah paragraf tentang sanksi hukum", "buat pembukaan lebih profesional"</p>
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                      {m.role === 'assistant' && !m.content.startsWith('⚠️') ? (
                        <div>
                          <span className="line-clamp-6">{m.content}</span>
                          {m.type === 'article' && (
                            <button
                              type="button"
                              onClick={() => setArticleFromMarkdown(m.content)}
                              className="block mt-1.5 text-[10px] font-medium text-blue-600 hover:text-blue-700"
                            >
                              Terapkan ke artikel &rarr;
                            </button>
                          )}
                        </div>
                      ) : (
                        <span>{m.content}</span>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-50 text-slate-400 rounded-xl px-3 py-2 text-[11px]">Menulis...</div>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-50 p-3 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleChatSend())}
                  placeholder="Tanya asisten..."
                  disabled={chatLoading}
                  className="flex-1 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:border-slate-300 transition placeholder:text-slate-300 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-3 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition shrink-0"
                >
                  Kirim
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setChatOpen(!chatOpen)}
            className="w-11 h-11 bg-slate-900 text-white rounded-full shadow-lg hover:bg-slate-800 transition flex items-center justify-center"
            title="Buka Asisten Artikel"
          >
            <Bot className="w-5 h-5" />
          </button>
        </div>
        </section>

        {/* Evaluation Panel */}
        <aside className="w-[30%] min-w-0 bg-slate-50/50 flex flex-col border-l border-slate-100">
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Evaluasi Artikel</h2>
              <button
                type="button"
                onClick={runAnalysis}
                disabled={isAnalyzing || !article.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isAnalyzing ? (
                  <>
                    <Loader className="w-3.5 h-3.5 animate-spin" /> Memeriksa...
                  </>
                ) : (
                  <>
                    <Target className="w-3.5 h-3.5" /> Periksa
                  </>
                )}
              </button>
            </div>

            {!report ? (
              <div className="text-center py-10 text-slate-400">
                <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                  <Scale className="w-10 h-10 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-500 mb-1">Belum ada evaluasi</p>
                <p className="text-xs text-slate-400 max-w-48 mx-auto leading-relaxed">
                  Klik tombol <strong className="text-slate-500">Periksa</strong> untuk menjalankan SOP check dan evaluasi AI pada artikel Anda.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative w-16 h-16 shrink-0">
                    <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.5" fill="none"
                        stroke={score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444'}
                        strokeWidth="3" strokeDasharray={`${(score / 100) * 97.39} 97.39`}
                        strokeLinecap="round" />
                    </svg>
                    <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${statusConfig?.color}`}>{score}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusConfig?.bg} ${statusConfig?.color} ${statusConfig?.border} border mb-1`}>
                      {statusConfig?.label === 'Layak Publish' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <AlertCircle className="w-3 h-3" />
                      )}
                      {statusConfig?.label}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-snug">{statusConfig?.desc}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {report.items.filter((i) => i.status === 'passed').length}/{report.items.length} kriteria lulus
                    </p>
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl px-4 py-3">
                  <h3 className="text-[11px] font-semibold text-slate-900 mb-1">Ringkasan</h3>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{generateSummary(report)}</p>
                </div>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {report && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-900 mb-3">Daftar Issue</h3>
                {(() => {
                  const a: typeof CATEGORIES = [];
                  const b: typeof CATEGORIES = [];
                  const c: typeof CATEGORIES = [];
                  for (const cat of CATEGORIES) {
                    const i = getCategoryIssue(report, cat.id);
                    const st = getCategoryStatus(report, cat.id);
                    if (st !== 'passed' && i) {
                      if (i.problematic_text?.trim()) a.push(cat); else b.push(cat);
                    } else {
                      c.push(cat);
                    }
                  }
                  const renderRow = (cat: typeof CATEGORIES[0], clickable: boolean) => {
                    const iss = getCategoryIssue(report, cat.id);
                    const st = getCategoryStatus(report, cat.id);
                    const isPassed = st === 'passed';
                    const I = isPassed ? CheckCircle2 : st === 'deferred' ? AlertCircle : XCircle;
                    const co = isPassed ? 'text-emerald-500' : st === 'deferred' ? 'text-slate-400' : 'text-red-500';
                    return (
                      <button key={cat.id} type="button" onClick={() => clickable && iss && focusIssue(iss)} disabled={!clickable}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition text-left ${clickable && !isPassed ? 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50 cursor-pointer' : isPassed ? 'bg-slate-50/40 border-slate-50 cursor-default' : 'bg-slate-50/60 border-transparent cursor-default'}`}>
                        <I className={`w-4 h-4 shrink-0 ${co}`} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-medium ${isPassed ? 'text-slate-600' : 'text-slate-800'}`}>{cat.label}</div>
                          {iss && <div className="text-[10px] text-slate-500 truncate mt-0.5">{iss.reason}</div>}
                        </div>
                        {clickable && !isPassed && <span className="text-[9px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">Klik</span>}
                        {isPassed && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                      </button>
                    );
                  };
                  return (
                    <>
                      {a.length > 0 && <div><div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 px-0.5">Dapat diperbaiki</div>{a.map((c) => renderRow(c, true))}</div>}
                      {b.length > 0 && <div className={a.length > 0 ? 'mt-4' : ''}><div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 px-0.5">Informasi</div>{b.map((c) => renderRow(c, false))}</div>}
                      {c.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-50">
                          <button type="button" onClick={() => setShowPassedIssues(!showPassedIssues)}
                            className="flex items-center gap-2 text-[10px] font-medium text-slate-400 hover:text-slate-600 transition px-0.5"
                          >
                            <span className={`inline-block transition-transform ${showPassedIssues ? 'rotate-90' : ''}`}>▶</span>
                            {showPassedIssues ? 'Sembunyikan' : 'Lihat'}{' '}
                            <span className="text-slate-400">{c.length} kategori lulus</span>
                          </button>
                          {showPassedIssues && (
                            <div className="mt-1.5 space-y-1">
                              {c.map((cat) => renderRow(cat, false))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            <div className="mt-6 pt-5 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
                <BrainCircuit className="w-3.5 h-3.5 text-slate-600" /> AI Evaluation
              </h3>

              {aiLoading && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white border border-slate-100">
                  <Loader className="w-4 h-4 text-slate-400 animate-spin" />
                  <span className="text-xs text-slate-500">Menganalisis artikel dengan AI...</span>
                </div>
              )}

              {!aiLoading && !aiResults && !report && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white border border-slate-100 opacity-70">
                  <BrainCircuit className="w-4 h-4 text-slate-400" />
                  <span className="text-xs text-slate-400">Klik <strong>Periksa</strong> untuk evaluasi AI</span>
                </div>
              )}

              {!aiLoading && aiResults && aiResults.length > 0 && (() => {
                const withText = aiResults.filter((r) => r.problematic_text?.trim());
                const withoutText = aiResults.filter((r) => !r.problematic_text?.trim());
                const avgScore = Math.round(aiResults.reduce((s, r) => s + (r.aiConfidence || 0), 0) / aiResults.length);
                const passCount = aiResults.filter((r) => r.status === 'passed').length;
                const renderScoreRow = (r: CheckResult) => {
                  const score = r.aiConfidence || 0;
                  const passed = r.status === 'passed';
                  return (
                    <div key={r.id} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white border border-slate-50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-slate-700 leading-tight truncate pr-2">{r.question.slice(0, 60)}...</span>
                          <span className={`text-[10px] font-semibold shrink-0 ${passed ? 'text-emerald-600' : 'text-red-500'}`}>{score}</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${passed ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ width: `${score}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                };
                return (
                  <>
                    <div className="flex items-center gap-3 mb-3 px-0.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
                        <CheckCircle2 className="w-3 h-3" />
                        {passCount} lulus
                      </div>
                      <span className="text-slate-300">|</span>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <BrainCircuit className="w-3 h-3" />
                        Skor {avgScore}
                      </div>
                      <span className="text-slate-300">|</span>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Target className="w-3 h-3" />
                        {aiResults.length} kriteria
                      </div>
                    </div>
                    <div className="space-y-1.5 mb-3">
                      {aiResults.map((r) => renderScoreRow(r))}
                    </div>
                    {withText.length > 0 && (
                      <>
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 px-0.5">Temuan AI</div>
                        {withText.map((r) => (
                          <button key={r.id} type="button" onClick={() => focusIssue(r)}
                            className="w-full flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50 transition text-left cursor-pointer group mb-1"
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] text-slate-600 leading-relaxed line-clamp-2">{r.reason}</div>
                              <div className="text-[9px] text-slate-400 mt-0.5 truncate">"{r.problematic_text}"</div>
                            </div>
                            <span className="text-[8px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition">Klik</span>
                          </button>
                        ))}
                      </>
                    )}
                    {withoutText.length > 0 && (
                      <>
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 mt-3 px-0.5">Lulus</div>
                        {withoutText.map((r) => (
                          <div key={r.id} className="flex items-start gap-2.5 p-2.5 rounded-xl border border-transparent bg-slate-50/60">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] text-slate-500 leading-relaxed">{r.reason}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                );
              })()}

              {!aiLoading && aiResults && aiResults.length === 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-100">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-[11px] text-amber-700 leading-relaxed">Evaluasi AI gagal. Pastikan Ollama berjalan dan API key valid.</span>
                </div>
              )}
            </div>

            {aiResults && (() => {
              const caseIssues = aiResults.filter((r) => r.id === 56 && r.status === 'failed' && r.problematic_text?.trim());
              if (caseIssues.length === 0) return null;
              return (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <h3 className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
                  <span className="text-[10px] font-bold tracking-tight text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Aa</span> Rekomendasi Kapitalisasi
                </h3>
                <div className="text-[10px] text-slate-400 mb-3 leading-relaxed">
                  Klik item untuk lokasi kata. Klik <strong>Auto Correct</strong> di popup untuk perbaiki kapitalisasi.
                </div>
                <div className="space-y-1">
                  {caseIssues.map((r, i) => (
                    <button key={i} type="button" onClick={() => focusIssue(r)}
                      className="w-full flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50 transition text-left cursor-pointer group"
                    >
                      <span className="text-[9px] font-bold text-slate-400 mt-0.5 shrink-0 w-4 text-center">Aa</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-slate-700 font-medium leading-snug">{r.reason}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 italic truncate">"{r.problematic_text}"</div>
                      </div>
                      <span className="text-[8px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition">Klik</span>
                    </button>
                  ))}
                </div>
              </div>
              );
            })()}
          </div>
        </aside>
      </main>

      {showKwPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setShowKwPopup(false)}>
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-slate-500" />
                <span className="text-sm font-semibold text-slate-800">Generate Keyword dengan AI</span>
              </div>
              <button type="button" onClick={() => setShowKwPopup(false)} className="text-slate-300 hover:text-slate-500 transition text-lg leading-none">&times;</button>
            </div>
            {kwGenError && <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600">{kwGenError}</div>}
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">AI akan membaca seluruh artikel dan menyarankan 1 keyword utama (2–4 kata) yang paling relevan dengan topik.</p>
            <button
              type="button"
              onClick={handleGenerateKeyword}
              disabled={kwGenLoading}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {kwGenLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {kwGenLoading ? 'Menganalisis artikel...' : 'Generate Keyword'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-up {
          animation: fade-up 0.15s ease-out;
        }
        .editor-surface h1,
        .editor-surface h2,
        .editor-surface h3,
        .editor-surface h4,
        .editor-surface p,
        .editor-surface ul,
        .editor-surface ol,
        .editor-surface blockquote {
          margin: 0 0 0.75em 0;
        }
        .editor-surface h1 { font-size: 1.75rem; font-weight: 700; color: #0f172a; }
        .editor-surface h2 { font-size: 1.375rem; font-weight: 600; color: #0f172a; }
        .editor-surface h3 { font-size: 1.125rem; font-weight: 600; color: #0f172a; }
        .editor-surface strong, .editor-surface b { font-weight: 700; }
        .editor-surface em, .editor-surface i { font-style: italic; }
        .editor-surface u { text-decoration: underline; }
        .editor-surface ul { list-style-type: disc; padding-left: 1.5rem; }
        .editor-surface ol { list-style-type: decimal; padding-left: 1.5rem; }
        .editor-surface blockquote { border-left: 3px solid #e2e8f0; padding-left: 1rem; color: #475569; font-style: italic; }
        .editor-surface a { color: #2563eb; text-decoration: underline; }
        .editor-surface img { max-width: 100%; border-radius: 0.5rem; }
        .editor-surface ::selection {
          background-color: rgba(239, 68, 68, 0.3);
          color: inherit;
        }
        .issue-highlight {
          background-color: rgba(254, 226, 226, 0.7);
          border-bottom: 2px solid rgba(239, 68, 68, 0.3);
          border-radius: 2px;
          cursor: pointer;
        }
        .issue-highlight:hover {
          background-color: rgba(254, 202, 202, 0.9);
        }
        .issue-highlight-passed {
          background-color: rgba(187, 247, 208, 0.5);
          border-bottom: 2px solid rgba(34, 197, 94, 0.3);
          border-radius: 2px;
          cursor: pointer;
        }
        .issue-highlight-passed:hover {
          background-color: rgba(134, 239, 172, 0.6);
        }
        .issue-highlight-ai {
          background-color: rgba(254, 243, 199, 0.7);
          border-bottom: 2px solid rgba(234, 179, 8, 0.4);
          border-radius: 2px;
          cursor: pointer;
        }
        .issue-highlight-ai:hover {
          background-color: rgba(252, 225, 138, 0.85);
        }
      `}</style>
    </div>
  );
}

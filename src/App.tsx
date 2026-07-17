import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DRAFT_KEY = 'ac_legal_checker_draft_v1';

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
  Download,
  BookOpen,
  CheckCircle2,
  XCircle,
  X,
  AlertCircle,

  Sparkles,
  BrainCircuit,
  Target,
  Scale,
  Loader,
  Image as ImageIcon,
  Bot,
  RotateCcw,
  Trash2,
  ArrowRight,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  FileText,
  ShieldCheck,
  ScanLine,
  Globe,
} from 'lucide-react';
import html2pdf from 'html2pdf.js';
import * as docx from 'docx';
import { runSopChecks, evaluateWithAI, autoReviseItem, getPrimaryKeyword, detectAIContent, checkPlagiarism, fetchAhrefsKeywordMetrics, generateMockAhrefsMetrics, callChatCompletion, type CheckResult, type SopReport, type AiEvaluationOutput, type AIDetectionResult, type PlagiarismResult, type AhrefsKeywordMetric } from './sop';
import { callArticleChat } from './sop/articleChat';
import { OPENAI_API_KEY, AHREFS_API_KEY, UNDO_STACK_LIMIT } from './sop/config';
import { stripImages } from './sop/images';

type HighlightMode = 'sop' | 'ai-detector' | 'plagiarism';
type HoverKind = 'sop' | 'ai-detector' | 'plagiarism';
type HoverData = {
  x: number;
  y: number;
  kind: HoverKind;
  label: string;
  reason: string;
  text: string;
  score?: number;
  issue?: CheckResult;
};

const AI_SENTENCE_HIGHLIGHT_THRESHOLD = 60;
const PLAGIARISM_HIGHLIGHT_THRESHOLD = 40;

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
  // Support ![alt](src "width") and ![alt](src "width align")
  html = html.replace(/!\[(.*?)\]\((.*?)\s+"([^"]*)"\)/g, (_match, alt, src, meta) => {
    const parts = meta.trim().split(/\s+/).filter(Boolean);
    const width = /^\d+$/.test(parts[0] || '') ? parts[0] : '';
    const align = (parts[1] || 'inline').toLowerCase();
    let attrs = `src="${src}" alt="${alt}"`;
    if (width) attrs += ` width="${width}"`;
    attrs += ` data-align="${align}"`;
    const baseStyle = 'max-width:100%;border-radius:8px;';
    if (align === 'center') attrs += ` style="${baseStyle} display:block;margin-left:auto;margin-right:auto;"`;
    else if (align === 'right') attrs += ` style="${baseStyle} display:block;margin-left:auto;margin-right:0;"`;
    else attrs += ` style="${baseStyle}"`;
    return `<img ${attrs} />`;
  });
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;" data-align="inline" />');

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
        const align = (el.getAttribute('data-align') || 'inline').toLowerCase();
        const wNum = w ? String(w).replace('px', '') : '';
        let title = wNum;
        if (align !== 'inline') title += (title ? ' ' : '') + align;
        return title ? `![${alt}](${src} "${title}")\n` : `![${alt}](${src})\n`;
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

function findTextMatchAfter(text: string, query: string, from: number): { start: number; end: number } | null {
  const startAt = Math.max(0, from);
  const sliced = text.slice(startAt);
  const m = findTextMatch(sliced, query);
  if (!m) return null;
  return { start: m.start + startAt, end: m.end + startAt };
}

function computeRelevance(keyword: string, articleText: string): number {
  const lowerArticle = articleText.toLowerCase();
  const lowerKw = keyword.toLowerCase().trim();
  if (!lowerKw || !articleText.trim()) return 1;

  const words = lowerKw.split(/\s+/).filter(Boolean);
  const escaped = lowerKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactRegex = new RegExp(escaped, 'g');
  const exactMatches = (lowerArticle.match(exactRegex) || []).length;

  if (words.length === 1) {
    if (exactMatches >= 15) return 10;
    if (exactMatches >= 10) return 8;
    if (exactMatches >= 6) return 6;
    if (exactMatches >= 3) return 4;
    return exactMatches >= 1 ? 2 : 1;
  }

  if (exactMatches > 0) return Math.min(10, 5 + exactMatches * 2);

  const anyMatchCount = words.filter((w) => lowerArticle.includes(w)).length;
  if (anyMatchCount >= words.length) return 5;
  if (anyMatchCount >= words.length - 1) return 3;
  return 1;
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
  const [aiResults, setAiResults] = useState<AiEvaluationOutput | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverData | null>(null);
  const [fixingId, setFixingId] = useState<number | null>(null);
  const [flashText, setFlashText] = useState('');
  const [showKwPopup, setShowKwPopup] = useState(false);
  const [kwGenLoading, setKwGenLoading] = useState(false);
  const [kwGenError, setKwGenError] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [kwInput, setKwInput] = useState('');
  const [fileImportLoading, setFileImportLoading] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showPassedIssues, setShowPassedIssues] = useState(false);
  const [showMobileEval, setShowMobileEval] = useState(false);
  const selectedImgRef = useRef<HTMLImageElement | null>(null);
  const [selectedImgInfo, setSelectedImgInfo] = useState<{ width: number; align: string; x: number; y: number; maxWidth: number } | null>(null);
  const hoverTargetRef = useRef<HTMLElement | null>(null);
  const hoverRef = useRef<typeof hover>(null);
  hoverRef.current = hover;
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string; type?: 'article' | 'answer' }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [activeEvalTab, setActiveEvalTab] = useState<'sop' | 'ai-detector' | 'plagiarism'>('sop');
  const [aiDetectorResult, setAiDetectorResult] = useState<AIDetectionResult | null>(null);
  const [aiDetectorLoading, setAiDetectorLoading] = useState(false);
  const [aiDetectorFixLoading, setAiDetectorFixLoading] = useState(false);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismResult | null>(null);
  const [plagiarismLoading, setPlagiarismLoading] = useState(false);
  const [plagiarismFixLoading, setPlagiarismFixLoading] = useState(false);
  const [ahrefsMetrics, setAhrefsMetrics] = useState<AhrefsKeywordMetric[]>([]);

  const chatRef = useRef<HTMLDivElement>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imgToolbarRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveDraftTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const undoStackRef = useRef<{ article: string; keyword: string; metaTitle: string; metaDesc: string }[]>([]);
  const redoStackRef = useRef<{ article: string; keyword: string; metaTitle: string; metaDesc: string }[]>([]);
  const lastUndoRef = useRef(0);

  const pushUndo = () => {
    undoStackRef.current.push({ article, keyword, metaTitle, metaDesc });
    if (undoStackRef.current.length > UNDO_STACK_LIMIT) undoStackRef.current.shift();
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
      const widthAttr = img.getAttribute('width');
      const width = widthAttr ? parseInt(widthAttr) : Math.round(rect.width);
      setSelectedImgInfo((prev) => {
        if (!prev) return null;
        const pos = positionPopupFor(rect, 320, 44, true, 48);
        return { ...prev, x: pos.x, y: pos.y, width };
      });
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
        const above = rect.top - 48 >= 0;
        const pos = positionPopupFor(rect, 288, 250, above, 48);
        return { ...prev, x: pos.x, y: pos.y };
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
    if (!editorRef.current) return;
    requestAnimationFrame(() => applyHighlights(undefined, activeEvalTab));
  }, [activeEvalTab]);

  useEffect(() => {
    if (!editorRef.current || activeEvalTab !== 'sop') return;
    requestAnimationFrame(() => applyHighlights());
  }, [report, aiResults, activeEvalTab]);

  useEffect(() => {
    if (!editorRef.current || activeEvalTab !== 'ai-detector') return;
    requestAnimationFrame(() => applyHighlights(undefined, 'ai-detector'));
  }, [aiDetectorResult, activeEvalTab]);

  useEffect(() => {
    if (!editorRef.current || activeEvalTab !== 'plagiarism') return;
    requestAnimationFrame(() => applyHighlights(undefined, 'plagiarism'));
  }, [plagiarismResult, activeEvalTab]);

  // Load saved draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (typeof data.article === 'string') setArticleFromMarkdown(data.article);
        if (typeof data.keyword === 'string') setKeyword(data.keyword);
        if (typeof data.metaTitle === 'string') setMetaTitle(data.metaTitle);
        if (typeof data.metaDesc === 'string') setMetaDesc(data.metaDesc);
        if (Array.isArray(data.chatMessages)) setChatMessages(data.chatMessages);
      }
    } catch {
      // ignore corrupt storage
    }
  }, []);

  // Auto-save draft with debounce
  useEffect(() => {
    clearTimeout(saveDraftTimeoutRef.current);
    setDraftSaved(false);
    saveDraftTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          article,
          keyword,
          metaTitle,
          metaDesc,
          chatMessages,
        }));
        setDraftSaved(true);
        setTimeout(() => setDraftSaved(false), 2000);
      } catch {
        // storage may be full or unavailable
      }
    }, 1000);
    return () => clearTimeout(saveDraftTimeoutRef.current);
  }, [article, keyword, metaTitle, metaDesc, chatMessages]);

  // Global Escape key to close popups/modals/toolbars
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showKwPopup) { setShowKwPopup(false); return; }
      if (showResetModal) { setShowResetModal(false); return; }
      if (showExportModal) { setShowExportModal(false); return; }
      if (chatOpen) { setChatOpen(false); return; }
      if (selectedImgInfo) { selectedImgRef.current = null; setSelectedImgInfo(null); return; }
      if (hover) { hoverTargetRef.current = null; setHover(null); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showKwPopup, showResetModal, showExportModal, chatOpen, selectedImgInfo, hover]);

  useEffect(() => {
    if (!article.trim()) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [article]);

  // Re-position image toolbar after mount once we know its actual width
  useEffect(() => {
    const el = imgToolbarRef.current;
    if (!el || !selectedImgInfo) return;
    const actualW = el.offsetWidth;
    if (actualW > 0) {
      const nx = clampPopupX(selectedImgInfo.x, actualW);
      const ny = clampPopupY(selectedImgInfo.y, 44);
      if (Math.abs(nx - selectedImgInfo.x) > 1 || Math.abs(ny - selectedImgInfo.y) > 1) {
        setSelectedImgInfo((prev) => prev ? { ...prev, x: nx, y: ny } : null);
      }
    }
  }, [selectedImgInfo]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

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
      case 'align-left':
        document.execCommand('justifyLeft');
        break;
      case 'align-center':
        document.execCommand('justifyCenter');
        break;
      case 'align-right':
        document.execCommand('justifyRight');
        break;
      case 'align-justify':
        document.execCommand('justifyFull');
        break;
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

  const clampPopupX = (x: number, pw: number) => {
    const m = 8;
    const hw = pw / 2;
    return Math.max(hw + m, Math.min(x, window.innerWidth - hw - m));
  };
  const clampPopupY = (y: number, ph: number) => {
    const m = 8;
    if (y + ph + m > window.innerHeight) y = window.innerHeight - ph - m;
    return Math.max(m, y);
  };
  const positionPopupFor = (rect: DOMRect, width: number, height: number, above: boolean, gap: number) => {
    const cx = rect.left + rect.width / 2;
    let cy = above ? rect.top - gap : rect.bottom + gap;
    cy = clampPopupY(cy, height);
    if (above && cy < 8) cy = clampPopupY(rect.bottom + gap, height);
    return { x: clampPopupX(cx, width), y: cy };
  };

  const showIssuePopup = (target: HTMLElement) => {
    if (target.tagName !== 'MARK') return;
    const kind = (target.dataset.kind as HoverKind | undefined) ?? 'sop';

    let popup: HoverData | null = null;
    if (kind === 'sop') {
      if (!target.dataset.issueId) return;
      const issueId = Number(target.dataset.issueId);
      const issue =
        liveReport?.items.find((item) => item.id === issueId) ??
        aiResults?.results.find((item) => item.id === issueId);
      if (!issue) return;
      popup = {
        x: 0,
        y: 0,
        kind,
        label: issue.question,
        reason: issue.reason,
        text: issue.problematic_text,
        issue,
      };
    } else {
      const label = target.dataset.label || (kind === 'ai-detector' ? 'AI Detector' : 'Plagiarism');
      const reason = target.dataset.reason || '';
      const text = target.dataset.text || target.textContent || '';
      const scoreRaw = target.dataset.score;
      popup = {
        x: 0,
        y: 0,
        kind,
        label,
        reason,
        text,
        score: scoreRaw ? Number(scoreRaw) : undefined,
      };
    }

    hoverTargetRef.current = target;
    const rect = target.getBoundingClientRect();
    const above = rect.top - 48 >= 0;
    const pos = positionPopupFor(rect, 288, 250, above, 48);
    setHover({
      ...popup,
      x: pos.x,
      y: pos.y,
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
    if (target.tagName === 'MARK') {
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
        const above = rect.top - 48 >= 10;
        const pos = positionPopupFor(rect, 320, 44, above, 48);
        const widthAttr = img.getAttribute('width');
        const width = widthAttr ? parseInt(widthAttr) : Math.round(rect.width);
        const align = img.getAttribute('data-align') || (
          img.style.display === 'block' && img.style.marginLeft === 'auto' && img.style.marginRight === 'auto' ? 'center'
          : img.style.display === 'block' && img.style.marginLeft === 'auto' ? 'right'
          : 'inline'
        );
        setSelectedImgInfo({
          width,
          align,
          x: pos.x,
          y: pos.y,
          maxWidth: maxW,
        });
      }
    };
    el.addEventListener('mousedown', handleNativeClick);
    return () => el.removeEventListener('mousedown', handleNativeClick);
  }, []);

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'MARK') {
      showIssuePopup(target);
    }
  };

  const applyHighlights = (reportOverride?: SopReport, modeOverride?: HighlightMode) => {
    const editor = editorRef.current;
    if (!editor) return;

    const mode = modeOverride ?? activeEvalTab;

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

    const highlightedMd = htmlToMarkdown(editor.innerHTML);
    type HighlightRange = {
      start: number;
      end: number;
      cls: string;
      kind: HoverKind;
      label: string;
      reason: string;
      text: string;
      score?: number;
      issueId?: number;
    };

    const ranges: HighlightRange[] = [];

    if (mode === 'sop') {
      let reportToApply = reportOverride ?? liveReport;
      if (!reportToApply) return;

      if (!reportOverride && aiResults) {
        const failedAi = aiResults.results.filter(
          (r) => r.status === 'failed' && r.problematic_text?.trim().length > 0 && r.id !== 56,
        );
        if (failedAi.length > 0) {
          reportToApply = {
            ...reportToApply,
            items: [...reportToApply.items, ...failedAi],
          };
        }
      }

      const issues = reportToApply.items.filter(
        (item) => item.problematic_text?.trim().length > 0,
      );
      for (const issue of issues) {
        const m = findTextMatch(highlightedMd, issue.problematic_text);
        if (!m) continue;
        let cls: string;
        if (issue.source === 'ai') {
          cls = issue.status === 'passed' ? 'issue-highlight-passed' : 'issue-highlight-ai';
        } else {
          cls = issue.status === 'passed' ? 'issue-highlight-passed' : 'issue-highlight';
        }
        ranges.push({
          start: m.start,
          end: m.end,
          cls,
          kind: 'sop',
          label: issue.question,
          reason: issue.reason,
          text: issue.problematic_text,
          issueId: issue.id,
        });
      }
    }

    if (mode === 'ai-detector') {
      const suspicious = (aiDetectorResult?.sentences || []).filter(
        (s) => s.text?.trim().length > 0 && s.ai_probability >= AI_SENTENCE_HIGHLIGHT_THRESHOLD,
      );
      let cursor = 0;
      for (const sentence of suspicious) {
        const trimmed = sentence.text.trim();
        const words = trimmed.split(/\s+/).filter(Boolean);
        const candidates = [
          trimmed,
          words.slice(0, 14).join(' '),
          words.slice(0, 10).join(' '),
        ].filter((s) => s.length > 12);

        let m: { start: number; end: number } | null = null;
        for (const candidate of candidates) {
          m = findTextMatchAfter(highlightedMd, candidate, cursor) ?? findTextMatch(highlightedMd, candidate);
          if (m) break;
        }
        if (!m) continue;
        ranges.push({
          start: m.start,
          end: m.end,
          cls: 'issue-highlight-detector',
          kind: 'ai-detector',
          label: `AI Detector (${sentence.ai_probability}%)`,
          reason: `Kalimat ini terindikasi AI-generated dengan probabilitas ${sentence.ai_probability}%.`,
          text: sentence.text,
          score: sentence.ai_probability,
        });
        cursor = m.end;
      }
    }

    if (mode === 'plagiarism') {
      const suspicious = (plagiarismResult?.matchedSources || []).filter(
        (s) => s.matchedText?.trim().length > 0 && s.score >= PLAGIARISM_HIGHLIGHT_THRESHOLD,
      );
      let cursor = 0;
      for (const source of suspicious) {
        const trimmed = source.matchedText.trim();
        const words = trimmed.split(/\s+/).filter(Boolean);
        const candidates = [
          trimmed,
          words.slice(0, 14).join(' '),
          words.slice(0, 10).join(' '),
        ].filter((s) => s.length > 12);

        let m: { start: number; end: number } | null = null;
        for (const candidate of candidates) {
          m = findTextMatchAfter(highlightedMd, candidate, cursor) ?? findTextMatch(highlightedMd, candidate);
          if (m) break;
        }
        if (!m) continue;
        ranges.push({
          start: m.start,
          end: m.end,
          cls: 'issue-highlight-plagiarism',
          kind: 'plagiarism',
          label: `Plagiarism (${source.score}%)`,
          reason: `Teks ini memiliki kemiripan dengan sumber ${source.url || 'eksternal'} (${source.score}%).`,
          text: source.matchedText,
          score: source.score,
        });
        cursor = m.end;
      }
    }

    ranges.sort((a, b) => a.start - b.start);

    let result = '';
    let lastEnd = 0;
    for (const range of ranges) {
      if (range.start < lastEnd) continue;
      result += highlightedMd.slice(lastEnd, range.start);
      const safeReason = range.reason.replace(/"/g, '&quot;');
      const safeLabel = range.label.replace(/"/g, '&quot;');
      const safeText = range.text.replace(/"/g, '&quot;');
      const safeIssueId = typeof range.issueId === 'number' ? ` data-issue-id="${range.issueId}"` : '';
      const safeScore = typeof range.score === 'number' ? ` data-score="${range.score}"` : '';
      result += `<mark class="${range.cls}" data-kind="${range.kind}"${safeIssueId}${safeScore} data-text="${safeText}" data-reason="${safeReason}" data-label="${safeLabel}">${highlightedMd.slice(
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
      const above = rect.top - 48 >= 0;
      const pos = positionPopupFor(rect, 288, 250, above, 48);
      setHover({
        x: pos.x,
        y: pos.y,
        kind: 'sop',
        label: issue.question,
        reason: issue.reason,
        text: issue.problematic_text,
        issue,
      });
    } else if (m) {
      // Position near the text selection regardless of mark
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const above = rect.top - 48 >= 0;
        const pos = positionPopupFor(rect, 288, 250, above, 48);
        setHover({
          x: pos.x,
          y: pos.y,
          kind: 'sop',
          label: issue.question,
          reason: issue.reason,
          text: issue.problematic_text,
          issue,
        });
      } else {
        setHover({ x: editor.clientWidth / 2, y: 100, kind: 'sop', label: issue.question, reason: issue.reason, text: issue.problematic_text, issue });
      }
    } else {
      setHover({ x: editor.clientWidth / 2, y: 100, kind: 'sop', label: issue.question, reason: issue.reason, text: issue.problematic_text, issue });
    }
    setTimeout(() => { hoverTargetRef.current = null; setHover(null); }, 15000);
  };

  const focusSnippet = (snippet: string) => {
    const editor = editorRef.current;
    if (!editor || !snippet?.trim()) return;
    const text = getTextContent(editor.innerHTML);
    const m = findTextMatch(text, snippet);
    if (!m) {
      editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    editor.focus();
    const start = findTextNodeAndOffset(editor, m.start);
    const end = findTextNodeAndOffset(editor, m.end);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const mark = range.startContainer.parentElement?.closest('mark');
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setFlashText(snippet);
    setTimeout(() => setFlashText(''), 1200);
  };

  const handleAutoCorrectHighlight = async (kind: 'ai-detector' | 'plagiarism', snippet: string) => {
    if (!snippet.trim()) return;
    if (kind === 'ai-detector') setAiDetectorFixLoading(true);
    if (kind === 'plagiarism') setPlagiarismFixLoading(true);
    try {
      const m = findTextMatch(article, snippet);
      if (!m) {
        setFlashText('Teks tidak ditemukan untuk diperbaiki.');
        setTimeout(() => setFlashText(''), 2500);
        return;
      }
      const rewritten = await rewriteSnippet(article.slice(m.start, m.end), kind === 'ai-detector' ? 'ai' : 'plagiarism');
      if (!rewritten || rewritten.toLowerCase() === article.slice(m.start, m.end).trim().toLowerCase()) {
        setFlashText('Tidak ada perubahan signifikan dari auto-correct.');
        setTimeout(() => setFlashText(''), 2500);
        return;
      }
      const nextArticle = article.slice(0, m.start) + rewritten + article.slice(m.end);
      pushUndo();
      setArticleFromMarkdown(nextArticle);
      const newReport = runSopChecks({ article: nextArticle, keyword, metaTitle, metaDesc });
      setLiveReport(newReport);
      setReport(newReport);

      if (kind === 'ai-detector') {
        const refreshed = await detectAIContent(stripImages(nextArticle));
        setAiDetectorResult(refreshed);
      } else {
        const refreshed = await checkPlagiarism(stripImages(nextArticle));
        setPlagiarismResult(refreshed);
      }

      requestAnimationFrame(() => applyHighlights(undefined, kind));
      setHover(null);
      setFlashText('Auto-correct selesai.');
      setTimeout(() => setFlashText(''), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal auto-correct.';
      setFlashText(msg);
      setTimeout(() => setFlashText(''), 3000);
    } finally {
      if (kind === 'ai-detector') setAiDetectorFixLoading(false);
      if (kind === 'plagiarism') setPlagiarismFixLoading(false);
    }
  };

  const handleAutoCorrect = async (item: CheckResult) => {
    pushUndo();
    setFixingId(item.id);
    try {
      const result = await autoReviseItem(
        { article, keyword, metaTitle, metaDesc },
        item,
        OPENAI_API_KEY,
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
    } catch (err: unknown) {
      setHover(null);
      const msg = err instanceof Error ? err.message : 'Gagal memperbaiki. Silakan coba lagi.';
      setFlashText(`Auto Correct gagal: ${msg}`);
      setTimeout(() => setFlashText(''), 4000);
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

  const handleAnalyzeKeywords = async (source: 'ai' | 'manual' = 'ai') => {
    setKwGenLoading(true);
    setKwGenError('');
    setAhrefsMetrics([]);
    setSelectedKeywords(new Set());

    let keywords: string[] = [];

    try {
      if (source === 'ai') {
        if (!article.trim()) {
          setKwGenError('Tidak ada artikel untuk dianalisis. Tulis artikel terlebih dahulu.');
          setKwGenLoading(false);
          return;
        }
        const { content } = await callChatCompletion({
          messages: [
            {
              role: 'system',
              content: `Anda adalah SEO keyword researcher. Analisis artikel berikut dan rekomendasikan 10-15 keyword yang paling relevan dan memiliki potensi SEO terbaik.

Kembalikan JSON SAJA tanpa markdown atau pembungkus apapun:
{ "keywords": ["keyword1", "keyword2", ...] }

Pertimbangkan topik utama artikel, intent pencarian, variasi long-tail, dan sinonim.`,
            },
            { role: 'user', content: stripImages(article).slice(0, 8000) },
          ],
          temperature: 0.3,
          timeoutMs: 30_000,
        });
        const data = JSON.parse(content);
        keywords = data.keywords || [];
        if (keywords.length === 0) {
          setKwGenError('AI tidak dapat merekomendasikan keyword. Coba dengan input manual.');
          setKwGenLoading(false);
          return;
        }
      } else {
        keywords = kwInput.split(',').map((k) => k.trim()).filter(Boolean);
        if (keywords.length === 0) {
          setKwGenError('Masukkan minimal 1 keyword dipisahkan koma.');
          setKwGenLoading(false);
          return;
        }
      }

      const { data: metrics, error } = await fetchAhrefsKeywordMetrics(keywords.slice(0, 10), 'id', AHREFS_API_KEY);
      let _finalMetrics: AhrefsKeywordMetric[];
      if (error) {
        _finalMetrics = generateMockAhrefsMetrics(keywords.slice(0, 10));
        setAhrefsMetrics(_finalMetrics);
        if (error.includes('API key') || error.includes('tidak dikonfigurasi')) {
          setKwGenError('Ahrefs API key tidak dikonfigurasi. Menampilkan data simulasi.');
        }
      } else if (metrics.length > 0) {
        _finalMetrics = metrics;
        setAhrefsMetrics(_finalMetrics);
      } else {
        _finalMetrics = generateMockAhrefsMetrics(keywords.slice(0, 10));
        setAhrefsMetrics(_finalMetrics);
      }
      const _existingKws = keyword.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      setSelectedKeywords(new Set(_finalMetrics.filter(m => _existingKws.includes(m.keyword.toLowerCase())).map(m => m.keyword)));
    } catch (err) {
      if (source === 'ai' && keywords.length === 0) {
        setAhrefsMetrics([]);
        setKwGenError('Gagal: ' + (err instanceof Error ? err.message : 'Terjadi kesalahan'));
      } else {
        const _fallbackMetrics = generateMockAhrefsMetrics(keywords.length > 0 ? keywords.slice(0, 10) : ['keyword']);
        setAhrefsMetrics(_fallbackMetrics);
        setKwGenError('Gagal mengambil data Ahrefs. Menampilkan data simulasi.');
        const _existingKws = keyword.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        setSelectedKeywords(new Set(_fallbackMetrics.filter(m => _existingKws.includes(m.keyword.toLowerCase())).map(m => m.keyword)));
      }
    } finally {
      setKwGenLoading(false);
    }
  };

  const toggleKeyword = (kw: string) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const selectAllKeywords = () => {
    setSelectedKeywords(new Set(ahrefsMetrics.map((m) => m.keyword)));
  };

  const deselectAllKeywords = () => {
    setSelectedKeywords(new Set());
  };

  const applySelectedKeywords = () => {
    const selected = Array.from(selectedKeywords);
    if (selected.length > 0) {
      const existing = keyword.split(',').map(k => k.trim()).filter(Boolean);
      const existingLower = existing.map(k => k.toLowerCase());
      const merged = [...existing];
      for (const kw of selected) {
        if (!existingLower.includes(kw.toLowerCase())) {
          merged.push(kw);
        }
      }
      setKeyword(merged.join(', '));
    }
    setShowKwPopup(false);
    setFlashText(`${selected.length} keyword dipilih`);
    setTimeout(() => setFlashText(''), 2500);
  };

  const runAnalysis = () => {
    setIsAnalyzing(true);
    setAiLoading(true);
    setAiResults(null);
    setAiError(null);
    if (window.innerWidth < 768) setShowMobileEval(true);
    const sopReport = liveReport;
    window.setTimeout(() => {
      applyHighlights();
      setReport(liveReport);
      setIsAnalyzing(false);
    }, 300);

    // Abort any previous analysis request
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = new AbortController();
    const signal = analysisAbortRef.current.signal;

    evaluateWithAI(
      {
        article: stripImages(article),
        keyword: stripImages(getPrimaryKeyword(keyword)),
        metaTitle: stripImages(metaTitle),
        metaDesc: stripImages(metaDesc),
      },
      OPENAI_API_KEY,
      signal,
    )
      .then((output) => {
        const allDeferred = output.results.every((r) => r.status === 'deferred');
        if (allDeferred && output.results.length > 0) {
          const firstReason = output.results[0].reason || '';
          if (/image|vision|multimodal/i.test(firstReason)) {
            setAiResults({ results: [], subScores: output.subScores, bestNextMove: output.bestNextMove });
            setFlashText('Model AI tidak mendukung gambar. Gambar telah dihapus dari teks yang dikirim ke AI.');
            setTimeout(() => setFlashText(''), 4000);
            return;
          }
        }
        setAiResults(output);
        const failedAi = output.results.filter(
          (r) => r.status === 'failed' && r.problematic_text?.trim().length > 0 && r.id !== 56,
        );
        if (failedAi.length > 0 && sopReport) {
          applyHighlights({
            ...sopReport,
            items: [...sopReport.items, ...failedAi],
          });
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setAiError(err instanceof Error ? err.message : 'Gagal terhubung ke AI.');
        setAiResults({ results: [], subScores: { seo: 0, structure: 0, intent: 0, tone: 0 }, bestNextMove: '' });
      })
      .finally(() => {
        if (!signal.aborted) setAiLoading(false);
      });
  };

  const runAllChecks = async () => {
    runAnalysis();
    handleDetectAI({ switchTab: false });
    handleCheckPlagiarism({ switchTab: false });
  };

  const handleDetectAI = async (opts?: { switchTab?: boolean }) => {
    if (!article.trim()) return;
      setAiDetectorLoading(true);
    setAiDetectorResult(null);
      try {
        const result = await detectAIContent(stripImages(article));
      setAiDetectorResult(result);
      if (opts?.switchTab ?? true) setActiveEvalTab('ai-detector');
      if (window.innerWidth < 768) setShowMobileEval(true);
    } catch (err) {
      setAiDetectorResult({
        provider: 'none',
        aiProbability: 0,
        humanProbability: 0,
        error: err instanceof Error ? err.message : 'Gagal mendeteksi AI.',
      });
    } finally {
      setAiDetectorLoading(false);
    }
  };

  const handleCheckPlagiarism = async (opts?: { switchTab?: boolean }) => {
      if (!article.trim()) return;
      setPlagiarismLoading(true);
    setPlagiarismResult(null);
      try {
        const result = await checkPlagiarism(stripImages(article));
      setPlagiarismResult(result);
      if (opts?.switchTab ?? true) setActiveEvalTab('plagiarism');
      if (window.innerWidth < 768) setShowMobileEval(true);
    } catch (err) {
      setPlagiarismResult({
        provider: 'none',
        plagiarismScore: 0,
        matchedSources: [],
        error: err instanceof Error ? err.message : 'Gagal memeriksa plagiasi.',
      });
    } finally {
      setPlagiarismLoading(false);
    }
  };

  const rewriteSnippet = async (text: string, mode: 'ai' | 'plagiarism') => {
    const systemPrompt = mode === 'ai'
      ? `Anda adalah editor bahasa Indonesia untuk artikel legal.
Tulis ulang kalimat agar terdengar lebih natural seperti tulisan manusia tanpa mengubah fakta, makna, intent, dan konteks hukum.
Pertahankan panjang relatif mirip, hindari pola repetitif, dan jangan menambah klaim baru.
Kembalikan JSON SAJA: { "rewritten": "..." }`
      : `Anda adalah editor anti-plagiarisme bahasa Indonesia untuk artikel legal.
Tulis ulang teks agar lebih original, tetap akurat, dan tetap membawa makna yang sama.
Gunakan struktur kalimat berbeda, diksi berbeda, dan hindari frasa identik.
Kembalikan JSON SAJA: { "rewritten": "..." }`;

    const { content } = await callChatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.35,
      timeoutMs: 30_000,
    });

    try {
      const data = JSON.parse(content);
      return String(data.rewritten || '').trim();
    } catch {
      return content.trim();
    }
  };

  const handleAutoCorrectAIDetector = async () => {
    if (!aiDetectorResult?.sentences?.length) return;
    const candidates = aiDetectorResult.sentences
      .filter((s) => s.ai_probability >= AI_SENTENCE_HIGHLIGHT_THRESHOLD && s.text.trim().length > 20)
      .slice(0, 8);
    if (candidates.length === 0) {
      setFlashText('Tidak ada kalimat AI tinggi yang bisa diperbaiki.');
      setTimeout(() => setFlashText(''), 2500);
      return;
    }

    setAiDetectorFixLoading(true);
    try {
      let nextArticle = article;
      let fixedCount = 0;
      for (const sentence of candidates) {
        const m = findTextMatch(nextArticle, sentence.text);
        if (!m) continue;
        const rewritten = await rewriteSnippet(nextArticle.slice(m.start, m.end), 'ai');
        if (!rewritten || rewritten.toLowerCase() === nextArticle.slice(m.start, m.end).trim().toLowerCase()) continue;
        nextArticle = nextArticle.slice(0, m.start) + rewritten + nextArticle.slice(m.end);
        fixedCount += 1;
      }

      if (fixedCount === 0) {
        setFlashText('Belum ada bagian yang bisa di-auto-correct.');
        setTimeout(() => setFlashText(''), 2500);
        return;
      }

      pushUndo();
      setArticleFromMarkdown(nextArticle);
      const newReport = runSopChecks({ article: nextArticle, keyword, metaTitle, metaDesc });
      setLiveReport(newReport);
      setReport(newReport);
      setFlashText(`${fixedCount} bagian AI berhasil diperbaiki.`);
      setTimeout(() => setFlashText(''), 2500);

      const refreshed = await detectAIContent(stripImages(nextArticle));
      setAiDetectorResult(refreshed);
      requestAnimationFrame(() => applyHighlights(undefined, 'ai-detector'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal auto-correct AI detector.';
      setFlashText(msg);
      setTimeout(() => setFlashText(''), 3500);
    } finally {
      setAiDetectorFixLoading(false);
    }
  };

  const handleAutoCorrectPlagiarism = async () => {
    if (!plagiarismResult?.matchedSources?.length) return;
    const candidates = plagiarismResult.matchedSources
      .filter((s) => s.score >= PLAGIARISM_HIGHLIGHT_THRESHOLD && s.matchedText.trim().length > 20)
      .slice(0, 8);
    if (candidates.length === 0) {
      setFlashText('Tidak ada teks plagiarisme yang bisa diperbaiki.');
      setTimeout(() => setFlashText(''), 2500);
      return;
    }

    setPlagiarismFixLoading(true);
    try {
      let nextArticle = article;
      let fixedCount = 0;
      for (const source of candidates) {
        const m = findTextMatch(nextArticle, source.matchedText);
        if (!m) continue;
        const rewritten = await rewriteSnippet(nextArticle.slice(m.start, m.end), 'plagiarism');
        if (!rewritten || rewritten.toLowerCase() === nextArticle.slice(m.start, m.end).trim().toLowerCase()) continue;
        nextArticle = nextArticle.slice(0, m.start) + rewritten + nextArticle.slice(m.end);
        fixedCount += 1;
      }

      if (fixedCount === 0) {
        setFlashText('Belum ada bagian yang bisa di-auto-correct.');
        setTimeout(() => setFlashText(''), 2500);
        return;
      }

      pushUndo();
      setArticleFromMarkdown(nextArticle);
      const newReport = runSopChecks({ article: nextArticle, keyword, metaTitle, metaDesc });
      setLiveReport(newReport);
      setReport(newReport);
      setFlashText(`${fixedCount} bagian plagiarisme berhasil diperbaiki.`);
      setTimeout(() => setFlashText(''), 2500);

      const refreshed = await checkPlagiarism(stripImages(nextArticle));
      setPlagiarismResult(refreshed);
      requestAnimationFrame(() => applyHighlights(undefined, 'plagiarism'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal auto-correct plagiarisme.';
      setFlashText(msg);
      setTimeout(() => setFlashText(''), 3500);
    } finally {
      setPlagiarismFixLoading(false);
    }
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

    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_SIZE) {
      setFlashText('Ukuran file maksimal 10 MB.');
      setTimeout(() => setFlashText(''), 4000);
      e.target.value = '';
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['pdf', 'docx', 'txt', 'md'].includes(ext)) {
      setFlashText('Format file tidak didukung. Gunakan .pdf, .docx, .txt, atau .md.');
      setTimeout(() => setFlashText(''), 4000);
      e.target.value = '';
      return;
    }

    setFileImportLoading(true);
    setFlashText('Membaca file...');

    try {
      let text = '';

      if (ext === 'pdf') {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        const pages: string[] = [];
        let totalTextItems = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
          try {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const fontSize = 12;
            const Y_TOL = fontSize * 0.5;
            const PARA_GAP = fontSize * 1.8;
            const SPACE_GAP = fontSize * 0.3;
            const textItems = content.items.filter((it): it is any => 'str' in it);
            totalTextItems += textItems.length;
            console.log(`PDF page ${i}: ${textItems.length} text items`);
            if (textItems.length === 0) continue;

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

              const ratio = line.h / avgHeight;
              let headingPrefix = '';
              if (ratio >= 2.0 && raw.length < 100) headingPrefix = '# ';
              else if (ratio >= 1.4 && raw.length < 120) headingPrefix = '## ';
              else if (ratio >= 1.15 && raw.length < 120) headingPrefix = '### ';
              pageLines.push(prefix + headingPrefix + raw);
              prevY = line.y;
            }

            pages.push(pageLines.join(''));
          } catch (pageErr) {
            console.error(`PDF page ${i} extraction error:`, pageErr);
          }
        }
        if (totalTextItems === 0) {
          throw new Error('PDF_EMPTY_TEXT: PDF tidak mengandung teks yang dapat diekstrak.');
        }
        text = pages.join('\n\n').trim();
        if (!text) {
          throw new Error('PDF_EMPTY_TEXT: PDF tidak mengandung teks yang dapat diekstrak.');
        }
        setArticleFromMarkdown(text);
      } else if (ext === 'docx') {
        const buf = await file.arrayBuffer();
        const result = await mammoth.convertToHtml(
          { arrayBuffer: buf },
          { convertImage: mammoth.images.dataUri },
        );
        const html = result.value;
        setEditorHtml(html);
        setHtmlContent(html);
        setArticle(htmlToMarkdown(html));
      } else {
        text = await file.text();
        setArticleFromMarkdown(text);
      }
      setFlashText('File berhasil dibaca.');
      setTimeout(() => setFlashText(''), 2000);
    } catch (err) {
      console.error('File upload error:', err);
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('password') || msg.includes('encrypted')) {
        setFlashText('Gagal: file PDF terenkripsi atau memerlukan password.');
      } else if (msg.includes('PDF_EMPTY_TEXT')) {
        setFlashText('PDF tidak mengandung teks. Pastikan PDF bukan hasil scan/gambar.');
      } else if (msg.includes('Invalid') || msg.includes('corrupt')) {
        setFlashText('Gagal: file rusak atau tidak dapat diproses.');
      } else {
        setFlashText('Gagal membaca file: pastikan format file didukung.');
      }
      setTimeout(() => setFlashText(''), 4000);
    } finally {
      setFileImportLoading(false);
      e.target.value = '';
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
        const img = new Image();
        img.onload = () => {
          const maxDefault = 600;
          const defaultWidth = Math.min(img.naturalWidth, maxDefault);
          editor.focus();
          document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="${file.name.replace(/\.[^.]+$/, '')}" width="${defaultWidth}" style="max-width:100%;border-radius:8px;" data-align="inline" />`);
          syncFromEditor();
        };
        img.src = dataUrl;
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
      const result = await callArticleChat(article, prompt, OPENAI_API_KEY);
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

  const doReset = () => {
    setArticle('');
    setHtmlContent('');
    setKeyword('');
    setMetaTitle('');
    setMetaDesc('');
    setChatMessages([]);
    setReport(null);
    setLiveReport(null);
    setAiResults(null);
    setAiError(null);
    localStorage.removeItem(DRAFT_KEY);
    if (editorRef.current) editorRef.current.innerHTML = '';
    setShowResetModal(false);
  };

  const exportPdf = async () => {
    const container = document.createElement('div');
    container.innerHTML = htmlContent;
    container.style.padding = '24px';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.fontSize = '12pt';
    container.style.lineHeight = '1.6';
    container.style.color = '#1e293b';
    container.style.maxWidth = '210mm';
    container.style.background = '#fff';

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      h1, h2, h3, h4, h5, h6 { color: #0f172a; line-height: 1.3; margin: 18pt 0 10pt; font-weight: 700; }
      h1 { font-size: 22pt; }
      h2 { font-size: 18pt; }
      h3 { font-size: 15pt; }
      p { margin: 0 0 10pt; }
      ul, ol { margin: 0 0 10pt 18pt; padding-left: 18pt; }
      ul { list-style-type: disc; }
      ol { list-style-type: decimal; }
      li { margin: 0 0 4pt 0; }
      li > p { margin: 0; }
      blockquote { margin: 10pt 0; padding: 10pt 14pt; border-left: 4px solid #cbd5e1; color: #475569; font-style: italic; background: #f8fafc; }
      a { color: #2563eb; text-decoration: underline; }
      b, strong { font-weight: 700; }
      i, em { font-style: italic; }
      u { text-decoration: underline; }
      s, strike, del { text-decoration: line-through; }
      img { max-width: 100%; height: auto; display: block; margin: 8px 0; border-radius: 6px; }
      table { width: 100%; border-collapse: collapse; margin: 10pt 0; }
      th, td { border: 1px solid #cbd5e1; padding: 6pt 8pt; text-align: left; }
      th { background: #f1f5f9; font-weight: 700; }
      .text-left, [style*="text-align:left"] { text-align: left; }
      .text-center, [style*="text-align:center"] { text-align: center; }
      .text-right, [style*="text-align:right"] { text-align: right; }
      .text-justify, [style*="text-align:justify"] { text-align: justify; }
      [data-align="left"] { margin-left: 0; margin-right: auto; }
      [data-align="center"] { margin-left: auto; margin-right: auto; }
      [data-align="right"] { margin-left: auto; margin-right: 0; }
    `;
    container.insertBefore(style, container.firstChild);

    document.body.appendChild(container);
    try {
      const opt = {
        margin: [12, 12, 12, 12] as [number, number, number, number],
        filename: `${metaTitle || 'artikel'}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      };
      await html2pdf().set(opt).from(container).save();
    } finally {
      document.body.removeChild(container);
      setShowExportModal(false);
    }
  };

  const exportDocx = async () => {
    const base64ToUint8Array = (b64: string): Uint8Array => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    };

    const getImageDimensions = (src: string, desiredWidth: number): Promise<{ width: number; height: number }> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const ratio = img.naturalHeight / img.naturalWidth || 0.75;
          const width = Math.min(desiredWidth, 600);
          resolve({ width, height: Math.round(width * ratio) });
        };
        img.onerror = () => resolve({ width: desiredWidth, height: Math.round(desiredWidth * 0.75) });
        img.src = src;
      });
    };

    const convertInline = async (el: HTMLElement, forceItalics = false): Promise<docx.TextRun[]> => {
      const runs: docx.TextRun[] = [];
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent || '';
          if (text) runs.push(new docx.TextRun({ text }));
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const child = node as HTMLElement;
          const tag = child.tagName.toLowerCase();
          if (tag === 'br') {
            runs.push(new docx.TextRun({ text: '', break: 1 }));
          } else {
            const text = child.textContent || '';
            if (!text) continue;
            const props: any = {};
            if (tag === 'b' || tag === 'strong') props.bold = true;
            if ((tag === 'i' || tag === 'em') || forceItalics) props.italics = true;
            if (tag === 'u') props.underline = { type: docx.UnderlineType.SINGLE };
            if (tag === 'a') props.color = '#2563eb';
            runs.push(new docx.TextRun({ text, ...props }));
          }
        }
      }
      return runs;
    };

    const convertImage = async (el: HTMLImageElement): Promise<docx.Paragraph | null> => {
      const src = el.getAttribute('src') || '';
      if (!src.startsWith('data:image')) return null;
      const match = src.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
      if (!match) return null;
      const ext = match[1].toLowerCase();
      const data = base64ToUint8Array(match[2]);
      const imageType = ext === 'png' ? 'png' : 'jpg';
      const widthAttr = parseInt(el.getAttribute('width') || '600');
      const { width, height } = await getImageDimensions(src, widthAttr || 600);
      return new docx.Paragraph({
        children: [new docx.ImageRun({ data, transformation: { width, height }, type: imageType })],
      });
    };

    const convertBlock = async (el: HTMLElement): Promise<(docx.Paragraph | null)[]> => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1') return [new docx.Paragraph({ text: el.textContent || '', heading: docx.HeadingLevel.HEADING_1 })];
      if (tag === 'h2') return [new docx.Paragraph({ text: el.textContent || '', heading: docx.HeadingLevel.HEADING_2 })];
      if (tag === 'h3') return [new docx.Paragraph({ text: el.textContent || '', heading: docx.HeadingLevel.HEADING_3 })];
      if (tag === 'p') return [new docx.Paragraph({ children: await convertInline(el) })];
      if (tag === 'blockquote') return [new docx.Paragraph({ children: await convertInline(el, true) })];
      if (tag === 'ul' || tag === 'ol') {
        const updated = await Promise.all(
          Array.from(el.querySelectorAll('li')).map(async (li) =>
            new docx.Paragraph({ children: await convertInline(li), bullet: { level: 0 } })
          ),
        );
        return updated;
      }
      if (tag === 'img') return [await convertImage(el as HTMLImageElement)];
      return [new docx.Paragraph({ children: await convertInline(el) })];
    };

    try {
      const parser = new DOMParser();
      const dom = parser.parseFromString(htmlContent, 'text/html');
      const blocks: docx.Paragraph[] = [];
      for (const node of dom.body.childNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const converted = await convertBlock(node as HTMLElement);
          blocks.push(...converted.filter((p): p is docx.Paragraph => p !== null));
        } else if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent?.trim();
          if (text) blocks.push(new docx.Paragraph({ text }));
        }
      }
      const docxDocument = new docx.Document({
        sections: [{
          properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
          children: blocks,
        }],
      });
      const blob = await docx.Packer.toBlob(docxDocument);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${metaTitle || 'artikel'}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('DOCX export error:', err);
      setFlashText('Gagal export DOCX. Coba lagi.');
      setTimeout(() => setFlashText(''), 3000);
    } finally {
      setShowExportModal(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans antialiased">
      {/* Header */}
      <header id="app-header" className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0 shadow-sm">
        <div id="header-brand" className="flex items-center gap-3">
          <div className="bg-red-700 text-white p-2 rounded-lg shadow-sm shadow-red-700/20">
            <Scale className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <h1 id="app-title" className="text-sm font-bold text-gray-900 tracking-tight leading-tight">Article Legal Checker</h1>
            <span className="text-[10px] text-gray-400 font-medium">Lafirm content workspace</span>
          </div>
          {draftSaved && (
            <span id="draft-saved-badge" className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">Draft tersimpan</span>
          )}
        </div>

        <div id="header-actions" className="flex items-center gap-2">
          <button
            id="header-btn-reset"
            type="button"
            onClick={() => setShowResetModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            id="header-btn-export"
            type="button"
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
          <button
            id="header-btn-upload"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileImportLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className={`w-3.5 h-3.5 ${fileImportLoading ? 'animate-spin' : ''}`} />
            {fileImportLoading ? 'Membaca...' : 'Unggah'}
          </button>
          <input
            id="file-input"
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".txt,.md,.pdf,.docx"
            className="hidden"
          />
          <button
            id="header-btn-example"
            type="button"
            onClick={loadMockArticle}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Contoh
          </button>
        </div>
      </header>

      <main id="app-main" className="grid grid-cols-1 md:grid-cols-[7fr_3fr] md:grid-rows-[auto_1fr] gap-4 p-4 md:p-5" style={{ height: 'calc(130dvh - 4rem)' }}>
        {/* Row 1 Col 1: Setup Artikel */}
        <section id="setup-panel" className={`${showMobileEval ? 'hidden' : 'flex'} md:flex flex-col min-w-0 min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden`}>
          <div className="h-1 bg-gradient-to-r from-red-700 to-red-400" />
          <div id="meta-header" className="px-5 py-5 border-b border-gray-100 bg-gray-50/50 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Setup Artikel</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">Metadata dan fokus keyword</p>
              </div>
              <span className="text-[10px] font-medium text-gray-400 bg-white border border-gray-200 px-2 py-1 rounded-md">{wordCount} kata</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div id="meta-keyword-field" className="col-span-1 bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                <label htmlFor="input-keyword" className="block text-[10px] font-bold uppercase tracking-wider text-red-700 mb-1.5">
                  Keyword
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="input-keyword"
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="mendaftarkan merek"
                    className="flex-1 bg-transparent border-b border-gray-200 hover:border-gray-300 focus:border-red-500 outline-none py-1 text-sm text-gray-800 placeholder:text-gray-300 transition"
                  />
                  {keyword.length > 0 && (
                    <button
                      id="btn-keyword-clear"
                      type="button"
                      onClick={() => setKeyword('')}
                      className="shrink-0 p-1 rounded-md text-gray-300 hover:text-red-600 hover:bg-red-50 transition"
                      title="Hapus keyword"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    id="btn-keyword-generate"
                    type="button"
                    onClick={() => { setShowKwPopup(true); handleAnalyzeKeywords('ai'); }}
                    className="shrink-0 p-1.5 rounded-md text-red-600 hover:text-red-700 hover:bg-red-50 transition"
                    title="Generate keyword dengan AI"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-[10px] text-gray-400 mt-1.5 h-4" aria-live="polite">
                  {keyword.length > 0 && `${keyword.length} karakter`}
                </div>
              </div>
                <div id="meta-title-field" className="col-span-2 bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                <label htmlFor="input-title" className="block text-[10px] font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                  Judul
                </label>
                <div className="relative">
                  <input
                    id="input-title"
                    type="text"
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    placeholder="Judul artikel"
                    className="w-full pr-6 bg-transparent border-b border-gray-200 hover:border-gray-300 focus:border-red-500 outline-none py-1 text-sm font-semibold text-gray-900 placeholder:text-gray-300 transition"
                  />
                  {metaTitle.length > 0 && (
                    <button
                      id="btn-title-clear"
                      type="button"
                      onClick={() => setMetaTitle('')}
                      className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-red-600 transition"
                      title="Hapus judul"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {(() => {
                  const len = metaTitle.length;
                  const max = 60;
                  const color = len > max ? 'text-red-600' : len > max * 0.9 ? 'text-amber-500' : 'text-gray-400';
                  return (
                    <div className={`text-[10px] mt-1.5 h-4 ${color}`} aria-live="polite">
                      {len}/{max} karakter
                    </div>
                  );
                })()}
              </div>
            </div>
            <div id="meta-desc-field" className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
              <label htmlFor="input-desc" className="block text-[10px] font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Deskripsi
              </label>
              <div className="relative">
                <input
                  id="input-desc"
                  type="text"
                  value={metaDesc}
                  onChange={(e) => setMetaDesc(e.target.value)}
                  placeholder="Ringkasan singkat artikel"
                  className="w-full pr-6 bg-transparent border-b border-gray-200 hover:border-gray-300 focus:border-red-500 outline-none py-1 text-sm text-gray-600 placeholder:text-gray-300 transition"
                />
                {metaDesc.length > 0 && (
                  <button
                    id="btn-desc-clear"
                    type="button"
                    onClick={() => setMetaDesc('')}
                    className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-red-600 transition"
                    title="Hapus deskripsi"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {(() => {
                const len = metaDesc.length;
                const max = 160;
                const color = len > max ? 'text-red-600' : len > max * 0.9 ? 'text-amber-500' : 'text-gray-400';
                return (
                  <div className={`text-[10px] mt-1.5 h-4 ${color}`} aria-live="polite">
                    {len}/{max} karakter
                  </div>
                );
              })()}
            </div>
          </div>
        </section>

        {/* Row 1 Col 2: Skor Sampingan */}
        <section id="score-panel" className={`${showMobileEval ? 'hidden' : 'flex'} md:flex flex-col min-w-0 min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden`}>
          <div className="h-1 bg-gradient-to-r from-red-700 to-red-400" />
          <div className="p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-900">Live score</h2>
                {report && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusConfig?.bg} ${statusConfig?.color} ${statusConfig?.border} border`}>
                    {statusConfig?.label}
                  </span>
                )}
              </div>
              {!report && <span className="text-[10px] text-gray-400">Clear priority order for the next edits.</span>}
            </div>

            {!report ? (
              /* Empty state */
              <div className="flex flex-col items-center text-center py-6">
                <div className="w-24 h-24 mb-4 relative animate-pulse">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
                    <defs>
                      <linearGradient id="ringEmpty" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#b91c1c" />
                        <stop offset="100%" stopColor="#fca5a5" />
                      </linearGradient>
                    </defs>
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e7eb" strokeWidth="2" strokeDasharray="4 3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="url(#ringEmpty)" strokeWidth="2" strokeDasharray="20 77.39" strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Scale className="w-7 h-7 text-gray-300" />
                  </div>
                </div>
                <p className="text-sm font-semibold text-gray-500 mb-1">Belum Ada Skor</p>
                <p className="text-[11px] text-gray-400 leading-relaxed mb-3">Klik <strong className="text-red-600 font-semibold">Periksa</strong> untuk menjalankan evaluasi</p>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  Menunggu evaluasi
                </div>
              </div>
            ) : aiLoading ? (
              /* Loading state */
              <div className="flex items-start gap-5 mb-4">
                <div className="relative w-24 h-24 shrink-0">
                  <svg className="w-24 h-24 -rotate-90 animate-spin" style={{ animationDuration: '2s' }} viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#b91c1c" strokeWidth="3" strokeDasharray="48 97.39" strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Loader className="w-5 h-5 text-red-600 animate-spin" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                  {['SEO', 'Structure', 'Intent', 'Tone'].map((label) => (
                    <div key={label} className="flex flex-col items-center justify-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="w-6 h-5 bg-gray-200 rounded animate-pulse mb-1" />
                      <span className="text-[9px] text-gray-300 font-medium">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Ring chart + Sub-scores side by side */
              <div className="flex items-start gap-5 mb-4">
                {/* Ring chart */}
                <div className="relative w-24 h-24 shrink-0">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none"
                      stroke={score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="3" strokeDasharray={`${(score / 100) * 97.39} 97.39`}
                      strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-xl font-bold leading-none ${statusConfig?.color}`}>{score}</span>
                    <span className="text-[9px] text-gray-400 mt-0.5">of 100</span>
                  </div>
                </div>
                {/* Sub-scores */}
                <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                  {([
                    { label: 'SEO', value: aiResults?.subScores?.seo || 0 },
                    { label: 'Structure', value: aiResults?.subScores?.structure || 0 },
                    { label: 'Intent', value: aiResults?.subScores?.intent || 0 },
                    { label: 'Tone', value: aiResults?.subScores?.tone || 0 },
                  ] as const).map(({ label, value }) => (
                    <div key={label} className="flex flex-col items-center justify-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                      <span className={`text-sm font-bold ${value >= 80 ? 'text-emerald-600' : value >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{value}</span>
                      <span className="text-[9px] text-gray-500 font-medium">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Best next move */}
            {aiResults?.bestNextMove && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3 h-3 text-red-500" />
                  <span className="text-[10px] font-semibold text-red-700">Best next move</span>
                </div>
                <p className="text-[11px] text-red-800 leading-relaxed">{aiResults.bestNextMove}</p>
              </div>
            )}
          </div>
        </section>

        {/* Row 2 Col 1: Article Editor */}
        <section id="editor-area" className={`${showMobileEval ? 'hidden' : 'flex'} md:flex flex-col h-full min-w-0 min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden relative`}>
          <div className="h-1 bg-gradient-to-r from-red-700 to-red-400 shrink-0" />
          {/* Toolbar */}
          <div className="px-4 md:px-8 py-2.5 flex flex-nowrap md:flex-wrap overflow-x-auto md:overflow-visible items-center gap-0.5 md:gap-1 border-b border-gray-100 bg-white scrollbar-hide">
            {[
              { icon: Heading1, action: 'h1', label: 'H1' },
              { icon: Heading2, action: 'h2', label: 'H2' },
              { icon: Heading3, action: 'h3', label: 'H3' },
            ].map((item) => (
              <button
                id={`toolbar-${item.action}`}
                key={item.action}
                type="button"
                onClick={() => handleToolbar(item.action)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-red-700 transition"
                title={item.label}
              >
                <item.icon className="w-4 h-4" />
              </button>
            ))}
            <div className="w-px h-5 bg-gray-200 mx-1" />
            {[
              { icon: Bold, action: 'bold', label: 'Bold' },
              { icon: Italic, action: 'italic', label: 'Italic' },
              { icon: Underline, action: 'underline', label: 'Underline' },
            ].map((item) => (
              <button
                id={`toolbar-${item.action}`}
                key={item.action}
                type="button"
                onClick={() => handleToolbar(item.action)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-red-700 transition"
                title={item.label}
              >
                <item.icon className="w-4 h-4" />
              </button>
            ))}
            <div className="w-px h-5 bg-gray-200 mx-1 hidden md:block" />
            <div className="hidden md:flex items-center gap-0.5 md:gap-1">
              {[
                { icon: AlignLeft, action: 'align-left', label: 'Rata Kiri' },
                { icon: AlignCenter, action: 'align-center', label: 'Rata Tengah' },
                { icon: AlignRight, action: 'align-right', label: 'Rata Kanan' },
                { icon: AlignJustify, action: 'align-justify', label: 'Rata Kiri-Kanan' },
              ].map((item) => (
                <button
                  id={`toolbar-${item.action}`}
                  key={item.action}
                  type="button"
                  onClick={() => handleToolbar(item.action)}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-red-700 transition"
                  title={item.label}
                >
                  <item.icon className="w-4 h-4" />
                </button>
              ))}
              <div className="w-px h-5 bg-gray-200 mx-1" />
            </div>
            {[
              { icon: List, action: 'bullet', label: 'Bullet' },
              { icon: ListOrdered, action: 'number', label: 'Numbering' },
              { icon: Quote, action: 'quote', label: 'Quote' },
              { icon: LinkIcon, action: 'link', label: 'Link' },
              { icon: ImageIcon, action: 'image', label: 'Gambar' },
            ].map((item) => (
              <button
                id={`toolbar-${item.action}`}
                key={item.action}
                type="button"
                onClick={() => {
                  if (item.action === 'image') {
                    imageInputRef.current?.click();
                  } else {
                    handleToolbar(item.action);
                  }
                }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-red-700 transition"
                title={item.label}
              >
                <item.icon className="w-4 h-4" />
              </button>
            ))}
            <input
              id="image-input"
              type="file"
              accept="image/*"
              ref={imageInputRef}
              onChange={handleImageUpload}
              className="hidden"
            />
            <div className="flex-1" />
            <div className="flex items-center gap-0.5 mr-3">
              <button
                id="toolbar-undo"
                type="button"
                onClick={handleUndo}
                disabled={undoStackRef.current.length === 0}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title="Undo (Ctrl+Z)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                id="toolbar-redo"
                type="button"
                onClick={handleRedo}
                disabled={redoStackRef.current.length === 0}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title="Redo (Ctrl+Y)"
              >
                <RotateCcw className="w-3.5 h-3.5 scale-x-[-1]" />
              </button>
            </div>
            <div id="toolbar-wordcount" className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-md">{wordCount} kata</div>
          </div>

          {/* WYSIWYG Editor */}
          <div
            id="editor-wrapper"
            ref={editorWrapperRef}
            data-editor-wrapper
            className="flex-1 relative overflow-auto min-h-0 px-4 md:px-10 py-6 md:py-8"
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
              id="editor-surface"
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleEditorInput}
              onPaste={handleEditorPaste}
              onClick={handleEditorClick}
              className="editor-surface w-full h-full outline-none text-base leading-7 text-gray-800 empty:before:content-[attr(data-placeholder)] empty:before:text-gray-300 empty:before:pointer-events-none"
              data-placeholder="Mulai menulis artikel Anda di sini..."
              spellCheck={false}
            />
            {flashText && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="px-3 py-1.5 bg-gray-800 text-white text-xs rounded-full shadow-lg animate-fade-up">
                  Fokus: {flashText.slice(0, 40)}...
                </div>
              </div>
            )}
            {hover && (() => {
              const issue = hover.issue;
              const isSop = hover.kind === 'sop' && !!issue;
              const passed = isSop ? issue!.status === 'passed' : false;
              return (
              <div
                id="issue-popup"
                className="issue-popup fixed z-[100] w-72 bg-white border border-gray-200 shadow-xl rounded-xl p-4 animate-fade-up"
                style={{ left: hover.x, top: hover.y, transform: 'translateX(-50%)' }}
                onMouseEnter={() => clearTimeout(hideTimeoutRef.current)}
                onMouseLeave={scheduleHide}
              >
                <div id="issue-popup-header" className="flex items-start gap-2 mb-2">
                  {passed ? <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
                  <h4 id="issue-popup-title" className="text-sm font-semibold text-gray-900 leading-tight">{hover.label}</h4>
                </div>
                <p id="issue-popup-reason" className="text-xs text-gray-600 leading-relaxed mb-3">{hover.reason}</p>

                {!isSop && hover.text && (
                  <div className="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 mb-2 line-clamp-3">"{hover.text}"</div>
                )}

                {isSop && !passed && (
                  <div id="issue-popup-sop" className="bg-gray-50 rounded-lg p-2.5 text-[11px] text-gray-600">
                    <div className="font-semibold text-gray-800 mb-1">SOP</div>
                    {issue ? SUGGESTED_LABELS[issue.id] || 'Periksa kembali bagian ini sesuai SOP.' : ''}
                  </div>
                )}
                <div id="issue-popup-actions" className="mt-3 flex items-center justify-between">
                  {isSop && !passed && issue && issue.id === 56 ? (
                    <button
                      id="issue-popup-autocorrect-case"
                      type="button"
                      onClick={() => handleAutoCorrectCase(issue)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-red-700 text-white hover:bg-red-800 disabled:opacity-50 disabled:cursor-wait transition"
                    >
                      Auto Correct
                    </button>
                  ) : isSop && !passed && issue ? (
                    <button
                      id="issue-popup-autocorrect"
                      type="button"
                      disabled={fixingId === issue.id}
                      onClick={() => handleAutoCorrect(issue)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-red-700 text-white hover:bg-red-800 disabled:opacity-50 disabled:cursor-wait transition"
                    >
                      {fixingId === issue.id ? 'Memperbaiki...' : 'Auto Correct'}
                    </button>
                  ) : hover.kind === 'ai-detector' ? (
                    <button
                      type="button"
                      disabled={aiDetectorFixLoading}
                      onClick={() => handleAutoCorrectHighlight('ai-detector', hover.text)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-wait transition"
                    >
                      {aiDetectorFixLoading ? 'Memperbaiki...' : 'Auto Correct'}
                    </button>
                  ) : hover.kind === 'plagiarism' ? (
                    <button
                      type="button"
                      disabled={plagiarismFixLoading}
                      onClick={() => handleAutoCorrectHighlight('plagiarism', hover.text)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-wait transition"
                    >
                      {plagiarismFixLoading ? 'Memperbaiki...' : 'Auto Correct'}
                    </button>
                  ) : <span />}

                  {isSop && issue ? (
                    <button
                      id="issue-popup-focus"
                      type="button"
                      onClick={() => focusIssue(issue)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-gray-800 text-white hover:bg-gray-700"
                    >
                      Fokus
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => focusSnippet(hover.text)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-gray-800 text-white hover:bg-gray-700"
                    >
                      Fokus
                    </button>
                  )}
                </div>
              </div>
              );
            })()}
            {selectedImgInfo && (() => {
              const align = selectedImgInfo.align;
              return (
                <div
                  id="image-toolbar"
                  ref={imgToolbarRef}
                  className="fixed z-[100] bg-white border border-gray-200 shadow-xl rounded-xl p-2.5 animate-fade-up flex items-center gap-2"
                  style={{ left: selectedImgInfo.x, top: selectedImgInfo.y, transform: 'translateX(-50%)', touchAction: 'pan-y' }}
                >
                  <input
                    id="image-toolbar-width-slider"
                    type="range"
                  min="100"
                  max={selectedImgInfo.maxWidth}
                  value={selectedImgInfo.width}
                  style={{ touchAction: 'none' }}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setSelectedImgInfo({ ...selectedImgInfo, width: v });
                    const img = selectedImgRef.current;
                    if (img) {
                      const clamped = Math.min(v, selectedImgInfo.maxWidth);
                      img.style.width = clamped + 'px';
                      img.setAttribute('width', String(clamped));
                      syncFromEditor();
                    }
                  }}
                  className="w-32 h-2 range-slider"
                />
                  <input
                    id="image-toolbar-width-number"
                    type="number"
                  min={100}
                  max={selectedImgInfo.maxWidth}
                  value={selectedImgInfo.width}
                  onChange={(e) => {
                    let v = parseInt(e.target.value) || 100;
                    v = Math.max(100, Math.min(v, selectedImgInfo.maxWidth));
                    setSelectedImgInfo({ ...selectedImgInfo, width: v });
                    const img = selectedImgRef.current;
                    if (img) {
                      img.style.width = v + 'px';
                      img.setAttribute('width', String(v));
                      syncFromEditor();
                    }
                  }}
                  className="w-14 text-[11px] text-gray-600 border border-gray-200 rounded-md px-1.5 py-1 text-center focus:outline-none focus:border-red-400"
                />
                <div className="w-px h-4 bg-gray-200 mx-0.5" />
                {['inline', 'center', 'right'].map((a) => (
                  <button
                    id={`image-toolbar-align-${a}`}
                    key={a}
                    type="button"
                    onClick={() => {
                      setSelectedImgInfo({ ...selectedImgInfo, align: a });
                      const img = selectedImgRef.current;
                      if (!img) return;
                      img.setAttribute('data-align', a);
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
                    className={`p-1.5 rounded-md transition ${align === a ? 'bg-red-700 text-white' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                    title={a === 'inline' ? 'Rata Kiri' : a === 'center' ? 'Rata Tengah' : 'Rata Kanan'}
                  >
                    {a === 'inline' ? <AlignLeft className="w-3.5 h-3.5" /> : a === 'center' ? <AlignCenter className="w-3.5 h-3.5" /> : <AlignRight className="w-3.5 h-3.5" />}
                  </button>
                ))}
                <div className="w-px h-4 bg-gray-200 mx-0.5" />
                <button
                  id="image-toolbar-delete"
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
          <div id="chatbot-container" className="absolute bottom-6 right-4 z-[100] flex flex-col items-end gap-3">
          {chatOpen && (
            <div id="chat-panel" ref={chatRef} className="w-80 sm:w-96 h-96 bg-white border border-gray-200 shadow-2xl rounded-2xl flex flex-col overflow-hidden animate-fade-up">
              <div id="chat-header" className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                <span id="chat-title" className="text-sm font-semibold text-gray-800">Asisten Artikel</span>
                <div id="chat-header-actions" className="flex items-center gap-1">
                  {chatMessages.length > 0 && (
                    <button
                      id="chat-btn-clear"
                      type="button"
                      onClick={() => setChatMessages([])}
                      className="text-gray-400 hover:text-red-600 transition p-1 leading-none"
                      title="Hapus riwayat chat"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button id="chat-btn-close" type="button" onClick={() => setChatOpen(false)} className="text-gray-300 hover:text-gray-500 transition text-lg leading-none">×</button>
                </div>
              </div>
              <div id="chat-messages" className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                {chatMessages.length === 0 && (
                  <div id="chat-welcome" className="text-gray-400 text-center py-8">
                    <p className="font-medium text-gray-500 mb-1">Tanya Asisten Artikel</p>
                    <p className="text-[11px]">Contoh: "perbaiki grammar", "tambah paragraf tentang sanksi hukum", "buat pembukaan lebih profesional"</p>
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div id={`chat-message-${i}`} key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700'}`}>
                      {m.role === 'assistant' && !m.content.startsWith('⚠️') ? (
                        <div>
                          <span className="line-clamp-6">{m.content}</span>
                          {m.type === 'article' && (
                            <button
                              id={`chat-btn-apply-${i}`}
                              type="button"
                              onClick={() => setArticleFromMarkdown(m.content)}
                              className="block mt-1.5 text-[10px] font-medium text-red-600 hover:text-red-700"
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
                  <div id="chat-loading" className="flex justify-start">
                    <div className="bg-gray-100 text-gray-400 rounded-xl px-3 py-2 text-[11px]">Menulis...</div>
                  </div>
                )}
              </div>
              <div id="chat-input-area" className="border-t border-gray-100 p-3 flex gap-2">
                <input
                  id="chat-input"
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleChatSend())}
                  placeholder="Tanya asisten..."
                  disabled={chatLoading}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-red-400 transition placeholder:text-gray-300 disabled:opacity-50"
                />
                <button
                  id="chat-btn-send"
                  type="button"
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-3 py-2 bg-red-700 text-white text-xs font-medium rounded-lg hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition shrink-0"
                >
                  Kirim
                </button>
              </div>
            </div>
          )}
          <button
            id="chat-btn-toggle"
            type="button"
            onClick={() => setChatOpen(!chatOpen)}
            className="w-11 h-11 bg-red-700 text-white rounded-full shadow-lg shadow-red-700/20 hover:bg-red-800 transition flex items-center justify-center"
            title="Buka Asisten Artikel"
          >
            <Bot className="w-5 h-5" />
          </button>
        </div>
        </section>

        {/* Row 2 Col 2: Evaluasi Artikel */}
        <aside id="eval-panel" className={`${showMobileEval ? 'flex' : 'hidden'} md:flex flex-col h-full min-w-0 min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden`}>
          <div className="h-1 bg-gradient-to-r from-red-700 to-red-400 shrink-0" />
          <div id="eval-header" className="p-5 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h2 id="eval-title" className="text-sm font-bold text-gray-900">Evaluasi Artikel</h2>
              <button
                id="btn-periksa"
                type="button"
                onClick={runAllChecks}
                disabled={isAnalyzing || aiLoading || aiDetectorLoading || plagiarismLoading || !article.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-700 text-white text-xs font-semibold rounded-lg hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm shadow-red-700/20"
              >
                {isAnalyzing || aiLoading || aiDetectorLoading || plagiarismLoading ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="#ffffff" strokeWidth="3" strokeOpacity="0.3" />
                      <circle cx="12" cy="12" r="10" stroke="#ffffff" strokeWidth="3" strokeDasharray="31.4 62.8" strokeLinecap="round" />
                    </svg> Memeriksa...
                  </>
                ) : (
                  <>
                    <Target className="w-3.5 h-3.5" /> Periksa
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="px-5 pt-4 border-b border-gray-100">
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              {([
                { id: 'sop', label: 'SOP', icon: Target },
                { id: 'ai-detector', label: 'AI Detector', icon: ShieldCheck },
                { id: 'plagiarism', label: 'Plagiarism', icon: ScanLine },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveEvalTab(id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold rounded-md transition ${activeEvalTab === id ? 'bg-white text-red-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div data-eval-panel className="flex-1 overflow-y-auto min-h-0 p-5 pb-20 md:pb-5">
            {(() => {
              const _sopLoading = (isAnalyzing || aiLoading) && !aiResults;
              const _aiDetLoading = aiDetectorLoading && !aiDetectorResult;
              const _plagLoading = plagiarismLoading && !plagiarismResult;
              const _tabLoading = activeEvalTab === 'sop' ? _sopLoading : activeEvalTab === 'ai-detector' ? _aiDetLoading : _plagLoading;
              if (_tabLoading) return (
                <div className="flex items-center justify-center h-full min-h-[250px]">
                  <div className="flex flex-col items-center gap-4">
                    <svg className="w-10 h-10 animate-spin" viewBox="0 0 24 24" fill="none" style={{ animationDuration: '0.8s' }}>
                      <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
                      <circle cx="12" cy="12" r="10" stroke="#b91c1c" strokeWidth="3" strokeDasharray="31.4 62.8" strokeLinecap="round" />
                    </svg>
                    <span className="text-sm font-medium text-gray-500">Menganalisis artikel...</span>
                  </div>
                </div>
              );
              return (
                <>
                  {activeEvalTab !== 'sop' ? null : !report ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-50 to-gray-50 border border-dashed border-gray-300 flex items-center justify-center mb-4">
                        <Target className="w-7 h-7 text-gray-400" />
                      </div>
                      <p className="text-sm font-semibold text-gray-500 mb-1">Belum Ada Evaluasi</p>
                      <p className="text-xs text-gray-400 max-w-44 leading-relaxed">
                        Klik <strong className="text-red-600 font-semibold">Periksa</strong> di atas untuk menjalankan SOP check pada artikel Anda
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-gray-900 mb-4">Daftar Issue</h3>
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
                          const co = isPassed ? 'text-emerald-500' : st === 'deferred' ? 'text-gray-400' : 'text-red-500';
                          const itemForReason = iss || report.items.find((item) => cat.checks.includes(item.id));
                          return (
                            <button key={cat.id} type="button" onClick={() => clickable && iss && focusIssue(iss)} disabled={!clickable}
                              className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl border transition text-left group ${clickable && !isPassed ? 'bg-white border-gray-200 hover:bg-gray-50 cursor-pointer' : isPassed ? 'bg-gray-50/50 border-gray-100 cursor-default' : 'bg-gray-50/60 border-transparent cursor-default'}`}>
                              <I className={`w-4 h-4 shrink-0 ${co}`} />
                              <div className="flex-1 min-w-0">
                                <div className={`text-xs font-medium ${isPassed ? 'text-gray-500' : 'text-gray-800'}`}>{cat.label}</div>
                                {itemForReason && <div className="text-[10px] text-gray-400 leading-snug mt-0.5">{itemForReason.reason}</div>}
                              </div>
                              {isPassed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : clickable && <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0 opacity-0 group-hover:opacity-100 transition" />}
                            </button>
                          );
                        };
                        return (
                          <>
                            {a.length > 0 && <div><div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-0.5">Dapat diperbaiki</div>{a.map((c) => renderRow(c, true))}</div>}
                            {b.length > 0 && <div className={a.length > 0 ? 'mt-4' : ''}><div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-0.5">Informasi</div>{b.map((c) => renderRow(c, false))}</div>}
                            {c.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-gray-100">
                                <button type="button" onClick={() => setShowPassedIssues(!showPassedIssues)}
                                  className="flex items-center gap-2 text-[10px] font-medium text-gray-400 hover:text-gray-600 transition px-0.5"
                                >
                                  <span className={`inline-block transition-transform ${showPassedIssues ? 'rotate-90' : ''}`}>▶</span>
                                  {showPassedIssues ? 'Sembunyikan' : 'Lihat'}{' '}
                                  <span className="text-gray-400">{c.length} kategori lulus</span>
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

                  {activeEvalTab === 'sop' ? (
                    <div className="mt-6 pt-5 border-t border-gray-200">
                      <h3 className="text-xs font-bold text-gray-900 mb-3 flex items-center gap-1.5">
                        <BrainCircuit className="w-3.5 h-3.5 text-gray-600" /> AI Evaluation
                      </h3>

                      {!aiResults && (
                        <div className="flex flex-col items-center gap-3 py-8 text-center">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-50 to-gray-50 border border-dashed border-gray-300 flex items-center justify-center">
                            <BrainCircuit className="w-5 h-5 text-gray-400" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-500 mb-0.5">Analisis AI</p>
                            <p className="text-[10px] text-gray-400 leading-relaxed">Klik <strong className="text-red-600 font-semibold">Periksa</strong> untuk hasil</p>
                          </div>
                        </div>
                      )}

                      {aiResults && aiResults.results.length > 0 && (() => {
                        return (
                          <>
                            <div className="space-y-4">
                              {aiResults.results.map((r) => {
                                const score = r.aiConfidence || 0;
                                const passed = r.status === 'passed';
                                const hasText = !!r.problematic_text?.trim();
                                const Card = hasText && !passed ? 'button' : 'div';
                                const cardProps = hasText && !passed ? { type: 'button' as const, onClick: () => focusIssue(r) } : {};
                                return (
                                  <Card key={r.id} {...cardProps}
                                    className={`w-full flex flex-col p-3 rounded-xl border text-left transition group ${hasText && !passed ? 'bg-white border-gray-200 hover:bg-gray-50 cursor-pointer' : 'bg-white border-gray-100'}`}
                                  >
                                    <div className="flex items-start gap-2.5">
                                      {passed ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                      ) : (
                                        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="text-[11px] font-medium text-gray-800 mb-0.5 leading-snug">{r.question}</div>
                                        <div className="text-[10px] text-gray-500 leading-snug">{r.reason || '-'}</div>
                                        {hasText && (
                                          <div className="mt-1 text-[10px] text-gray-400 bg-gray-50 border border-gray-200 px-2 py-1 rounded">&ldquo;{r.problematic_text}&rdquo;</div>
                                        )}
                                      </div>
                                      <div className="flex flex-col items-center gap-1 shrink-0 min-w-[24px]">
                                        <span className={`text-[10px] font-bold ${passed ? 'text-emerald-600' : 'text-red-500'}`}>{score}</span>
                                      </div>
                                    </div>
                                    <div className="mt-2 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${passed ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ width: `${score}%` }} />
                                    </div>
                                  </Card>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                      {aiResults && aiResults.results.length === 0 && (
                        <div className={`flex items-center gap-2.5 p-3 rounded-xl border ${aiError ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
                          {aiError ? (
                            <>
                              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                              <span className="text-[11px] text-red-700 leading-relaxed">{aiError || 'Evaluasi AI gagal. Pastikan Ollama berjalan dan API key valid.'}</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              <span className="text-[11px] text-emerald-700 leading-relaxed">AI tidak menemukan masalah pada artikel ini.</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {activeEvalTab === 'ai-detector' ? (
                    <div className="flex flex-col" style={{ minHeight: '200px' }}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-red-600" />
                          <span className="text-xs font-bold text-gray-900">AI Content Detector</span>
                        </div>
                        <span className="text-[10px] text-gray-400">Gunakan tombol Periksa utama</span>
                      </div>

                      {!aiDetectorResult && !aiDetectorLoading && (
                        <div className="flex flex-col items-center justify-center h-full text-center py-12">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-50 to-gray-50 border border-dashed border-gray-300 flex items-center justify-center mb-4">
                            <ShieldCheck className="w-7 h-7 text-gray-400" />
                          </div>
                          <p className="text-sm font-semibold text-gray-500 mb-1">AI Detector</p>
                          <p className="text-xs text-gray-400 max-w-48 leading-relaxed">
                            Deteksi apakah teks terdeteksi sebagai AI-generated menggunakan ChatGPT.
                          </p>
                        </div>
                      )}

                      {aiDetectorResult?.error && (
                        <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-700 leading-relaxed">
                          {aiDetectorResult.error}
                        </div>
                      )}

                      {aiDetectorResult && !aiDetectorResult.error && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-4">
                            <div className="relative w-20 h-20 shrink-0">
                              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                                <circle cx="18" cy="18" r="15.5" fill="none"
                                  stroke={aiDetectorResult.aiProbability >= 50 ? '#ef4444' : '#22c55e'}
                                  strokeWidth="3" strokeDasharray={`${(aiDetectorResult.aiProbability / 100) * 97.39} 97.39`}
                                  strokeLinecap="round" />
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900">{aiDetectorResult.aiProbability}%</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-gray-700 mb-1">
                                {aiDetectorResult.aiProbability >= 50 ? 'Kemungkinan AI-generated' : 'Kemungkinan Human-written'}
                              </p>
                              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${aiDetectorResult.aiProbability}%`, backgroundColor: aiDetectorResult.aiProbability >= 50 ? '#ef4444' : '#22c55e' }} />
                              </div>
                            </div>
                          </div>

                          {aiDetectorResult.sentences && aiDetectorResult.sentences.some((s) => s.ai_probability >= AI_SENTENCE_HIGHLIGHT_THRESHOLD) && (
                            <button
                              type="button"
                              onClick={handleAutoCorrectAIDetector}
                              disabled={aiDetectorFixLoading}
                              className="w-full px-3 py-2 text-[11px] font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-700 hover:to-violet-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 shadow-sm"
                            >
                              {aiDetectorFixLoading ? (
                                <><svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="3" strokeOpacity="0.3" /><circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="3" strokeDasharray="31.4 62.8" strokeLinecap="round" /></svg> Memperbaiki...</>
                              ) : (
                                <><Sparkles className="w-3 h-3" /> Auto Correct AI Detector</>
                              )}
                            </button>
                          )}

                          {aiDetectorResult.explanation && (
                            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                              <p className="text-[10px] text-gray-700 leading-relaxed">{aiDetectorResult.explanation}</p>
                            </div>
                          )}

                          {aiDetectorResult.sentences && aiDetectorResult.sentences.length > 0 && (
                            <div className="border border-gray-200 rounded-xl overflow-hidden">
                              <div className="bg-gray-50 px-3 py-2 text-[10px] font-semibold text-gray-600 border-b border-gray-200">
                                Detail per kalimat
                              </div>
                              <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                                {aiDetectorResult.sentences.map((s, i) => (
                                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50">
                                    <span className={`text-[10px] font-semibold shrink-0 ${s.ai_probability >= 50 ? 'text-red-600' : 'text-emerald-600'}`}>{s.ai_probability}%</span>
                                    <p className="text-[10px] text-gray-600 leading-snug">{s.text}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {activeEvalTab === 'plagiarism' ? (
                    <div className="flex flex-col" style={{ minHeight: '200px' }}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-1.5">
                          <ScanLine className="w-4 h-4 text-red-600" />
                          <span className="text-xs font-bold text-gray-900">Plagiarism Checker</span>
                        </div>
                        <span className="text-[10px] text-gray-400">Gunakan tombol Periksa utama</span>
                      </div>

                      {!plagiarismResult && !plagiarismLoading && (
                        <div className="flex flex-col items-center justify-center h-full text-center py-12">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-50 to-gray-50 border border-dashed border-gray-300 flex items-center justify-center mb-4">
                            <ScanLine className="w-7 h-7 text-gray-400" />
                          </div>
                          <p className="text-sm font-semibold text-gray-500 mb-1">Plagiarism Checker</p>
                          <p className="text-xs text-gray-400 max-w-48 leading-relaxed">
                            Periksa plagiasi artikel menggunakan ChatGPT.
                          </p>
                        </div>
                      )}

                      {plagiarismResult?.error && (
                        <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-700 leading-relaxed">
                          {plagiarismResult.error}
                        </div>
                      )}

                      {plagiarismResult && !plagiarismResult.error && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-4">
                            <div className="relative w-20 h-20 shrink-0">
                              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                                <circle cx="18" cy="18" r="15.5" fill="none"
                                  stroke={plagiarismResult.plagiarismScore >= 30 ? '#ef4444' : '#22c55e'}
                                  strokeWidth="3" strokeDasharray={`${(plagiarismResult.plagiarismScore / 100) * 97.39} 97.39`}
                                  strokeLinecap="round" />
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900">{plagiarismResult.plagiarismScore}%</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-gray-700 mb-1">
                                {plagiarismResult.plagiarismScore >= 30 ? 'Plagiasi terdeteksi' : 'Plagiasi rendah'}
                              </p>
                            </div>
                          </div>

                          {plagiarismResult.matchedSources.some((s) => s.score >= PLAGIARISM_HIGHLIGHT_THRESHOLD) && (
                            <button
                              type="button"
                              onClick={handleAutoCorrectPlagiarism}
                              disabled={plagiarismFixLoading}
                              className="w-full px-3 py-2 text-[11px] font-semibold text-white rounded-lg bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-700 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 shadow-sm"
                            >
                              {plagiarismFixLoading ? (
                                <><svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="3" strokeOpacity="0.3" /><circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="3" strokeDasharray="31.4 62.8" strokeLinecap="round" /></svg> Memperbaiki...</>
                              ) : (
                                <><Sparkles className="w-3 h-3" /> Auto Correct Plagiarism</>
                              )}
                            </button>
                          )}

                          {plagiarismResult.explanation && (
                            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                              <p className="text-[10px] text-gray-700 leading-relaxed">{plagiarismResult.explanation}</p>
                            </div>
                          )}

                          {plagiarismResult.matchedSources.length > 0 && (
                            <div className="border border-gray-200 rounded-xl overflow-hidden">
                              <div className="bg-gray-50 px-3 py-2 text-[10px] font-semibold text-gray-600 border-b border-gray-200">
                                Sumber yang cocok
                              </div>
                              <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                                {plagiarismResult.matchedSources.map((s, i) => (
                                  <div key={i} className="p-2 rounded-lg bg-gray-50">
                                    <a href={s.url} target="_blank" rel="noreferrer" className="text-[10px] text-red-600 hover:underline block truncate">{s.url || 'Sumber tidak diketahui'}</a>
                                    <p className="text-[10px] text-gray-600 mt-0.5 italic truncate">"{s.matchedText}"</p>
                                    <span className="text-[9px] font-semibold text-gray-500">Kecocokan: {s.score}%</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              );
            })()}
            {aiResults && (() => {
              const caseIssues = aiResults.results.filter((r) => r.id === 56 && r.status === 'failed' && r.problematic_text?.trim());
              if (caseIssues.length === 0) return null;
              return (
              <div className="mt-5 pt-4 border-t border-gray-200">
                <h3 className="text-xs font-bold text-gray-700 mb-3 flex items-center gap-1.5">
                  <span className="text-[10px] font-bold tracking-tight text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">Aa</span> Rekomendasi Kapitalisasi
                </h3>
                <div className="text-[10px] text-gray-400 mb-3 leading-relaxed">
                  Klik item untuk lokasi kata. Klik <strong>Auto Correct</strong> di popup untuk perbaiki kapitalisasi.
                </div>
                <div className="space-y-2">
                  {caseIssues.map((r, i) => (
                    <button key={i} type="button" onClick={() => focusIssue(r)}
                      className="w-full flex items-start gap-2.5 p-2.5 rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 transition text-left cursor-pointer group"
                    >
                      <span className="text-[9px] font-bold text-gray-400 mt-0.5 shrink-0 w-4 text-center">Aa</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-gray-700 font-medium leading-snug">{r.reason}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5 italic truncate">"{r.problematic_text}"</div>
                      </div>
                      <span className="text-[8px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition">Klik</span>
                    </button>
                  ))}
                </div>
              </div>
              );
            })()}
          </div>
        </aside>

        {/* Mobile toggle button */}
        <button id="mobile-toggle" type="button" onClick={() => setShowMobileEval((v) => !v)}
          className="md:hidden fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-5 py-2.5 bg-red-700 text-white text-xs font-semibold rounded-full shadow-lg hover:bg-red-800 transition shadow-red-700/20"
        >
          {showMobileEval ? (
            <><RotateCcw className="w-3.5 h-3.5" /> Kembali ke Editor</>
          ) : (
            <><Target className="w-3.5 h-3.5" /> Lihat Evaluasi{report && ` (${report.items.filter((i) => i.status === 'passed').length}/${report.items.length})`}</>
          )}
        </button>
      </main>

      {showKwPopup && (
        <div id="kw-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowKwPopup(false)}>
          <div
            id="kw-modal"
            className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-red-600" />
                <span id="kw-modal-title" className="text-sm font-bold text-gray-900">Keyword Analytics</span>
              </div>
              <button id="kw-modal-close" type="button" onClick={() => setShowKwPopup(false)} className="text-gray-300 hover:text-gray-500 transition text-2xl leading-none">×</button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 min-h-0">
              {kwGenLoading && !ahrefsMetrics.length && (
                <div className="flex items-center justify-center gap-3 py-6">
                  <Loader className="w-5 h-5 animate-spin text-red-600" />
                  <span className="text-xs text-gray-500">AI menganalisis artikel & mengambil data Ahrefs...</span>
                </div>
              )}

              {kwGenError && (
                <div id="kw-modal-error" className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600">{kwGenError}</div>
              )}

              {ahrefsMetrics.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {ahrefsMetrics.length} keyword · {selectedKeywords.size} dipilih
                    </p>
                    <div className="flex gap-2">
                      <button
                        id="kw-modal-select-all"
                        type="button"
                        onClick={selectAllKeywords}
                        className="px-2.5 py-1 text-[10px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                      >
                        Pilih semua
                      </button>
                      <button
                        id="kw-modal-deselect-all"
                        type="button"
                        onClick={deselectAllKeywords}
                        className="px-2.5 py-1 text-[10px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                      >
                        Batal pilih
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="w-8 px-2 py-2"></th>
                          <th className="text-left px-2 py-2 font-semibold text-gray-600">Keyword</th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-600">Volume</th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-600">KD</th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-600">CPC</th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-600">Traffic</th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-600">Relevance /10</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ahrefsMetrics.map((m) => {
                          const rel = computeRelevance(m.keyword, stripImages(article));
                          const kdColor = m.keywordDifficulty >= 60 ? 'text-emerald-600' : m.keywordDifficulty >= 30 ? 'text-amber-600' : 'text-red-600';
                          const relColor = rel >= 7 ? 'text-emerald-600' : rel >= 4 ? 'text-amber-600' : 'text-red-600';
                          return (
                          <tr key={m.keyword} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={selectedKeywords.has(m.keyword)}
                                onChange={() => toggleKeyword(m.keyword)}
                                className="w-3.5 h-3.5 rounded border-gray-300 text-red-700 focus:ring-red-200"
                              />
                            </td>
                            <td className="px-2 py-2 text-gray-800 font-medium truncate max-w-[140px]" title={m.keyword}>{m.keyword}</td>
                            <td className="px-2 py-2 text-right text-gray-600">{m.searchVolume.toLocaleString()}</td>
                            <td className="px-2 py-2 text-right">
                              <span className={`font-semibold ${kdColor}`}>{m.keywordDifficulty}</span>
                            </td>
                            <td className="px-2 py-2 text-right text-gray-600">${m.cpc.toFixed(2)}</td>
                            <td className="px-2 py-2 text-right text-gray-600">{m.trafficPotential.toLocaleString()}</td>
                            <td className="px-2 py-2 text-center">
                              <span className={`inline-flex items-center justify-center min-w-[44px] h-5 px-1.5 text-[9px] font-bold rounded-full ${relColor} bg-gray-50 border border-gray-200`} title={`Relevance ${rel}/10`}>{rel}/10</span>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : !kwGenLoading && (
                <div className="text-center py-8">
                  <Globe className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-xs text-gray-400 leading-relaxed">
                    AI akan merekomendasikan keyword berdasarkan artikel Anda<br />
                    dengan data analitik Ahrefs (Volume, KD, CPC, Traffic).
                  </p>
                </div>
              )}
            </div>

            {ahrefsMetrics.length > 0 && (
              <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
                <button
                  id="kw-modal-cancel"
                  type="button"
                  onClick={() => setShowKwPopup(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition"
                >
                  Batal
                </button>
                <button
                  id="kw-modal-apply"
                  type="button"
                  onClick={applySelectedKeywords}
                  disabled={selectedKeywords.size === 0}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Terapkan ({selectedKeywords.size})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showResetModal && (
        <div id="reset-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowResetModal(false)}>
          <div id="reset-modal" className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div id="reset-modal-header" className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <h3 id="reset-modal-title" className="text-sm font-bold text-gray-900">Reset Artikel</h3>
            </div>
            <p id="reset-modal-desc" className="text-xs text-gray-500 mb-5 leading-relaxed">
              Semua konten artikel, meta data, riwayat chat, dan evaluasi akan dihapus. Draft tersimpan juga akan dihapus. Yakin ingin melanjutkan?
            </p>
            <div id="reset-modal-actions" className="flex gap-2">
              <button
                id="reset-modal-cancel"
                type="button"
                onClick={() => setShowResetModal(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition"
              >
                Batal
              </button>
              <button
                id="reset-modal-confirm"
                type="button"
                onClick={doReset}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-red-700 hover:bg-red-800 transition"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportModal && (
        <div id="export-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowExportModal(false)}>
          <div id="export-modal" className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div id="export-modal-header" className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-gray-600" />
                <h3 id="export-modal-title" className="text-sm font-bold text-gray-900">Export Artikel</h3>
              </div>
              <button id="export-modal-close" type="button" onClick={() => setShowExportModal(false)} className="text-gray-300 hover:text-gray-500 transition text-lg leading-none">×</button>
            </div>
            <p id="export-modal-desc" className="text-xs text-gray-500 mb-4 leading-relaxed">
              Pilih format export. Gambar, heading, daftar, dan gaya teks akan dipertahankan.
            </p>
            <div id="export-modal-options" className="grid grid-cols-2 gap-3">
              <button
                id="export-modal-pdf"
                type="button"
                onClick={exportPdf}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-red-200 hover:bg-red-50 transition"
              >
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-red-600" />
                </div>
                <span className="text-xs font-semibold text-gray-700">PDF</span>
              </button>
              <button
                id="export-modal-docx"
                type="button"
                onClick={exportDocx}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-blue-200 hover:bg-blue-50 transition"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-xs font-semibold text-gray-700">DOCX</span>
              </button>
            </div>
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
        .range-slider {
          -webkit-appearance: none;
          appearance: none;
          background: #e2e8f0;
          border-radius: 999px;
          outline: none;
          height: 6px;
          cursor: pointer;
        }
        .range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .range-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
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
        .editor-surface h1 { font-size: 1.75rem; font-weight: 700; color: #111827; }
        .editor-surface h2 { font-size: 1.375rem; font-weight: 600; color: #111827; }
        .editor-surface h3 { font-size: 1.125rem; font-weight: 600; color: #111827; }
        .editor-surface strong, .editor-surface b { font-weight: 700; }
        .editor-surface em, .editor-surface i { font-style: italic; }
        .editor-surface u { text-decoration: underline; }
        .editor-surface ul { list-style-type: disc; padding-left: 1.5rem; }
        .editor-surface ol { list-style-type: decimal; padding-left: 1.5rem; }
        .editor-surface blockquote { border-left: 3px solid #b91c1c; padding-left: 1rem; color: #4b5563; font-style: italic; }
        .editor-surface a { color: #b91c1c; text-decoration: underline; }
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
        .issue-highlight-detector {
          background-color: rgba(196, 181, 253, 0.4);
          border-bottom: 2px solid rgba(139, 92, 246, 0.4);
          border-radius: 2px;
          cursor: pointer;
        }
        .issue-highlight-detector:hover {
          background-color: rgba(167, 139, 250, 0.55);
        }
        .issue-highlight-plagiarism {
          background-color: rgba(251, 146, 60, 0.35);
          border-bottom: 2px solid rgba(234, 88, 12, 0.4);
          border-radius: 2px;
          cursor: pointer;
        }
        .issue-highlight-plagiarism:hover {
          background-color: rgba(251, 146, 60, 0.55);
        }
        @media (max-width: 767px) {
          .editor-surface { font-size: 15px; line-height: 1.7; }
          .editor-surface h1 { font-size: 1.35rem; }
          .editor-surface h2 { font-size: 1.15rem; }
          .editor-surface h3 { font-size: 1rem; }
          [data-editor-wrapper] { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
          [data-eval-panel] { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
        }
        [contenteditable] { -webkit-tap-highlight-color: transparent; }
        [contenteditable]:focus { outline: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  Send,
  Search,
  Layers,
  Crosshair,
  Volume2,
  Info,
} from 'lucide-react';
import html2pdf from 'html2pdf.js';
import * as docx from 'docx';
import { runSopChecks, evaluateWithAI, getPrimaryKeyword, detectAIContent, checkPlagiarism, fetchAhrefsKeywordMetrics, fetchAhrefsRelatedTerms, generateMockAhrefsMetrics, callChatCompletion, calculateSopScore, splitIntoParagraphs, detectChangedParagraphs, getParagraphContext, evaluateChangedParagraphs, buildInitialState, mergeIncrementalResults, computeArticleHash, buildRecheckCacheFromFullResults, buildRecheckCacheFromAiDetector, runIncrementalRecheck, mergeAiDetectorIncremental, callOllamaGenerateKeywords, type CheckResult, type SopReport, type AiEvaluationOutput, type AIDetectionResult, type PlagiarismResult, type AhrefsKeywordMetric, type IncrementalState, type RecheckCacheEntry, TipTapEditor, type ActiveStyleState, type TipTapEditorHandle, computeEvaluationAccuracy, type EvaluationAccuracy, getAccuracyBadgeClasses, getAccuracyBarColor } from './sop';
import { callArticleChat } from './sop/articleChat';
import { OPENAI_API_KEY, AHREFS_API_KEY, UNDO_STACK_LIMIT } from './sop/config';
import { stripImages } from './sop/images';
import { AiErrorProvider, AiErrorFallback, useAiError } from './sop/AiErrorContext';
import { classifyAiError, logAiError } from './sop/errorHandling';

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
  { id: 'language', label: 'Bahasa', checks: [9, 11] },
  { id: 'cta', label: 'CTA', checks: [10] },
  { id: 'seo', label: 'SEO & Meta', checks: [13, 14, 15, 16] },
];

const SUGGESTED_LABELS: Record<number, string> = {
  1: 'Pertahankan judul yang spesifik dan catchy. Hindari judul yang terlalu umum, tetapi tidak wajib memakai angka.',
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

  // Convert raw HTML <a> tags to markdown link syntax BEFORE HTML escaping.
  // This handles cases where AI responses or pasted content contain raw HTML
  // instead of markdown links — prevents &lt;a&gt; from showing as raw text.
  html = html.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

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
    let attrs = `src="${src}" alt="${alt}" title="${meta}"`;
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
        out.push('<p><br></p>');
      } else if (/^<h[1-4]/.test(trimmed) || /^<blockquote/.test(trimmed)) {
        out.push(line);
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
        const title = el.getAttribute('title') || '';
        const w = el.getAttribute('width') || el.style.width;
        const align = (el.getAttribute('data-align') || 'inline').toLowerCase();
        if (title) {
          return `![${alt}](${src} "${title}")\n`;
        }
        const wNum = w ? String(w).replace('px', '') : '';
        let meta = wNum;
        if (align !== 'inline') meta += (meta ? ' ' : '') + align;
        return meta ? `![${alt}](${src} "${meta}")\n` : `![${alt}](${src})\n`;
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

function extractActualCorrection(suggestedFix: string): string {
  const patterns = [
    /dengan\s+'([^']+)'/i,
    /dengan\s+"([^"]+)"/i,
    /menjadi\s+'([^']+)'/i,
    /menjadi\s+"([^"]+)"/i,
    /seperti\s+'([^']+)'/i,
    /seperti\s+"([^"]+)"/i,
    /menggunakan\s+'([^']+)'/i,
    /menggunakan\s+"([^"]+)"/i,
    /(?:to|into|with)\s+'([^']+)'/i,
    /(?:to|into|with)\s+"([^"]+)"/i,
  ];
  for (const p of patterns) {
    const m = suggestedFix.match(p);
    if (m) return m[1];
  }
  const allQuoted = suggestedFix.match(/'([^']+)'/g);
  if (allQuoted && allQuoted.length >= 2) {
    const last = allQuoted[allQuoted.length - 1];
    return last.replace(/^'|'$/g, '');
  }
  const words = suggestedFix.split(/\s+/).filter((w) => w.length > 2);
  return words[words.length - 1] || suggestedFix;
}

interface Correction {
  original_text: string;
  corrected_text: string;
  reason?: string;
}

function applyCorrectionsToArticle(article: string, corrections: Correction[]): { result: string; applied: number; skipped: number } {
  let result = article;
  let applied = 0;
  let skipped = 0;
  for (const c of corrections) {
    const orig = c.original_text.trim();
    if (!orig) { skipped++; continue; }
    const firstTry = result.indexOf(orig);
    if (firstTry !== -1) {
      result = result.slice(0, firstTry) + c.corrected_text + result.slice(firstTry + orig.length);
      applied++;
      continue;
    }
    const fuzzy = findTextMatch(result, orig);
    if (fuzzy) {
      result = result.slice(0, fuzzy.start) + c.corrected_text + result.slice(fuzzy.end);
      applied++;
      continue;
    }
    skipped++;
  }
  return { result, applied, skipped };
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
      color: 'text-yellow-700',
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
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
  if (items.some((item) => item.status === 'failed' && !item.ignored)) return 'failed';
  if (items.some((item) => item.status === 'info')) return 'info';
  if (items.some((item) => item.status === 'deferred')) return 'deferred';
  return 'passed';
}

function getCategoryIssue(report: SopReport, categoryId: string) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return null;
  return report.items.find((item) => cat.checks.includes(item.id) && item.status !== 'passed' && !item.ignored);
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

function AppContent() {
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
  const { setError, clearError, clearAll, errors: aiFeatureErrors } = useAiError();
  const [hover, setHover] = useState<HoverData | null>(null);
  const [fixingId, setFixingId] = useState<number | null>(null);
  const [flashText, setFlashText] = useState('');
  const [showKwPopup, setShowKwPopup] = useState(false);
  const [kwGenLoading, setKwGenLoading] = useState(false);
  const [kwGenError, setKwGenError] = useState('');

  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [kwInput] = useState('');
  const [fileImportLoading, setFileImportLoading] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showPassedIssues, setShowPassedIssues] = useState(false);
  const [showMobileEval, setShowMobileEval] = useState(false);
  const [animatedScore, setAnimatedScore] = useState(0);
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
  const [metaDescLoading, setMetaDescLoading] = useState(false);
  const [ahrefsMetrics, setAhrefsMetrics] = useState<AhrefsKeywordMetric[]>([]);
  const [activeStyles, setActiveStyles] = useState<ActiveStyleState | null>(null);
  const [evaluationAccuracy, setEvaluationAccuracy] = useState<EvaluationAccuracy | null>(null);
  const [ignoredIds, setIgnoredIds] = useState<Set<number>>(new Set());
  const ignoredIdsRef = useRef<Set<number>>(new Set());
  const [approvedIds, setApprovedIds] = useState<Set<number>>(new Set());
  const approvedIdsRef = useRef<Set<number>>(new Set());
  const [hasChecked, setHasChecked] = useState(false);
  const [focusIndices, setFocusIndices] = useState<Record<number, number>>({});
  const [activeIssueId, setActiveIssueId] = useState<number | null>(null);
  const highlightsBlockedRef = useRef(true);

  const [, setIncrementalResults] = useState<CheckResult[]>([]);
  const incrementalStateRef = useRef<IncrementalState>(buildInitialState());
  const incrementalAbortRef = useRef<AbortController | null>(null);
  const incrementalDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const INCREMENTAL_DEBOUNCE_MS = 1500;

  useEffect(() => { ignoredIdsRef.current = ignoredIds; }, [ignoredIds]);
  useEffect(() => { approvedIdsRef.current = approvedIds; }, [approvedIds]);

  const chatRef = useRef<HTMLDivElement>(null);

  const editorRef = useRef<TipTapEditorHandle>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const showIssuePopupRef = useRef<((target: HTMLElement) => void) | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imgToolbarRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popupRef = useRef<HTMLDivElement>(null);
  const saveDraftTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const recheckCacheRef = useRef<RecheckCacheEntry | null>(null);
  const isUpdatingFromCodeRef = useRef(false);
  const undoStackRef = useRef<{ html: string; keyword: string; metaTitle: string; metaDesc: string }[]>([]);
  const redoStackRef = useRef<{ html: string; keyword: string; metaTitle: string; metaDesc: string }[]>([]);
  const checkingRef = useRef(false);
  const lastUndoRef = useRef(0);
  const prevHtmlRef = useRef('');

  const pushUndo = () => {
    const html = editorRef.current?.getHTML() || markdownToHtml(article);
    undoStackRef.current.push({ html, keyword, metaTitle, metaDesc });
    if (undoStackRef.current.length > UNDO_STACK_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
  };

  const restoreState = (cur: { html: string; keyword: string; metaTitle: string; metaDesc: string }) => {
    setHover(null);
    setKeyword(cur.keyword);
    setMetaTitle(cur.metaTitle);
    setMetaDesc(cur.metaDesc);
    const md = htmlToMarkdown(cur.html);
    setArticle(md);
    isUpdatingFromCodeRef.current = true;
    editorRef.current?.setContent(cur.html);
    isUpdatingFromCodeRef.current = false;
    prevHtmlRef.current = cur.html;
    const restored = runSopChecks({ article: md, keyword: cur.keyword, metaTitle: cur.metaTitle, metaDesc: cur.metaDesc });
    setLiveReport(restored);
    setReport(restored);
    requestAnimationFrame(() => applyHighlights(restored));
  };

  const handleUndo = () => {
    const cur = undoStackRef.current.pop();
    if (!cur) return;
    redoStackRef.current.push({ html: editorRef.current?.getHTML() || markdownToHtml(article), keyword, metaTitle, metaDesc });
    restoreState(cur);
  };

  const handleRedo = () => {
    const cur = redoStackRef.current.pop();
    if (!cur) return;
    undoStackRef.current.push({ html: editorRef.current?.getHTML() || markdownToHtml(article), keyword, metaTitle, metaDesc });
    restoreState(cur);
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
      if (img && editorWrapperRef.current?.contains(img)) {
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
        const above = rect.top - 10 >= 0;
        const pos = positionPopupFor(rect, 288, 250, above, 10);
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

  // Debounced incremental AI checking — only evaluates changed paragraphs
  useEffect(() => {
    if (!article.trim()) {
      setIncrementalResults([]);
      incrementalStateRef.current = buildInitialState();
      return;
    }

    clearTimeout(incrementalDebounceRef.current);
    incrementalDebounceRef.current = setTimeout(async () => {
      incrementalAbortRef.current?.abort();
      incrementalAbortRef.current = new AbortController();
      const signal = incrementalAbortRef.current.signal;

      const prevBlocks = incrementalStateRef.current.paragraphs;
      const newBlocks = splitIntoParagraphs(article);
      incrementalStateRef.current.paragraphs = newBlocks;

      const { changedBlocks, unchangedBlocks } = detectChangedParagraphs(prevBlocks, newBlocks);

      if (changedBlocks.length === 0 && incrementalStateRef.current.lastArticle === article) return;

      incrementalStateRef.current.lastArticle = article;

      const contexts = changedBlocks.map((b) => getParagraphContext(newBlocks, b.index));
      const newResults = await evaluateChangedParagraphs(
        { article, keyword, metaTitle, metaDesc },
        changedBlocks,
        contexts,
        OPENAI_API_KEY,
        signal,
      );

      if (signal.aborted) return;

      const cache = incrementalStateRef.current.cache;
      for (const block of unchangedBlocks) {
        const key = `${block.hash}_${keyword}`;
        if (!cache.has(key)) {
          cache.set(key, { results: [], timestamp: Date.now() });
        }
      }
      for (const block of changedBlocks) {
        const key = `${block.hash}_${keyword}`;
        cache.set(key, { results: newResults.filter((r) => r.id >= 1000 + block.index * 10 && r.id < 1000 + (block.index + 1) * 10), timestamp: Date.now() });
      }

      const cachedResults: CheckResult[] = [];
      for (const block of newBlocks) {
        const key = `${block.hash}_${keyword}`;
        const entry = cache.get(key);
        if (entry) cachedResults.push(...entry.results);
      }

      const mergedResults = mergeIncrementalResults(cachedResults, newResults);
      setIncrementalResults(mergedResults);

      setAiResults((prev) => {
        if (prev && prev.results.some((r) => r.id >= 51 && r.id <= 56)) return prev;
        const existingIds = new Set(prev?.results.map((r) => r.id) || []);
        const newItems = mergedResults.filter((r) => !existingIds.has(r.id));
        if (newItems.length === 0) return prev;
        return {
          results: [...(prev?.results || []), ...newItems],
          subScores: prev?.subScores || { seo: 0, structure: 0, intent: 0, tone: 0 },
          bestNextMove: prev?.bestNextMove || '',
        };
      });
    }, INCREMENTAL_DEBOUNCE_MS);

    return () => clearTimeout(incrementalDebounceRef.current);
  }, [article, keyword, metaTitle, metaDesc]);

  useEffect(() => {
    if (!editorRef.current || !hasChecked) return;
    requestAnimationFrame(() => applyHighlights(undefined, activeEvalTab));
  }, [activeEvalTab, hasChecked]);

  useEffect(() => {
    if (!editorRef.current || activeEvalTab !== 'sop' || !hasChecked) return;
    requestAnimationFrame(() => applyHighlights());
  }, [report, liveReport, hasChecked, aiResults, activeEvalTab]);

  useEffect(() => {
    if (!editorRef.current || activeEvalTab !== 'ai-detector' || !hasChecked) return;
    requestAnimationFrame(() => applyHighlights(undefined, 'ai-detector'));
  }, [aiDetectorResult, activeEvalTab, hasChecked]);

  useEffect(() => {
    if (!editorRef.current || activeEvalTab !== 'plagiarism' || !hasChecked) return;
    requestAnimationFrame(() => applyHighlights(undefined, 'plagiarism'));
  }, [plagiarismResult, activeEvalTab, hasChecked]);

  // Compute evaluation accuracy only after user has clicked "Periksa"
  useEffect(() => {
    if (!hasChecked) { setEvaluationAccuracy(null); return; }
    setEvaluationAccuracy(computeEvaluationAccuracy(aiResults, aiDetectorResult, plagiarismResult));
  }, [aiResults, aiDetectorResult, plagiarismResult, hasChecked]);

  // Load saved draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (typeof data.htmlContent === 'string') {
          setArticle(data.article);
          setHtmlContent(data.htmlContent);
          isUpdatingFromCodeRef.current = true;
          editorRef.current?.setContent(data.htmlContent);
          setTimeout(() => { isUpdatingFromCodeRef.current = false; }, 0);
        } else if (typeof data.article === 'string') {
          setArticleFromMarkdown(data.article);
        }
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
          htmlContent,
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

  // Adjust popup position based on actual rendered dimensions
  useLayoutEffect(() => {
    const el = popupRef.current;
    const target = hoverTargetRef.current;
    if (!el || !target || !hover) return;
    const rect = target.getBoundingClientRect();
    const ph = el.offsetHeight;
    const pw = el.offsetWidth;
    const gap = 10;
    const m = 8;
    let cy = rect.top - ph - gap;
    if (cy < m) cy = rect.bottom + gap;
    if (cy + ph + m > window.innerHeight) cy = Math.max(m, window.innerHeight - ph - m);
    el.style.left = `${clampPopupX(rect.left + rect.width / 2, pw)}px`;
    el.style.top = `${cy}px`;
  }, [hover]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const wordCount = useMemo(() => {
    return getTextContent(htmlContent)
      .split(/\s+/)
      .filter(Boolean).length;
  }, [htmlContent]);

  const activeReport = hasChecked && liveReport ? liveReport : report;

  const score = useMemo(() => {
    if (!activeReport) return 0;
    const effectiveItems = activeReport.items.filter((item) => !ignoredIds.has(item.id));
    if (effectiveItems.length === activeReport.items.length) {
      return Math.round((activeReport.score / activeReport.scoredTotal) * 100);
    }
    const adjusted = calculateSopScore(effectiveItems, wordCount);
    return Math.round((adjusted.score / adjusted.scoredTotal) * 100);
  }, [activeReport, ignoredIds, wordCount]);

  const statusConfig = useMemo(() => (activeReport ? getStatusConfig(activeReport) : null), [activeReport]);

  // Count-up animation for score
  useEffect(() => {
    if (score === 0) { setAnimatedScore(0); return; }
    const duration = 800;
    const start = performance.now();
    const from = animatedScore;
    const raf = requestAnimationFrame(function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(Math.round(from + (score - from) * eased));
      if (progress < 1) requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  const syncFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const html = editor.getHTML();
    setHtmlContent(html);
    setArticle(htmlToMarkdown(html));
    const now = Date.now();
    if (now - lastUndoRef.current > 400) {
      lastUndoRef.current = now;
      pushUndo();
    }
  };

  const setArticleFromMarkdown = (md: string) => {
    setArticle(md);
    const html = markdownToHtml(md);
    setHtmlContent(html);
    isUpdatingFromCodeRef.current = true;
    editorRef.current?.setContent(html);
    prevHtmlRef.current = html;
    setTimeout(() => {
      isUpdatingFromCodeRef.current = false;
      if (editorRef.current) {
        setHtmlContent(editorRef.current.getHTML());
      }
    }, 0);
  };

  const onTipTapUpdate = (html: string) => {
    if (isUpdatingFromCodeRef.current) return;
    setHtmlContent(html);
    setArticle(htmlToMarkdown(html));
    const now = Date.now();
    if (now - lastUndoRef.current > 400) {
      lastUndoRef.current = now;
      // Save the HTML that was current BEFORE this change
      if (prevHtmlRef.current) {
        undoStackRef.current.push({ html: prevHtmlRef.current, keyword, metaTitle, metaDesc });
        if (undoStackRef.current.length > UNDO_STACK_LIMIT) undoStackRef.current.shift();
        redoStackRef.current = [];
      }
    }
    prevHtmlRef.current = html;
  };

  const toolbarToggleClass = (active: boolean) =>
    `btn-toolbar relative overflow-hidden p-2 rounded-lg border transition-all duration-200 group ${active
      ? 'bg-brand-100 text-brand-800 border-brand-200 shadow-sm ring-1 ring-brand-200'
      : 'hover:bg-brand-50 text-surface-600 hover:text-brand-700 border-transparent'
    }`;

  const toolbarIconClass = (active: boolean) =>
    `w-4 h-4 transition-transform ${active ? 'scale-110' : 'group-hover:scale-110'}`;

  const handleToolbar = (action: string) => {
    if (action === 'image') {
      imageInputRef.current?.click();
      return;
    }
    editorRef.current?.execAction(action as any);
    editorRef.current?.focus();
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
  const positionPopupFor = (rect: DOMRect, _width: number, height: number, above: boolean, gap: number) => {
    const m = 8;
    let cy: number;
    if (above) {
      cy = rect.top - height - gap;
      if (cy < m) cy = rect.bottom + gap;
    } else {
      cy = rect.bottom + gap;
    }
    if (cy + height + m > window.innerHeight) cy = Math.max(m, window.innerHeight - height - m);
    return { x: clampPopupX(rect.left + rect.width / 2, _width), y: cy };
  };

  const showIssuePopup = (target: HTMLElement) => {
    if (target.tagName !== 'MARK') return;
    const kind = (target.dataset.kind as HoverKind | undefined) ?? 'sop';

    let popup: HoverData | null = null;
    if (kind === 'sop') {
      const idsAttr = target.dataset.issueIds || target.dataset.issueId;
      if (!idsAttr) return;
      const firstId = Number(idsAttr.split(',')[0]);
      if (isNaN(firstId)) return;
      // Distinguish AI evaluation items (class "issue-highlight-ai" or "issue-highlight-error") from SOP rule items
      const isAiItem = target.classList.contains('issue-highlight-ai') || target.classList.contains('issue-highlight-error');
      const issue = isAiItem
        ? aiResults?.results.find((item) => item.id === firstId)
        : activeReport?.items.find((item) => item.id === firstId);
      if (!issue) return;
      popup = {
        x: 0, y: 0, kind,
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
        x: 0, y: 0, kind,
        label,
        reason,
        text,
        score: scoreRaw ? Number(scoreRaw) : undefined,
      };
    }

    hoverTargetRef.current = target;
    const rect = target.getBoundingClientRect();
    const above = rect.top - 10 >= 0;
    const pos = positionPopupFor(rect, 288, 250, above, 10);
    setHover({
      ...popup,
      x: pos.x,
      y: pos.y,
    });
  };
  showIssuePopupRef.current = showIssuePopup;

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
    const mark = target.tagName === 'MARK' ? target : target.closest('mark');
    if (mark) {
      clearTimeout(hideTimeoutRef.current);
      showIssuePopup(mark as HTMLElement);
    } else if (hover) {
      scheduleHide();
    }
  };

  // Native mousedown → image toolbar (more reliable than synthetic onClick)
  useEffect(() => {
    const el = editorWrapperRef.current;
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
    const handleNativeMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (hoverRef.current && target.closest('.issue-popup')) {
        clearTimeout(hideTimeoutRef.current);
        return;
      }
      const mark = target.tagName === 'MARK' ? target : target.closest('mark');
      if (mark) {
        clearTimeout(hideTimeoutRef.current);
        showIssuePopupRef.current?.(mark as HTMLElement);
      } else if (hoverRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = setTimeout(() => { hoverTargetRef.current = null; setHover(null); }, 300);
      }
    };
    el.addEventListener('mouseover', handleNativeMouseOver);
    return () => {
      el.removeEventListener('mousedown', handleNativeClick);
      el.removeEventListener('mouseover', handleNativeMouseOver);
    };
  }, []);

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const mark = target.tagName === 'MARK' ? target : target.closest('mark');
    if (mark) {
      showIssuePopup(mark as HTMLElement);
    } else {
      setActiveIssueId(null);
      requestAnimationFrame(() => applyHighlights(undefined, activeEvalTab));
    }
  };

  const applyHighlights = (reportOverride?: SopReport, modeOverride?: HighlightMode) => {
    const handle = editorRef.current;
    if (!handle) return;

    const editorEl = handle.getEditorEl();
    if (!editorEl) return;

    const mode = modeOverride ?? activeEvalTab;
    if (highlightsBlockedRef.current && mode !== 'sop') return;

    const highlightedMd = htmlToMarkdown(handle.getHTML());
    type HighlightRange = {
      start: number;
      end: number;
      cls: string;
      kind: HoverKind;
      label: string;
      reason: string;
      text: string;
      score?: number;
      issueIds?: number[];
      startIndex?: number | null;
      endIndex?: number | null;
    };

    const ranges: HighlightRange[] = [];

    if (mode === 'sop') {
      let reportToApply = reportOverride ?? (hasChecked && liveReport ? liveReport : report);
      if (!reportToApply) return;

      if (!reportOverride && aiResults) {
        const lowerArticle = article.toLowerCase();
        const failedAi = aiResults.results.filter(
          (r) => (r.status === 'failed' || r.status === 'info') && r.problematic_text?.trim().length > 0 && r.id !== 56 && (
            r.problematic_text.split('|||').some((t) => lowerArticle.includes(t.trim().toLowerCase()))
          ),
        );
        if (failedAi.length > 0) {
          reportToApply = {
            ...reportToApply,
            items: [...reportToApply.items, ...failedAi],
          };
        }
      }

      reportToApply = {
        ...reportToApply,
        items: reportToApply.items.filter((item) => !ignoredIds.has(item.id)),
      };

      const issues = reportToApply.items.filter(
        (item) => item.problematic_text?.trim().length > 0,
      );
      for (const issue of issues) {
        const texts = issue.problematic_text.split('|||');
        for (const pt of texts) {
          if (!pt.trim()) continue;
          let m: { start: number; end: number } | null = null;

          // For AI items with target_highlight, try sentence_context first then exact_word
          if (issue.source === 'ai' && issue.target_highlight) {
            const ctx = issue.target_highlight.sentence_context;
            const word = issue.target_highlight.exact_word;
            if (ctx && word) {
              m = findTextMatch(highlightedMd, ctx);
              if (m) {
                const sentenceText = highlightedMd.slice(m.start, m.end);
                const wordIdx = sentenceText.indexOf(word);
                if (wordIdx >= 0) {
                  m = { start: m.start + wordIdx, end: m.start + wordIdx + word.length };
                }
              }
            }
            if (!m) {
              m = findTextMatch(highlightedMd, word || pt);
            }
          } else {
            m = findTextMatch(highlightedMd, pt);
          }

          if (!m) continue;
          const isIgnored = ignoredIdsRef.current.has(issue.id);
          let cls: string;
          if (isIgnored) {
            cls = 'issue-highlight-ignored';
          } else if (issue.source === 'ai') {
            cls = issue.status === 'passed' ? 'issue-highlight-passed' : (issue.category === 'Error' ? 'issue-highlight-error' : 'issue-highlight-ai');
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
            text: pt,
            issueIds: [issue.id],
            startIndex: issue.target_highlight?.start_index ?? null,
            endIndex: issue.target_highlight?.end_index ?? null,
          });
        }
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

    // Build highlight decorations from the ProseMirror document.
    // This avoids the destructive htmlToMarkdown → markdownToHtml round-trip
    // that previously corrupted links, bold, and spacing on every "Periksa" click.
    const doc = handle.getDoc();
    const foundPositions: {
      from: number;
      to: number;
      cls: string;
      issueIds?: number[];
      text: string;
      reason: string;
      label: string;
      kind: string;
      score?: number;
      startIndex?: number | null;
      endIndex?: number | null;
    }[] = [];

    // Pre-build flat text segments from ProseMirror doc for cross-node regex matching.
    // Inline formatting (bold, italic, links) splits text into multiple ProseMirror text
    // nodes, so searching one node at a time misses matches that span node boundaries.
    const segments: { startPos: number; textLen: number }[] = [];
    const parts: string[] = [];
    if (doc) {
      doc.descendants((node: any, pos: number) => {
        if (node.isText) {
          const t = node.text || '';
          segments.push({ startPos: pos, textLen: t.length });
          parts.push(t);
        }
      });
    }
    const fullDocText = parts.join('');

    const fuzzyRe = (s: string) =>
      new RegExp(
        s.replace(/\s+/g, ' ').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'),
        'i',
      );

    // Find the first regex match in fullDocText and map it to ProseMirror positions.
    // Handles matches that span multiple text segments.
    const findMatch = (re: RegExp): { from: number; to: number } | null => {
      const m = re.exec(fullDocText);
      if (!m) return null;
      const matchStart = m.index;
      const matchEnd = m.index + m[0].length;
      let from: number | null = null;
      let to: number | null = null;
      let accumulated = 0;
      for (const seg of segments) {
        const segEnd = accumulated + seg.textLen;
        if (from === null && matchStart < segEnd) {
          from = seg.startPos + (matchStart - accumulated);
        }
        if (from !== null && matchEnd <= segEnd) {
          to = seg.startPos + (matchEnd - accumulated);
          break;
        }
        accumulated = segEnd;
      }
      return from !== null && to !== null ? { from, to } : null;
    };

    for (const range of ranges) {
      const text = range.text.trim();
      if (!text) continue;

      const re = fuzzyRe(text);
      let found = findMatch(re);
      if (!found) {
        // Fallback: strip trailing punctuation (same as findTextMatch)
        const clean = text.replace(/[.!?,;:]+$/g, '');
        if (clean.length > 10) {
          const re2 = fuzzyRe(clean);
          found = findMatch(re2);
        }
      }

      if (!found) continue;

      foundPositions.push({
        from: found.from,
        to: found.to,
        cls: range.cls,
        issueIds: range.issueIds,
        text: range.text,
        reason: range.reason,
        label: range.label,
        kind: range.kind,
        score: range.score,
        startIndex: range.startIndex,
        endIndex: range.endIndex,
      });
    }

    // Sort and merge overlapping decorations with class priority
    const clsPriority = (c: string) => {
      if (c.includes('issue-highlight-ai')) return 4;
      if (c.includes('issue-highlight-error')) return 3;
      if (c.includes('issue-highlight-ignored')) return 2;
      if (c.includes('issue-highlight-passed')) return 0;
      return 1; // issue-highlight (general)
    };
    foundPositions.sort((a, b) => a.from - b.from);
    const merged: typeof foundPositions = [];
    for (const fp of foundPositions) {
      const prev = merged[merged.length - 1];
      if (prev && fp.from < prev.to) {
        // Yellow (issue-highlight-ai) wins over red (issue-highlight-error / issue-highlight)
        if (clsPriority(fp.cls) > clsPriority(prev.cls)) {
          prev.cls = fp.cls;
        }
        prev.to = Math.max(prev.to, fp.to);
        if (fp.issueIds) {
          prev.issueIds = [...new Set([...(prev.issueIds || []), ...fp.issueIds])];
        }
        prev.startIndex = prev.startIndex ?? fp.startIndex;
        prev.endIndex = fp.endIndex ?? prev.endIndex;
      } else {
        merged.push(fp);
      }
    }

    const decos = merged.map((fp) => {
      const attrs: Record<string, string> = {
        'data-kind': fp.kind,
        'data-text': fp.text.replace(/"/g, '&quot;'),
        'data-reason': fp.reason.replace(/"/g, '&quot;'),
        'data-label': fp.label.replace(/"/g, '&quot;'),
      };
      if (fp.issueIds?.length) attrs['data-issue-ids'] = fp.issueIds.join(',');
      if (typeof fp.score === 'number') attrs['data-score'] = String(fp.score);
      if (fp.startIndex != null) attrs['data-start-index'] = String(fp.startIndex);
      if (fp.endIndex != null) attrs['data-end-index'] = String(fp.endIndex);
      const active = activeIssueId != null && fp.issueIds?.includes(activeIssueId);
      return { from: fp.from, to: fp.to, cls: active ? `${fp.cls} issue-highlight-active` : fp.cls, attrs };
    });

    handle.setDecorations(decos);
  };

  const focusIssue = (issue: CheckResult | null) => {
    const handle = editorRef.current;
    if (!handle || !issue?.problematic_text) return;
    const editorEl = handle.getEditorEl();
    if (!editorEl) return;

    const texts = issue.problematic_text.split('|||').filter(Boolean);
    const currentIdx = focusIndices[issue.id] ?? 0;
    const targetText = texts.length > 1 ? texts[currentIdx % texts.length] : issue.problematic_text;

    // 1. Try to find the exact highlighted mark by data-issue-ids (plural) or data-issue-id (singular)
    const allMarksWithIds = Array.from(
      editorEl.querySelectorAll('mark[data-issue-ids], mark[data-issue-id]'),
    );
    const matchingMarks = allMarksWithIds.filter((m) => {
      const idsAttr = m.getAttribute('data-issue-ids') || m.getAttribute('data-issue-id') || '';
      return idsAttr.split(',').map(Number).includes(issue.id);
    }) as HTMLElement[];
    // Cycle through multiple marks using focusIndices, preferring data-start-index match
    let foundMark: HTMLElement | null = null;
    if (matchingMarks.length > 0) {
      // If issue has start_index, prefer the mark whose data-start-index matches
      if (issue.target_highlight?.start_index != null) {
        const exactMark = matchingMarks.find((m) => {
          const si = m.getAttribute('data-start-index');
          return si != null && Number(si) === issue.target_highlight!.start_index;
        });
        if (exactMark) foundMark = exactMark;
      }
      if (!foundMark) {
        const idx = focusIndices[issue.id] ?? 0;
        foundMark = matchingMarks[idx % matchingMarks.length];
      }
    }

    // 2. Fallback: find any mark whose text contains the target text
    if (!foundMark) {
      const allMarks = Array.from(editorEl.querySelectorAll('mark'));
      foundMark = allMarks.find((m) => {
        const text = m.textContent || '';
        return text.includes(targetText);
      }) as HTMLElement | null;
    }

    if (foundMark) {
      foundMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      focusOnMark(foundMark, issue, targetText);
    } else {
      // 3. Last fallback: search the article text
      const text = getTextContent(handle.getHTML());
      const m = findTextMatch(text, targetText);
      if (m) {
        handle.focus();
        const start = findTextNodeAndOffset(editorEl, m.start);
        const end = findTextNodeAndOffset(editorEl, m.end);
        if (start && end) {
          const range = document.createRange();
          range.setStart(start[0], start[1]);
          range.setEnd(end[0], end[1]);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          const mark = range.startContainer.parentElement?.closest('mark');
          if (mark) {
            focusOnMark(mark, issue, targetText);
          } else {
            editorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      } else {
        editorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setFlashText(targetText);
      setTimeout(() => setFlashText(''), 1200);
    }

    // Advance to next text in sequence for next click
    if (texts.length > 1) {
      setFocusIndices((prev) => ({ ...prev, [issue.id]: (currentIdx + 1) % texts.length }));
    }
  };

  const focusOnMark = (foundMark: HTMLElement, issue: CheckResult, displayText?: string) => {
    hoverTargetRef.current = foundMark;
    const rect = foundMark.getBoundingClientRect();
    const above = rect.top - 10 >= 0;
    const pos = positionPopupFor(rect, 288, 250, above, 10);
    setHover({
      x: pos.x,
      y: pos.y,
      kind: 'sop',
      label: issue.question,
      reason: issue.reason,
      text: displayText || issue.problematic_text,
      issue,
    });
    setFlashText(displayText || issue.problematic_text);
    setTimeout(() => setFlashText(''), 1200);
    setTimeout(() => { hoverTargetRef.current = null; setHover(null); }, 15000);
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
      setArticle(nextArticle);
      isUpdatingFromCodeRef.current = true;
      editorRef.current?.replaceText(snippet, rewritten);
      isUpdatingFromCodeRef.current = false;
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

  // For AI evaluation items with auto_correct_button, use AI to generate fix
  if (item.auto_correct_button && item.source === 'ai') {
    try {
      // For typo corrections, directly replace the exact word with suggested fix
      if (item.category === 'Error' && item.target_highlight && item.target_highlight.exact_word) {
        const targetWord = item.target_highlight.exact_word;
        const suggestedFix = item.suggested_fix || targetWord;

        // Find the word in the article and replace it precisely
        const m = findTextMatch(article, targetWord);
        if (!m) {
          setFlashText('Teks typo tidak ditemukan di artikel.');
          setTimeout(() => setFlashText(''), 3000);
          return;
        }

        let correction = extractActualCorrection(suggestedFix);
        // If the extracted correction is still a generic phrase (not a clean word),
        // or if the word is very short (weak word), use AI with sentence context
        if ((correction.length > 20 || targetWord.length < 8) && item.target_highlight?.sentence_context) {
          try {
            const { content } = await callChatCompletion({
              messages: [
                {
                  role: 'system',
                  content: `Anda adalah asisten Auto-Correct Editor Konten Hukum.
Ganti SATU kata lemah "${targetWord}" dalam kalimat di bawah dengan kata yang lebih tepat dan kuat sesuai KONTEKS kalimat.
${item.suggested_fix ? `\nPanduan perbaikan: ${item.suggested_fix}` : ''}

Aturan:
- HANYA ganti kata "${targetWord}" — jangan ubah kata lain dalam kalimat.
- Pilih pengganti yang SESUAI KONTEKS kalimat. Jangan paksa ganti jika tidak ada padanan yang tepat.
- Jika "${targetWord}" sudah tepat dalam konteks ini (misal: "hanya...yang..." dalam struktur kalimat), atau memang tidak ada pengganti yang lebih baik, kembalikan kata aslinya "${targetWord}".
- Kembalikan JSON: { "replacement": "..." }`,
                },
                { role: 'user', content: item.target_highlight.sentence_context },
              ],
              temperature: 0.2,
              timeoutMs: 15000,
            });
            const parsed = JSON.parse(content);
            if (parsed?.replacement && typeof parsed.replacement === 'string') {
              correction = parsed.replacement.trim();
            }
          } catch {
            // Fall through to use the extracted correction
          }
        }

        if (correction === targetWord) {
          setFlashText(`"${targetWord}" sudah tepat dalam konteks ini.`);
          setTimeout(() => setFlashText(''), 3000);
          return;
        }

        const newArticle = article.slice(0, m.start) + correction + article.slice(m.end);
        setArticle(newArticle);
        isUpdatingFromCodeRef.current = true;
        editorRef.current?.replaceText(targetWord, correction);
        isUpdatingFromCodeRef.current = false;
        setHover(null);
        const newReport = runSopChecks({ article: newArticle, keyword, metaTitle, metaDesc });
        setLiveReport(newReport);
        setReport(newReport);
        requestAnimationFrame(() => applyHighlights(newReport));
        setFlashText('Auto Correct berhasil.');
        setTimeout(() => setFlashText(''), 3000);
        return;
      }

      // For other cases, use AI to detect corrections as a structured list
      let textToFix = (item.problematic_text || '').trim();
      // If textToFix is too short (e.g., single weak word), use sentence_context instead
      if (textToFix.length <= 5 && item.target_highlight?.sentence_context) {
        textToFix = item.target_highlight.sentence_context.trim();
      }
      const hasMatchableText = textToFix.length > 5;
      let articleContext = '';
      if (hasMatchableText) {
        const m = findTextMatch(article, textToFix);
        if (m) {
          articleContext = article.slice(Math.max(0, m.start - 200), m.end + 200);
        }
      }

      const { content } = await callChatCompletion({
        messages: [
          {
            role: 'system',
            content: `Anda adalah asisten Auto-Correct Editor Konten Hukum.
Deteksi dan koreksi SATU kriteria spesifik pada teks artikel berikut.

Kriteria: "${item.question}"
Alasan: "${item.reason}"
${item.suggested_fix ? `Saran perbaikan: ${item.suggested_fix}` : ''}

Tugas Anda: Kembalikan daftar koreksi dalam bentuk JSON array.
Setiap item dalam array berisi:
- "original_text": teks asli yang salah, KUTIPAN VERBATIM PERSIS dari artikel (wajib sama persis, termasuk spasi, huruf besar/kecil, tanda baca)
- "corrected_text": teks hasil koreksi
- "reason": alasan singkat koreksi

Aturan:
- original_text HARUS KUTIPAN VERBATIM PERSIS dari artikel. Jangan diparafrase.
- Jika tidak ada yang perlu dikoreksi, kembalikan array kosong [].
- JANGAN mengembalikan artikel lengkap. HANYA array koreksi.
- Koreksi minimal, hanya bagian yang bermasalah.
${articleContext ? `\nKonteks artikel (200 karakter sebelum & sesudah teks bermasalah):\n"${articleContext}"` : ''}

Kembalikan JSON: [ { "original_text": "...", "corrected_text": "...", "reason": "..." } ]`,
          },
          {
            role: 'user',
            content: `Teks yang perlu diperiksa:\n"${textToFix}"`,
          },
        ],
        temperature: 0.2,
        timeoutMs: 30000,
      });

      let corrections: Correction[] = [];
      try { corrections = JSON.parse(content); } catch { corrections = []; }
      if (!Array.isArray(corrections)) corrections = [];
      corrections = corrections.filter((c) => c.original_text && c.corrected_text);

      if (corrections.length === 0) {
        if (hasMatchableText && textToFix.length > 3) {
          // Fallback: no corrections found, try content addition approach
          const { content: fallbackContent } = await callChatCompletion({
            messages: [
              {
                role: 'system',
                content: `Anda adalah asisten Auto-Correct Editor Konten Hukum.
Buat konten tambahan untuk artikel berdasarkan kriteria berikut.

Kriteria: "${item.question}"
Alasan: "${item.reason}"
${item.suggested_fix ? `Saran perbaikan: ${item.suggested_fix}` : ''}

ATURAN:
- Buat konten yang diperlukan (CTA, referensi, paragraf, dll) dalam format markdown.
- Maksimal 3 kalimat.
- Jika ini perbaikan meta, perbaiki meta title/description (jangan buat konten artikel).
- Gunakan bahasa Indonesia formal-natural.
- Kembalikan JSON: { "content": "...", "metaTitle": "...", "metaDesc": "..." }`,
              },
              {
                role: 'user',
                content: `Keyword: ${keyword || '-'}\nMeta Title: ${metaTitle || '-'}\nMeta Desc: ${metaDesc || '-'}`,
              },
            ],
            temperature: 0.3,
            timeoutMs: 30000,
          });

          const parsed = JSON.parse(fallbackContent);
          const addition = typeof parsed.content === 'string' ? parsed.content.trim() : '';
          if (addition) {
            const addedArticle = article.trimEnd() + '\n\n' + addition;
            setArticle(addedArticle);
            if (editorRef.current) {
              const additionHtml = markdownToHtml(addition);
              editorRef.current.setContent(editorRef.current.getHTML() + additionHtml);
            }
            if (typeof parsed.metaTitle === 'string') setMetaTitle(parsed.metaTitle);
            if (typeof parsed.metaDesc === 'string') setMetaDesc(parsed.metaDesc);
          }
          setFlashText('Auto Correct selesai (tambahan konten).');
          setTimeout(() => setFlashText(''), 3000);
        } else {
          setFlashText('Auto Correct tidak menemukan koreksi.');
          setTimeout(() => setFlashText(''), 3000);
        }
        setHover(null);
        const finalReport = runSopChecks({ article, keyword, metaTitle, metaDesc });
        setLiveReport(finalReport);
        setReport(finalReport);
        requestAnimationFrame(() => applyHighlights(finalReport));
        return;
      }

      // Apply corrections via index-based string replace
      const { result: newArticle, applied, skipped } = applyCorrectionsToArticle(article, corrections);
      if (applied === 0) {
        setFlashText('Teks asli tidak ditemukan persis di artikel — koreksi dilewati.');
        setTimeout(() => setFlashText(''), 3000);
        return;
      }

      setArticle(newArticle);
      // Apply to TipTap editor via surgical range replace (no setContent)
      isUpdatingFromCodeRef.current = true;
      if (editorRef.current) {
        for (const c of corrections) {
          if (!editorRef.current.replaceText(c.original_text, c.corrected_text)) {
            // Fallback: try with whitespace-normalized text
            const normOld = c.original_text.replace(/\s+/g, ' ');
            const normNew = c.corrected_text.replace(/\s+/g, ' ');
            editorRef.current.replaceText(normOld, normNew);
          }
        }
      }
      isUpdatingFromCodeRef.current = false;
      setHover(null);
      const newReport = runSopChecks({ article: newArticle, keyword, metaTitle, metaDesc });
      setLiveReport(newReport);
      setReport(newReport);
      requestAnimationFrame(() => applyHighlights(newReport));
      setFlashText(`Auto Correct berhasil (${applied} koreksi, ${skipped} dilewati).`);
      setTimeout(() => setFlashText(''), 3000);
    } catch (err: unknown) {
      const info = classifyAiError(err);
      logAiError('auto-correct', info);
      setError('auto-correct', info);
    } finally {
      setFixingId(null);
    }
    return;
  }

  // For items that don't have the new-style flags, still try the corrections approach
  const textToFixLegacy = (item.problematic_text || item.question || '').trim();
  if (textToFixLegacy.length > 10) {
    try {
      const { content } = await callChatCompletion({
        messages: [
          {
            role: 'system',
            content: `Anda adalah asisten Auto-Correct Editor Konten Hukum.
Deteksi dan koreksi teks berikut.

Kriteria: "${item.question || '-'}"
Alasan: "${item.reason || '-'}"
${item.suggested_fix ? `Saran perbaikan: ${item.suggested_fix}` : ''}

Kembalikan JSON array koreksi:
[ { "original_text": "...", "corrected_text": "...", "reason": "..." } ]

- original_text HARUS kutipan verbatim dari teks yang diberikan
- JANGAN mengembalikan artikel lengkap`,
          },
          { role: 'user', content: textToFixLegacy },
        ],
        temperature: 0.2,
        timeoutMs: 30000,
      });

      let corrections: Correction[] = [];
      try { corrections = JSON.parse(content); } catch { corrections = []; }
      if (!Array.isArray(corrections)) corrections = [];
      corrections = corrections.filter((c) => c.original_text && c.corrected_text);

      if (corrections.length > 0) {
        const { result: newArticle, applied } = applyCorrectionsToArticle(article, corrections);
        if (applied > 0) {
          setArticle(newArticle);
          isUpdatingFromCodeRef.current = true;
          if (editorRef.current) {
            for (const c of corrections) {
              editorRef.current.replaceText(c.original_text, c.corrected_text);
            }
          }
          isUpdatingFromCodeRef.current = false;
          setHover(null);
          const newReport = runSopChecks({ article: newArticle, keyword, metaTitle, metaDesc });
          setLiveReport(newReport);
          setReport(newReport);
          requestAnimationFrame(() => applyHighlights(newReport));
          setFlashText('Auto Correct berhasil.');
          setTimeout(() => setFlashText(''), 3000);
          return;
        }
      }
    } catch {
      // Fall through to message below
    }
  }

  setFlashText('Auto Correct tidak tersedia untuk item ini.');
  setTimeout(() => setFlashText(''), 3000);
  setHover(null);
};

  const handleAutoCorrectCase = (item: CheckResult) => {
    const text = item.problematic_text;
    if (!text) return;
    pushUndo();
    const handle = editorRef.current;
    if (!handle) return;

    // Find the text in the markdown article and fix the typo
    const md = htmlToMarkdown(handle.getHTML());
    const m = findTextMatch(md, text);
    if (!m) return;

    // Always correct typo by capitalizing first letter and making rest lowercase
    const corrected = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    if (corrected === text) return;

    const newMd = md.slice(0, m.start) + corrected + md.slice(m.end);
    setArticle(newMd);
    isUpdatingFromCodeRef.current = true;
    editorRef.current?.replaceText(text, corrected);
    isUpdatingFromCodeRef.current = false;
    setHover(null);
    const newReport = runSopChecks({ article: newMd, keyword, metaTitle, metaDesc });
    setLiveReport(newReport);
    setReport(newReport);
    requestAnimationFrame(() => applyHighlights(newReport));
  };

  const handleGenerateMetaDesc = async () => {
    if (!article.trim()) {
      setFlashText('Tulis artikel terlebih dahulu.');
      setTimeout(() => setFlashText(''), 3000);
      return;
    }
    setMetaDescLoading(true);
    try {
      const { content } = await callChatCompletion({
        messages: [
          {
            role: 'system',
            content: `Anda adalah SEO copywriter. Buat meta description yang optimal untuk artikel berikut.

Aturan:
- Panjang 120–160 karakter
- Menarik, ringkas, mengandung kata kunci utama
- Promosikan value artikel secara natural
- Jangan gunakan tanda kutip dalam output

Kembalikan JSON SAJA: { "metaDescription": "..." }`,
          },
          { role: 'user', content: stripImages(article).slice(0, 8000) },
        ],
        temperature: 0.3,
        timeoutMs: 30_000,
      });
      const data = JSON.parse(content);
      if (data.metaDescription) {
        setMetaDesc(data.metaDescription.slice(0, 160));
      }
    } catch (err) {
      const info = classifyAiError(err);
      logAiError('meta-desc', info);
      setError('meta-desc', info);
    } finally {
      setMetaDescLoading(false);
    }
  };

  const handleAnalyzeKeywords = async (source: 'ai' | 'manual' = 'ai') => {
    setKwGenLoading(true);
    clearError('keyword-gen');
    setAhrefsMetrics([]);
    setSelectedKeywords(new Set());

    let keywords: string[] = [];

    try {
      if (source === 'ai') {
        // Step 1: Generate keywords from full article using AI
        let aiKeywords: string[] = [];
        if (article.trim()) {
          try {
            aiKeywords = await callOllamaGenerateKeywords('', stripImages(article));
          } catch (_e) {
          }
        }

        if (aiKeywords.length > 0) {
          // Step 2: Take top 20 AI keywords and check Ahrefs metrics in batches of 10
          const topKeywords = aiKeywords.slice(0, 20);
          keywords = topKeywords;

          const results: AhrefsKeywordMetric[] = [];
          let ahrefsError = '';

          const batch1 = topKeywords.slice(0, 10);
          const batch2 = topKeywords.slice(10, 20);

          const r1 = await fetchAhrefsKeywordMetrics(batch1, 'id', AHREFS_API_KEY);
          if (r1.data.length > 0) results.push(...r1.data);
          if (r1.error) ahrefsError = r1.error;

          if (batch2.length > 0) {
            const r2 = await fetchAhrefsKeywordMetrics(batch2, 'id', AHREFS_API_KEY);
            if (r2.data.length > 0) results.push(...r2.data);
            if (r2.error && !ahrefsError) ahrefsError = r2.error;
          }

          if (results.length > 0) {
            setAhrefsMetrics(results);
          } else {
            setAhrefsMetrics(generateMockAhrefsMetrics(topKeywords));
            if (ahrefsError.includes('API key') || ahrefsError.includes('tidak dikonfigurasi')) {
              setKwGenError('Ahrefs API key tidak dikonfigurasi. Menampilkan data simulasi.');
            }
          }
          setSelectedKeywords(new Set());
        } else {
          // Fallback: AI failed or article empty — use old flow (focus keyword → Ahrefs)
          let seedKeywords = keyword.split(',').map((k: string) => k.trim()).filter(Boolean);
          if (seedKeywords.length === 0 && article.trim()) {
            const firstLine = article.trim().split('\n')[0]?.replace(/^#+\s*/, '').trim();
            if (firstLine) seedKeywords = [firstLine];
          }
          if (seedKeywords.length === 0) {
            setKwGenError('Tidak ada artikel atau focus keyword. Tulis artikel terlebih dahulu.');
            setKwGenLoading(false);
            return;
          }

          keywords = seedKeywords;
          const { data: relatedMetrics, error: relatedError } = await fetchAhrefsRelatedTerms(seedKeywords.slice(0, 3), 'id', AHREFS_API_KEY);
          if (relatedError) {
            if (relatedError.includes('API key') || relatedError.includes('tidak dikonfigurasi')) {
              setKwGenError('Ahrefs API key tidak dikonfigurasi. Menampilkan data simulasi.');
            }
            const { data: metrics, error } = await fetchAhrefsKeywordMetrics(seedKeywords.slice(0, 10), 'id', AHREFS_API_KEY);
            let _finalMetrics: AhrefsKeywordMetric[];
            if (error || metrics.length === 0) {
              _finalMetrics = generateMockAhrefsMetrics(seedKeywords.slice(0, 10));
            } else {
              _finalMetrics = metrics;
            }
            setAhrefsMetrics(_finalMetrics);
            const _existingKws = keyword.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
            setSelectedKeywords(new Set(_finalMetrics.filter(m => _existingKws.includes(m.keyword.toLowerCase())).map(m => m.keyword)));
          } else if (relatedMetrics.length > 0) {
            const existingLower = seedKeywords.map(k => k.toLowerCase());
            const sorted = [
              ...relatedMetrics.filter(m => existingLower.includes(m.keyword.toLowerCase())),
              ...relatedMetrics.filter(m => !existingLower.includes(m.keyword.toLowerCase())),
            ];
            setAhrefsMetrics(sorted);
            setSelectedKeywords(new Set(relatedMetrics.filter(m => existingLower.includes(m.keyword.toLowerCase())).map(m => m.keyword)));
          } else {
            const { data: metrics, error } = await fetchAhrefsKeywordMetrics(seedKeywords.slice(0, 10), 'id', AHREFS_API_KEY);
            const _finalMetrics = error || metrics.length === 0
              ? generateMockAhrefsMetrics(seedKeywords.slice(0, 10))
              : metrics;
            setAhrefsMetrics(_finalMetrics);
            const _existingKws = keyword.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
            setSelectedKeywords(new Set(_finalMetrics.filter(m => _existingKws.includes(m.keyword.toLowerCase())).map(m => m.keyword)));
          }
        }
      } else {
        keywords = kwInput.split(',').map((k: string) => k.trim()).filter(Boolean);
        if (keywords.length === 0) {
          setKwGenError('Masukkan minimal 1 keyword dipisahkan koma.');
          setKwGenLoading(false);
          return;
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
      }
    } catch (err) {
      if (source === 'ai' && keywords.length === 0) {
        setAhrefsMetrics([]);
        const info = classifyAiError(err);
        logAiError('keyword-gen', info);
        setError('keyword-gen', info);
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
    return new Promise<void>((resolve) => {
      setIsAnalyzing(true);
      setAiLoading(true);
      setAiResults(null);
      clearError('sop-ai-eval');
      if (window.innerWidth < 768) setShowMobileEval(true);
      const sopReport = liveReport;
      window.setTimeout(() => {
        try {
          applyHighlights(); // blocked when highlightsBlockedRef is true
          setReport(liveReport);
        } catch (e) {
          console.warn('applyHighlights error in runAnalysis timeout:', e);
        }
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
          // Build re-check cache from full results (merge to preserve AI detector cache)
          const cacheArticle = stripImages(article);
          const cacheParagraphs = splitIntoParagraphs(cacheArticle);
          const freshCache = buildRecheckCacheFromFullResults(output, cacheParagraphs, computeArticleHash(cacheArticle));
          recheckCacheRef.current = recheckCacheRef.current
            ? { ...recheckCacheRef.current, ...freshCache }
            : freshCache;
          const failedAi = output.results.filter(
            (r) => r.status === 'failed' && r.problematic_text?.trim().length > 0 && r.id !== 56,
          );
          if (failedAi.length > 0 && sopReport) {
            applyHighlights({
              ...sopReport,
              items: [...sopReport.items, ...failedAi],
            }); // blocked when highlightsBlockedRef is true
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          const info = classifyAiError(err);
          logAiError('sop-ai-eval', info);
          setError('sop-ai-eval', info);
          setAiResults({ results: [], subScores: { seo: 0, structure: 0, intent: 0, tone: 0 }, bestNextMove: '' });
        })
        .finally(() => {
          setIsAnalyzing(false);
          if (!signal.aborted) setAiLoading(false);
          resolve();
        });
    });
  };

  const runAllChecks = async () => {
    if (!article.trim()) {
      console.warn('[Periksa] skipped: article is empty');
      return;
    }

    highlightsBlockedRef.current = true;
    incrementalAbortRef.current?.abort();
    incrementalStateRef.current = buildInitialState();
    setIncrementalResults([]);
    clearAll();

    try {
      const cleanArticleForHash = stripImages(article);
      const currentHash = computeArticleHash(cleanArticleForHash);
      const cachedEntry = recheckCacheRef.current;
      const articleChanged = !cachedEntry || cachedEntry.articleHash !== currentHash;
      let aiEvalDone = false;

      // Try incremental re-check if cache exists and article has changed
      if (cachedEntry && articleChanged) {
        const signal = new AbortController();
        const incrementalResult = await runIncrementalRecheck(
          { article: stripImages(article), keyword: stripImages(getPrimaryKeyword(keyword)), metaTitle: stripImages(metaTitle), metaDesc: stripImages(metaDesc) },
          stripImages(article),
          stripImages(getPrimaryKeyword(keyword)),
          stripImages(metaTitle),
          stripImages(metaDesc),
          cachedEntry,
          OPENAI_API_KEY,
          signal.signal,
        );

        if (!signal.signal.aborted && incrementalResult) {
          setAiResults({
            results: incrementalResult.results,
            subScores: incrementalResult.subScores,
            bestNextMove: incrementalResult.bestNextMove,
          });

          recheckCacheRef.current = {
            ...cachedEntry,
            paragraphs: splitIntoParagraphs(stripImages(article)),
            fullResults: incrementalResult.results,
            articleHash: currentHash,
          };

          aiEvalDone = true;

          // If no paragraphs actually changed, skip all LLM calls entirely
          if (incrementalResult.usedCache) {
            const cachedDetector = mergeAiDetectorIncremental(cachedEntry, splitIntoParagraphs(stripImages(article)));
            if (cachedDetector && cachedEntry.fullAiDetectorResult) {
              setAiDetectorResult({ ...cachedEntry.fullAiDetectorResult, sentences: cachedDetector.sentences });
            } else {
              setAiDetectorResult(null);
            }
            highlightsBlockedRef.current = false;
            setHasChecked(true);
            requestAnimationFrame(() => applyHighlights());
            return;
          }
        }
      }

      // Run whatever LLM calls are still needed
      if (aiEvalDone) {
        await Promise.all([
          handleDetectAI({ switchTab: false }),
          handleCheckPlagiarism({ switchTab: false }),
        ]);
      } else if (!cachedEntry || articleChanged) {
        await Promise.all([
          runAnalysis(),
          handleDetectAI({ switchTab: false }),
          handleCheckPlagiarism({ switchTab: false }),
        ]);
      } else {
        if (cachedEntry.fullAiDetectorResult) {
          const cachedDetector = mergeAiDetectorIncremental(cachedEntry, splitIntoParagraphs(stripImages(article)));
          if (cachedDetector) {
            setAiDetectorResult({ ...cachedEntry.fullAiDetectorResult, sentences: cachedDetector.sentences });
          }
        }
      }

      highlightsBlockedRef.current = false;
      setHasChecked(true);
      requestAnimationFrame(() => applyHighlights());
    } catch (err) {
      console.error('[Periksa] unexpected error in runAllChecks:', err);
    } finally {
      highlightsBlockedRef.current = false;
      setIsAnalyzing(false);
      setAiLoading(false);
      setAiDetectorLoading(false);
      setPlagiarismLoading(false);
    }
  };

  const handleDetectAI = async (opts?: { switchTab?: boolean }) => {
    if (!article.trim()) return;
      setAiDetectorLoading(true);
    setAiDetectorResult(null);
      try {
      const cleanArticle = stripImages(article);
        const result = await detectAIContent(cleanArticle);
      setAiDetectorResult(result);
      // Cache AI detector results by paragraph
      const paragraphs = splitIntoParagraphs(cleanArticle);
      const detectorCache = buildRecheckCacheFromAiDetector(result, paragraphs);
      recheckCacheRef.current = recheckCacheRef.current
        ? { ...recheckCacheRef.current, ...detectorCache }
        : { articleHash: computeArticleHash(cleanArticle), paragraphs, paragraphResults: {}, fullResults: [], subScores: { seo: 0, structure: 0, intent: 0, tone: 0 }, bestNextMove: '', ...detectorCache };
      if (opts?.switchTab ?? true) setActiveEvalTab('ai-detector');
      if (window.innerWidth < 768) setShowMobileEval(true);
    } catch (err) {
      const info = classifyAiError(err);
      logAiError('ai-detector', info);
      setError('ai-detector', info);
      setAiDetectorResult({
        provider: 'none',
        aiProbability: 0,
        humanProbability: 0,
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
      const info = classifyAiError(err);
      logAiError('plagiarism', info);
      setError('plagiarism', info);
      setPlagiarismResult({
        provider: 'none',
        plagiarismScore: 0,
        matchedSources: [],
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
      const changes: { oldText: string; newText: string }[] = [];
      for (const sentence of candidates) {
        const m = findTextMatch(nextArticle, sentence.text);
        if (!m) continue;
        const rewritten = await rewriteSnippet(nextArticle.slice(m.start, m.end), 'ai');
        if (!rewritten || rewritten.toLowerCase() === nextArticle.slice(m.start, m.end).trim().toLowerCase()) continue;
        changes.push({ oldText: nextArticle.slice(m.start, m.end), newText: rewritten });
        nextArticle = nextArticle.slice(0, m.start) + rewritten + nextArticle.slice(m.end);
        fixedCount += 1;
      }

      if (fixedCount === 0) {
        setFlashText('Belum ada bagian yang bisa di-auto-correct.');
        setTimeout(() => setFlashText(''), 2500);
        return;
      }

      pushUndo();
      setArticle(nextArticle);
      isUpdatingFromCodeRef.current = true;
      if (editorRef.current) {
        for (const c of changes) {
          editorRef.current.replaceText(c.oldText, c.newText);
        }
      }
      isUpdatingFromCodeRef.current = false;
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
      setHover(null);
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
        isUpdatingFromCodeRef.current = true;
        editorRef.current?.setContent(html);
        setHtmlContent(html);
        setArticle(htmlToMarkdown(html));
        setTimeout(() => { isUpdatingFromCodeRef.current = false; }, 0);
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
    const handle = editorRef.current;
    if (!handle) return;
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          handle.focus();
          handle.insertImage({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') });
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
    clearAll();
    setAiDetectorResult(null);
    setPlagiarismResult(null);
    setHasChecked(false);
    setIgnoredIds(new Set());
    localStorage.removeItem(DRAFT_KEY);
    if (editorRef.current) editorRef.current.setContent('');
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
    <div id="app-root" className="article-checker-app min-h-screen bg-surface-50 text-surface-900 font-sans antialiased flex flex-col">
      {/* Header */}
      <header id="app-header" className="article-checker-header h-[64px] bg-white/90 backdrop-blur-xl border-b border-surface-200 shadow-sm flex items-center justify-between px-6 shrink-0 sticky top-0 z-30 transition-all duration-300">
        <div id="header-brand" className="header-brand-group flex items-center gap-3 group cursor-default">
          <div className="flex items-center justify-center">
            <img src="/smartlegal.png" alt="SmartLegal" className="h-9 object-contain" />
          </div>
          <div className="header-title-container flex flex-col justify-center">
            <h1 id="app-title" className="text-[15px] font-bold text-surface-900 tracking-tight leading-tight font-display transition-colors duration-300 group-hover:text-brand-700">Article Checker</h1>
            <span className="text-[11px] text-surface-500 font-medium tracking-wide">SEO · AI · Plagiarism</span>
          </div>
          {draftSaved && (
            <span id="draft-saved-badge" className="draft-saved-badge text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/60 animate-slide-in-right shadow-sm ml-2">✓ Tersimpan</span>
          )}
        </div>

        <div id="header-actions" className="header-actions-group flex items-center gap-2">
          <button
            id="header-btn-reset"
            type="button"
            onClick={() => setShowResetModal(true)}
            className="btn-header-action flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-surface-600 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition-all duration-300 hover:shadow-sm group"
          >
            <RotateCcw className="w-4 h-4 transition-transform duration-500 group-hover:-rotate-180" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            id="header-btn-export"
            type="button"
            onClick={() => setShowExportModal(true)}
            className="btn-header-action flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-surface-600 hover:text-surface-900 hover:bg-surface-100 rounded-lg transition-all duration-300 hover:shadow-sm group"
          >
            <Download className="w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            id="header-btn-upload"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileImportLoading}
            className="btn-header-action flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-surface-600 hover:text-surface-900 hover:bg-surface-100 rounded-lg transition-all duration-300 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <Upload className={`w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5 ${fileImportLoading ? 'animate-spin text-brand-600' : ''}`} />
            <span className="hidden sm:inline">{fileImportLoading ? 'Membaca...' : 'Unggah'}</span>
          </button>
          <input
            id="file-input"
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".txt,.md,.pdf,.docx"
            className="hidden"
          />
          <div className="w-px h-6 bg-surface-200 mx-1 hidden sm:block" />
            <button
              id="header-btn-example"
              type="button"
              onClick={loadMockArticle}
              className="btn-header-example flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-surface-700 bg-white hover:bg-brand-50 hover:text-brand-700 rounded-lg transition-all duration-300 border border-surface-200 hover:border-brand-200 shadow-sm hover:shadow group"
            >
            <BookOpen className="w-4 h-4 transition-transform duration-300 group-hover:scale-110" />
            <span className="hidden sm:inline">Contoh</span>
          </button>
        </div>
      </header>

      <main id="app-main" className="app-main-content grid grid-cols-1 md:grid-cols-[7fr_3fr] md:grid-rows-[auto_1fr] gap-4 p-3 md:p-5 overflow-y-auto">
        {/* Row 1 Col 1: Setup Artikel */}
        <section id="setup-panel" className={`setup-panel-section ${showMobileEval ? 'hidden' : 'flex'} md:flex flex-col min-w-0 panel transition-all duration-300 hover:shadow-lg`}>
          <div className="accent-stripe shrink-0" />
          <div id="meta-header" className="section-setup-meta px-5 py-3 border-b border-surface-100 bg-surface-50/50 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-surface-900 font-display tracking-tight transition-colors duration-300 group-hover:text-brand-700">Setup Artikel</h2>
                <p className="text-[11px] text-surface-400 mt-0.5">Metadata dan fokus keyword</p>
              </div>
              <span className="text-[10px] font-medium text-surface-500 bg-white border border-surface-200 px-2.5 py-1 rounded-md shadow-sm">{wordCount} kata</span>
            </div>
            <div className="section-meta-fields grid grid-cols-1 md:grid-cols-3 gap-4">
              <div id="meta-keyword-field" className="col-span-1 bg-white rounded-xl border border-surface-200 p-3 shadow-sm transition-all duration-300 hover:shadow-md hover:border-brand-300 group hover:-translate-y-0.5">
                <label htmlFor="input-keyword" className="block text-[10px] font-bold uppercase tracking-wider text-surface-600 mb-1.5 transition-colors group-focus-within:text-brand-600">
                  Keyword
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="input-keyword"
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="mendaftarkan merek"
                    className="flex-1 bg-transparent border-b border-surface-200 hover:border-surface-300 focus:border-brand-500 outline-none py-1 text-sm text-surface-800 placeholder:text-surface-300 transition-colors"
                  />
                  {keyword.length > 0 && (
                    <button
                      id="btn-keyword-clear"
                      type="button"
                      onClick={() => setKeyword('')}
                      className="shrink-0 p-1 rounded-md text-surface-300 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                      title="Hapus keyword"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    id="btn-keyword-generate"
                    type="button"
                    onClick={() => { setShowKwPopup(true); handleAnalyzeKeywords(); }}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-brand-600 hover:text-brand-700 hover:bg-brand-50 transition-colors text-[10px] font-medium"
                    title="Generate keyword dengan AI"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">AI</span>
                  </button>
                </div>
                <div className="text-[10px] text-surface-400 mt-1.5 h-4" aria-live="polite">
                  {keyword.length > 0 && `${keyword.length} karakter`}
                </div>
              </div>
              <div id="meta-title-field" className="col-span-2 bg-white rounded-xl border border-surface-200 p-3 shadow-sm transition-all duration-300 hover:shadow-md hover:border-brand-300 group hover:-translate-y-0.5">
                <label htmlFor="input-title" className="block text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-1.5 transition-colors group-focus-within:text-brand-600">
                  Judul
                </label>
                <div className="relative">
                  <input
                    id="input-title"
                    type="text"
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    placeholder="Judul artikel"
                    className="w-full pr-6 bg-transparent border-b border-surface-200 hover:border-surface-300 focus:border-brand-500 outline-none py-1 text-sm font-semibold text-surface-900 placeholder:text-surface-300 transition-colors"
                  />
                  {metaTitle.length > 0 && (
                    <button
                      id="btn-title-clear"
                      type="button"
                      onClick={() => setMetaTitle('')}
                      className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-brand-600 transition-colors"
                      title="Hapus judul"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {(() => {
                  const len = metaTitle.length;
                  const max = 60;
                  const color = len > max ? 'text-brand-600' : len > max * 0.9 ? 'text-yellow-500' : 'text-surface-400';
                  return (
                    <div className={`text-[10px] mt-1.5 h-4 ${color}`} aria-live="polite">
                      {len}/{max} karakter
                    </div>
                  );
                })()}
              </div>
            </div>
            
            <div id="meta-desc-field" className="section-meta-desc bg-white rounded-xl border border-surface-200 p-3 shadow-sm transition-all duration-300 hover:shadow-md hover:border-brand-300 group hover:-translate-y-0.5">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="input-desc" className="text-[10px] font-bold uppercase tracking-wider text-surface-500 transition-colors group-focus-within:text-brand-600">
                  Deskripsi
                </label>
                <button
                  id="btn-desc-generate"
                  type="button"
                  onClick={handleGenerateMetaDesc}
                  disabled={metaDescLoading}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-brand-600 hover:text-brand-700 hover:bg-brand-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-medium"
                  title="Generate deskripsi dengan AI"
                >
                  {metaDescLoading ? <Loader className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  <span className="hidden sm:inline">AI</span>
                </button>
              </div>
              <div className="relative">
                <input
                  id="input-desc"
                  type="text"
                  value={metaDesc}
                  onChange={(e) => setMetaDesc(e.target.value)}
                  placeholder="Ringkasan singkat artikel"
                  className="w-full pr-6 bg-transparent border-b border-surface-200 hover:border-surface-300 focus:border-brand-500 outline-none py-1 text-sm text-surface-600 placeholder:text-surface-300 transition-colors"
                />
                {metaDesc.length > 0 && (
                  <button
                    id="btn-desc-clear"
                    type="button"
                    onClick={() => setMetaDesc('')}
                    className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-brand-600 transition-colors"
                    title="Hapus deskripsi"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {(() => {
                const len = metaDesc.length;
                const max = 160;
                const color = len > max ? 'text-brand-600' : len > max * 0.9 ? 'text-yellow-500' : 'text-surface-400';
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
        <section id="score-panel" className={`score-panel-section ${showMobileEval ? 'hidden' : 'flex'} md:flex flex-col min-w-0 panel transition-all duration-300 hover:shadow-lg bg-gradient-to-b from-white to-yellow-50/20`}>
          <div className="accent-stripe shrink-0" />
          <div className="p-4 flex flex-col h-full">
            {/* Header */}
            <div className="score-header flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 group cursor-default">
                <h2 className="text-sm font-bold text-surface-900 font-display transition-colors duration-300 group-hover:text-brand-700">Live score</h2>
                {activeReport && (
                  <span className={`score-badge text-[10px] font-semibold px-2.5 py-0.5 rounded-full shadow-sm animate-fade-in ${statusConfig?.bg} ${statusConfig?.color} ${statusConfig?.border} border`}>
                    {statusConfig?.label}
                  </span>
                )}
              </div>
              {!activeReport && <span className="text-[10px] text-surface-400 italic">Prioritas langkah selanjutnya.</span>}
            </div>

            {!activeReport ? (
              /* Empty state */
              <div className="score-empty-state flex flex-col items-center justify-center text-center py-8 flex-1">
                <div className="w-24 h-24 mb-4 relative animate-float">
                  <svg className="w-24 h-24 -rotate-90 opacity-50" viewBox="0 0 36 36">
                    <defs>
                      <linearGradient id="ringEmpty" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#ef4444" />
                        <stop offset="100%" stopColor="#fca5a5" />
                      </linearGradient>
                    </defs>
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="2" strokeDasharray="4 3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="url(#ringEmpty)" strokeWidth="2" strokeDasharray="15 77.39" strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Scale className="w-7 h-7 text-surface-300" />
                  </div>
                </div>
                <p className="text-sm font-bold text-surface-700 mb-1">Belum Ada Skor</p>
                <p className="text-[11px] text-surface-500 leading-relaxed mb-4 max-w-[200px]">Klik <strong className="text-brand-600 font-bold">Periksa</strong> untuk memulai evaluasi artikel</p>
                <div className="flex items-center gap-2 text-[10px] font-medium text-surface-400 bg-surface-50 px-3 py-1.5 rounded-full border border-surface-100">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                  Menunggu...
                </div>
              </div>
            ) : aiLoading ? (
              /* Single centered loading animation */
              <div className="flex items-center justify-center py-12 animate-fade-in">
                <div className="flex flex-col items-center gap-4">
                  <Loader className="w-10 h-10 text-brand-600 animate-spin" />
                  <span className="text-xs font-semibold text-surface-400">Mengevaluasi artikel...</span>
                </div>
              </div>
            ) : (
              /* Ring chart + Sub-scores side by side */
              <div className="score-results-state flex items-start gap-6 mb-4 animate-slide-in-right">
                {/* Ring chart */}
                <div className="relative w-28 h-28 shrink-0 group">
                  <svg className="w-28 h-28 -rotate-90 transform transition-transform duration-500 group-hover:scale-105" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none"
                      stroke={score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="3" strokeDasharray={`${(score / 100) * 97.39} 97.39`}
                      strokeLinecap="round" className="transition-all duration-1000 ease-out" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-3xl font-black tracking-tighter leading-none ${statusConfig?.color || 'text-surface-900'}`}>{animatedScore}</span>
                    <span className="text-[9px] font-medium text-surface-400 mt-1 uppercase tracking-wider">of 100</span>
                  </div>
                </div>
                {/* Sub-scores */}
                <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                  {([
                    { label: 'SEO', value: aiResults?.subScores?.seo || 0, icon: Search },
                    { label: 'Structure', value: aiResults?.subScores?.structure || 0, icon: Layers },
                    { label: 'Intent', value: aiResults?.subScores?.intent || 0, icon: Crosshair },
                    { label: 'Tone', value: aiResults?.subScores?.tone || 0, icon: Volume2 },
                  ] as const).map(({ label, value, icon: Icon }) => (
                    <div key={label} className={`flex flex-col justify-center p-2.5 rounded-xl border transition-all duration-300 hover:shadow-sm hover:-translate-y-0.5 group cursor-default ${value >= 80 ? 'bg-emerald-50/50 border-emerald-200 border-l-4 border-l-emerald-500' : value >= 60 ? 'bg-yellow-50/50 border-yellow-200 border-l-4 border-l-yellow-500' : 'bg-red-50/30 border-red-200 border-l-4 border-l-red-400'}`}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon className={`w-3 h-3 ${value >= 80 ? 'text-emerald-500' : value >= 60 ? 'text-yellow-500' : 'text-red-400'}`} />
                        <span className="text-[9px] text-surface-500 font-semibold uppercase tracking-wider">{label}</span>
                      </div>
                      <span className={`text-lg font-black tracking-tight ${value >= 80 ? 'text-emerald-700' : value >= 60 ? 'text-yellow-700' : 'text-red-600'}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            {aiResults?.bestNextMove && !aiLoading && (
              <div className="relative border-2 border-dashed border-teal-400 bg-teal-50/50 rounded-2xl p-5 shadow-sm animate-fade-in mt-auto transition-shadow duration-300 hover:shadow-md">
                <div className="flex items-start gap-3 mb-2">
                  <div className="bg-teal-100 p-2 rounded-xl shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-teal-500 mb-0.5">Summary</p>
                    <p className="text-[13px] text-gray-700 leading-relaxed">{aiResults.bestNextMove}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Row 2 Col 1: Article Editor */}
        <section id="editor-area" className={`editor-panel-section ${showMobileEval ? 'hidden' : 'flex'} md:flex flex-col min-w-0 panel relative transition-all duration-300 hover:shadow-lg`} style={{ minHeight: '680px' }}>
          <div className="accent-stripe shrink-0" />
          {/* Toolbar */}
          <div className="editor-toolbar px-4 md:px-6 py-2.5 flex flex-nowrap md:flex-wrap overflow-x-auto md:overflow-visible items-center gap-1 border-b border-surface-100 bg-white scrollbar-hide shadow-sm z-10 relative">
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
                aria-pressed={Boolean(activeStyles?.[item.action as 'h1' | 'h2' | 'h3'])}
                className={toolbarToggleClass(Boolean(activeStyles?.[item.action as 'h1' | 'h2' | 'h3']))}
                title={item.label}
              >
                <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-600 transition-opacity ${activeStyles?.[item.action as 'h1' | 'h2' | 'h3'] ? 'opacity-100' : 'opacity-0'}`} />
                <item.icon className={toolbarIconClass(Boolean(activeStyles?.[item.action as 'h1' | 'h2' | 'h3']))} />
              </button>
            ))}
            <div className="w-px h-5 bg-surface-200 mx-1.5" />
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
                aria-pressed={Boolean(activeStyles?.[item.action as 'bold' | 'italic' | 'underline'])}
                className={toolbarToggleClass(Boolean(activeStyles?.[item.action as 'bold' | 'italic' | 'underline']))}
                title={item.label}
              >
                <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-600 transition-opacity ${activeStyles?.[item.action as 'bold' | 'italic' | 'underline'] ? 'opacity-100' : 'opacity-0'}`} />
                <item.icon className={toolbarIconClass(Boolean(activeStyles?.[item.action as 'bold' | 'italic' | 'underline']))} />
              </button>
            ))}
            <div className="w-px h-5 bg-surface-200 mx-1.5 hidden md:block" />
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
                  className="btn-toolbar p-2 rounded-lg hover:bg-brand-50 text-surface-600 hover:text-brand-700 transition-all duration-200 group"
                  title={item.label}
                >
                  <item.icon className="w-4 h-4 transition-transform group-hover:scale-110" />
                </button>
              ))}
              <div className="w-px h-5 bg-surface-200 mx-1.5" />
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
                onClick={() => handleToolbar(item.action)}
                className="btn-toolbar p-2 rounded-lg hover:bg-brand-50 text-surface-600 hover:text-brand-700 transition-all duration-200 group"
                title={item.label}
              >
                <item.icon className="w-4 h-4 transition-transform group-hover:scale-110" />
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
                className="p-2 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 group"
                title="Undo (Ctrl+Z)"
              >
                <RotateCcw className="w-3.5 h-3.5 transition-transform group-hover:-rotate-45" />
              </button>
              <button
                id="toolbar-redo"
                type="button"
                onClick={handleRedo}
                disabled={redoStackRef.current.length === 0}
                className="p-2 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 group"
                title="Redo (Ctrl+Y)"
              >
                <RotateCcw className="w-3.5 h-3.5 scale-x-[-1] transition-transform group-hover:rotate-45" />
              </button>
            </div>
            <div id="toolbar-wordcount" className="text-[11px] font-medium text-surface-500 bg-surface-100 px-2.5 py-1 rounded-md shadow-sm border border-surface-200/50">{wordCount} kata</div>
          </div>

          {/* WYSIWYG Editor */}
          <div
            id="editor-wrapper"
            ref={editorWrapperRef}
            data-editor-wrapper
            className="editor-wrapper flex-1 relative px-6 md:px-12 py-5 md:py-7"
            onClick={(e) => {
              editorRef.current?.focus();
              const target = e.target as HTMLElement;
              if (target.tagName !== 'IMG' && !target.closest('mark') && !target.closest('.issue-popup')) {
                clearTimeout(hideTimeoutRef.current);
                hoverTargetRef.current = null;
                setHover(null);
                selectedImgRef.current = null;
                setSelectedImgInfo(null);
              }
            }}
            onMouseLeave={() => { clearTimeout(hideTimeoutRef.current); hoverTargetRef.current = null; setHover(null); }}
          >
            <TipTapEditor
              ref={editorRef}
              initialContent={htmlContent}
              onUpdate={onTipTapUpdate}
              onActiveStylesChange={setActiveStyles}
              onEditorClick={handleEditorClick}
              onEditorMouseOver={handleEditorMouseOver}
              placeholder="Mulai menulis artikel Anda di sini..."
            />
            {flashText && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="px-4 py-2 bg-surface-800 text-white text-xs font-medium rounded-full shadow-lg animate-fade-up backdrop-blur-sm bg-opacity-90">
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
                ref={popupRef}
                className="issue-popup fixed z-[100] w-72 bg-white/95 backdrop-blur-md border border-surface-200 shadow-xl shadow-surface-900/5 rounded-xl overflow-hidden"
                style={{ left: `${hover.x}px`, top: `${hover.y}px`, transform: 'translateX(-50%)' }}
                onMouseEnter={() => clearTimeout(hideTimeoutRef.current)}
                onMouseLeave={scheduleHide}
              >
                <div id="issue-popup-header" className="flex items-start gap-2 px-4 pt-4 pb-2 border-b border-surface-100 shrink-0">
                  {passed ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />}
                  <h4 id="issue-popup-title" className="text-sm font-bold text-surface-900 leading-tight">{hover.label}</h4>
                </div>
                <div id="issue-popup-body" className="overflow-y-auto px-4" style={{ maxHeight: '120px' }}>
                  <p id="issue-popup-reason" className="text-xs text-surface-600 leading-relaxed py-3">{hover.reason}</p>

                  {!isSop && hover.text && (
                    <div className="text-[10px] text-surface-500 bg-surface-50/50 border border-surface-200 rounded-lg px-2.5 py-1.5 mb-3 line-clamp-3 font-medium">"{hover.text}"</div>
                  )}

                  {isSop && !passed && (
                    <div id="issue-popup-sop" className="bg-brand-50/50 rounded-lg p-2.5 text-[11px] text-surface-700 border border-brand-100 mb-3">
                      <div className="font-bold text-brand-800 mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3"/> SOP</div>
                      {issue ? SUGGESTED_LABELS[issue.id] || 'Periksa kembali bagian ini sesuai SOP.' : ''}
                    </div>
                  )}
                </div>
                <div id="issue-popup-actions" className="flex items-center justify-between px-4 pb-4 pt-2 border-t border-surface-100 shrink-0">
                  {isSop && !passed && issue && issue.id === 56 ? (
                    <button
                      id="issue-popup-autocorrect-case"
                      type="button"
                      onClick={() => handleAutoCorrectCase(issue)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50 disabled:cursor-wait transition-all shadow-sm hover:shadow-md"
                    >
                      Auto Correct
                    </button>
                  ) : isSop && !passed && issue ? (
                    <button
                      id="issue-popup-autocorrect"
                      type="button"
                      disabled={fixingId === issue.id}
                      onClick={() => handleAutoCorrect(issue)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50 disabled:cursor-wait transition-all shadow-sm hover:shadow-md"
                    >
                      {fixingId === issue.id ? 'Memperbaiki...' : 'Auto Correct'}
                    </button>
                  ) : hover.kind === 'ai-detector' ? (
                    <button
                      type="button"
                      disabled={aiDetectorFixLoading}
                      onClick={() => handleAutoCorrectHighlight('ai-detector', hover.text)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-wait transition-all shadow-sm hover:shadow-md"
                    >
                      {aiDetectorFixLoading ? 'Memperbaiki...' : 'Auto Correct'}
                    </button>
                  ) : hover.kind === 'plagiarism' ? (
                    <button
                      type="button"
                      disabled={plagiarismFixLoading}
                      onClick={() => handleAutoCorrectHighlight('plagiarism', hover.text)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-wait transition-all shadow-sm hover:shadow-md"
                    >
                      {plagiarismFixLoading ? 'Memperbaiki...' : 'Auto Correct'}
                    </button>
                  ) : <span />}

                  {isSop && issue ? (
                    <button
                      id="issue-popup-ignore"
                      type="button"
                      onClick={() => {
                        const next = new Set(ignoredIds);
                        if (next.has(issue.id)) next.delete(issue.id); else next.add(issue.id);
                        setIgnoredIds(next);
                        ignoredIdsRef.current = next;
                        setHover(null);
                        setTimeout(() => applyHighlights(undefined, activeEvalTab), 50);
                      }}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-surface-100 text-surface-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      {ignoredIds.has(issue.id) ? 'Batalkan' : 'Abaikan'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setHover(null)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-surface-100 text-surface-700 hover:bg-surface-200 transition-colors"
                    >
                      Tutup
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
          <div id="chatbot-container" className="chatbot-widget absolute bottom-6 right-4 z-[100] flex flex-col items-end gap-3">
          {chatOpen && (
            <div id="chat-panel" ref={chatRef} className="w-80 sm:w-96 h-[400px] bg-white/95 backdrop-blur-xl border border-surface-200 shadow-2xl shadow-brand-900/10 rounded-2xl flex flex-col overflow-hidden animate-slide-in-right origin-bottom-right">
              <div id="chat-header" className="flex items-center justify-between px-4 py-3 border-b border-surface-100 bg-surface-50/80">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-brand-600" />
                  <span id="chat-title" className="text-sm font-bold text-surface-900 font-display">Asisten Artikel</span>
                </div>
                <div id="chat-header-actions" className="flex items-center gap-1">
                  {chatMessages.length > 0 && (
                    <button
                      id="chat-btn-clear"
                      type="button"
                      onClick={() => setChatMessages([])}
                      className="text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors p-1.5 rounded-lg leading-none"
                      title="Hapus riwayat chat"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button id="chat-btn-close" type="button" onClick={() => setChatOpen(false)} className="text-surface-400 hover:text-surface-700 hover:bg-surface-100 transition-colors p-1.5 rounded-lg text-lg leading-none">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div id="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-4 text-xs bg-white/50 scrollbar-hide">
                {chatMessages.length === 0 && (
                  <div id="chat-welcome" className="text-surface-400 text-center py-8 animate-fade-in flex flex-col items-center">
                    <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center mb-3">
                      <Sparkles className="w-6 h-6 text-brand-600" />
                    </div>
                    <p className="font-bold text-surface-700 mb-1.5">Tanya Asisten Artikel</p>
                    <p className="text-[11px] leading-relaxed max-w-[80%] text-center">Contoh: "perbaiki grammar", "tambah paragraf tentang sanksi hukum", "buat pembukaan lebih profesional"</p>
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div id={`chat-message-${i}`} key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-up`} style={{ animationDelay: '50ms' }}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed whitespace-pre-wrap shadow-sm ${m.role === 'user' ? 'bg-gradient-to-br from-surface-800 to-surface-900 text-white rounded-tr-sm' : 'bg-white border border-surface-200 text-surface-700 rounded-tl-sm'}`}>
                      {m.role === 'assistant' && !m.content.startsWith('⚠️') ? (
                        <div>
                          <span className="line-clamp-6">{m.content}</span>
                          {m.type === 'article' && (
                            <button
                              id={`chat-btn-apply-${i}`}
                              type="button"
                              onClick={() => setArticleFromMarkdown(m.content)}
                              className="inline-flex items-center gap-1 mt-2 text-[10px] font-bold text-brand-600 hover:text-brand-700 bg-brand-50 px-2 py-1 rounded-md transition-colors group"
                            >
                              Terapkan ke artikel <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
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
                  <div id="chat-loading" className="flex justify-start animate-fade-in">
                    <div className="bg-white border border-surface-200 text-surface-500 rounded-2xl rounded-tl-sm px-4 py-2.5 text-[11px] flex items-center gap-1.5 shadow-sm">
                      <div className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
              </div>
              <div id="chat-input-area" className="border-t border-surface-100 p-3 flex gap-2 bg-white">
                <input
                  id="chat-input"
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleChatSend())}
                  placeholder="Tanya asisten..."
                  disabled={chatLoading}
                  className="flex-1 bg-surface-50 border border-surface-200 rounded-xl px-3.5 py-2 text-xs outline-none focus:border-brand-400 focus:bg-white transition-all placeholder:text-surface-400 disabled:opacity-50"
                />
                <button
                  id="chat-btn-send"
                  type="button"
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-3.5 py-2 bg-gradient-to-r from-brand-700 to-brand-600 text-white text-xs font-bold rounded-xl hover:shadow-md hover:from-brand-800 hover:to-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shrink-0 flex items-center gap-1 group"
                >
                  <Send className="w-3.5 h-3.5 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          )}
          <button
            id="chat-btn-toggle"
            type="button"
            onClick={() => setChatOpen(!chatOpen)}
            className="w-12 h-12 bg-gradient-to-br from-brand-700 to-brand-500 text-white rounded-full shadow-lg shadow-brand-700/30 hover:shadow-xl hover:scale-105 transition-all duration-300 flex items-center justify-center group"
            title="Buka Asisten Artikel"
          >
            <Bot className="w-5 h-5 transition-transform duration-300 group-hover:animate-gentle-pulse" />
          </button>
        </div>
        </section>

        {/* Row 2 Col 2: Evaluasi Artikel */}
        <aside id="eval-panel" className={`eval-panel-section ${showMobileEval ? 'flex' : 'hidden'} md:flex flex-col min-w-0 panel self-start transition-all duration-300 hover:shadow-lg`}>
          <div className="accent-stripe shrink-0" />
          <div id="eval-header" className="px-5 py-3.5 border-b border-surface-100 bg-yellow-50/20">
            <div className="flex items-center justify-between">
              <h2 id="eval-title" className="text-sm font-bold text-surface-900 font-display">Evaluasi Artikel</h2>
              <button
                id="btn-periksa"
                type="button"
                onClick={async () => {
                  if (checkingRef.current) return;
                  checkingRef.current = true;
                  try {
                    await runAllChecks();
                  } finally {
                    checkingRef.current = false;
                  }
                }}
                disabled={checkingRef.current || !article.trim()}
                title={!article.trim() ? 'Tulis artikel terlebih dahulu.' : 'Jalankan pengecekan SOP, AI, dan plagiarisme'}
                className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-br from-brand-700 to-brand-600 text-white text-xs font-bold rounded-lg hover:shadow-md hover:from-brand-800 hover:to-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-brand-700/20 group"
              >
                {checkingRef.current ? (
                  <>
                    <Loader className="w-3.5 h-3.5 text-white animate-spin" /> Memeriksa...
                  </>
                ) : (
                  <>
                    <Target className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" /> Periksa
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

          {aiFeatureErrors['auto-correct'] && (
            <div className="px-5 pt-3">
              <AiErrorFallback feature="auto-correct" onDismiss={() => clearError('auto-correct')} />
            </div>
          )}

          <div data-eval-panel className="p-5 pb-20 md:pb-5">
            {(() => {
              const _sopLoading = (isAnalyzing || aiLoading) && !aiResults;
              const _aiDetLoading = aiDetectorLoading && !aiDetectorResult;
              const _plagLoading = plagiarismLoading && !plagiarismResult;
              const _tabLoading = activeEvalTab === 'sop' ? _sopLoading : activeEvalTab === 'ai-detector' ? _aiDetLoading : _plagLoading;
              if (_tabLoading) return (
                <div className="flex items-center justify-center h-full min-h-[250px] animate-fade-in">
                  <div className="flex flex-col items-center gap-5">
                    <Loader className="w-8 h-8 text-brand-600 animate-spin" />
                    <span className="text-sm font-bold text-surface-500">Menganalisis artikel...</span>
                  </div>
                </div>
              );
              return (
                <>
                  {evaluationAccuracy && evaluationAccuracy.overall > 0 && (
                    <div className={`mb-5 p-4 rounded-xl border ${getAccuracyBadgeClasses(evaluationAccuracy.overall)} animate-fade-in`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-surface-700" />
                          <span className="text-xs font-bold text-surface-900">Tingkat Kepercayaan Evaluasi</span>
                        </div>
                        <span className="text-sm font-bold text-surface-900">{evaluationAccuracy.label} ({evaluationAccuracy.overall}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/60 overflow-hidden mb-2">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${getAccuracyBarColor(evaluationAccuracy.overall)}`}
                          style={{ width: `${evaluationAccuracy.overall}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-surface-700 leading-relaxed mb-1.5">{evaluationAccuracy.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {evaluationAccuracy.factors.map((f) => (
                          <span key={f} className="text-[10px] px-2 py-0.5 rounded-full bg-white/60 font-medium text-surface-800">{f}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeEvalTab !== 'sop' ? null : !activeReport ? (
                      <div className="flex flex-col items-center text-center pt-10 animate-fade-in">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-50 to-surface-50 border-2 border-dashed border-surface-200 flex items-center justify-center mb-4 shadow-sm">
                          <Target className="w-7 h-7 text-surface-400" />
                        </div>
                        <p className="text-sm font-bold text-surface-700 mb-1">Belum Ada Evaluasi</p>
                        <p className="text-[11px] text-surface-500 max-w-[220px] leading-relaxed mb-4">
                          Klik <strong className="text-brand-600 font-bold">Periksa</strong> untuk menjalankan SOP check
                        </p>
                      </div>
                  ) : (
<div className="space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900 mb-5 pb-2.5 border-b-2 border-gray-100 tracking-tight">Daftar Issue</h3>
                      {(() => {
                        const a: typeof CATEGORIES = [];
                        const b: typeof CATEGORIES = [];
                        const c: typeof CATEGORIES = [];
                        for (const cat of CATEGORIES) {
                          const st = getCategoryStatus(activeReport, cat.id);
                          const i = getCategoryIssue(activeReport, cat.id);
                          const catItems = activeReport.items.filter((item) => cat.checks.includes(item.id));
                          const allApproved = catItems.length > 0 && catItems.every((item) => approvedIds.has(item.id) || item.status === 'passed');
                          if (st === 'passed' || allApproved) {
                            c.push(cat);
                          } else if (st === 'failed' && i?.problematic_text?.trim()) {
                            a.push(cat);
                          } else {
                            b.push(cat);
                          }
                        }
                        const toggleCategoryApprove = (catId: string) => {
                          const items = activeReport.items.filter((item) => CATEGORIES.find((c) => c.id === catId)?.checks.includes(item.id));
                          const isAlreadyApproved = items.some((item) => approvedIds.has(item.id));
                          let anyIsIgnored = false;
                          if (!isAlreadyApproved) {
                            anyIsIgnored = items.some((item) => item.status !== 'passed' && ignoredIds.has(item.id));
                          }
                          const nextApproved = new Set(approvedIds);
                          const nextIgnored = new Set(ignoredIds);
                          if (isAlreadyApproved) {
                            items.forEach((item) => nextApproved.delete(item.id));
                          } else {
                            items.forEach((item) => nextApproved.add(item.id));
                          }
                          if (anyIsIgnored && !isAlreadyApproved) {
                            items.forEach((item) => nextIgnored.delete(item.id));
                          }
                          setApprovedIds(nextApproved);
                          approvedIdsRef.current = nextApproved;
                          setIgnoredIds(nextIgnored);
                          ignoredIdsRef.current = nextIgnored;
                          requestAnimationFrame(() => applyHighlights(undefined, activeEvalTab));
                        };
                        const renderRow = (cat: typeof CATEGORIES[0], clickable: boolean, showApprove = false) => {
                          const iss = getCategoryIssue(activeReport, cat.id);
                          const st = getCategoryStatus(activeReport, cat.id);
                          const isPassed = st === 'passed';
                          const catItems = activeReport.items.filter((item) => cat.checks.includes(item.id));
                          const allIgnored = catItems.every((item) => ignoredIds.has(item.id) || item.status === 'passed');
                          const allApproved = catItems.every((item) => approvedIds.has(item.id) || item.status === 'passed');
                          const isApproved = allApproved && !isPassed;
                          const isIgnored = allIgnored && !allApproved && !isPassed;
                          const visualPassed = isPassed || isApproved;
                          const cardDisabled = !visualPassed && (isIgnored || !clickable);
                          const itemForReason = iss || catItems.find((item) => cat.checks.includes(item.id));
                          return (
                            <div key={cat.id} className={`flex items-center gap-1 transition-all duration-300 ease-in-out ${isIgnored ? 'opacity-60 scale-[0.98]' : 'opacity-100 scale-100'}`}>
                              <button type="button" onClick={() => clickable && iss && !cardDisabled && focusIssue(iss)} disabled={cardDisabled}
                                className={`flex-1 flex items-center gap-2.5 p-2.5 rounded-xl border-l-[3px] border transition-all duration-200 text-left group ${visualPassed ? 'bg-white border-emerald-100 border-l-emerald-400 cursor-default' : isIgnored ? 'bg-gray-50/50 border-gray-100 border-l-gray-200 cursor-default' : clickable ? 'bg-white border-brand-100 border-l-brand-500 hover:bg-brand-50/30 hover:border-brand-200 hover:shadow-sm cursor-pointer active:scale-[0.99]' : 'bg-white border-gray-100 border-l-gray-200 cursor-default'}`}>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-xs font-medium ${visualPassed ? 'text-emerald-600' : isIgnored ? 'text-gray-500' : 'text-gray-800'}`}>{cat.label}</div>
                                  {itemForReason && <div className="text-[10px] text-gray-400 leading-snug mt-0.5">
                                    {itemForReason.reason}
                                    {itemForReason && itemForReason.problematic_text?.includes('|||') && (() => {
                                      const texts = itemForReason.problematic_text.split('|||').filter(Boolean);
                                      const idx = focusIndices[itemForReason.id] ?? 0;
                                      return <span className="ml-2 text-[9px] font-medium text-gray-300">{idx + 1}/{texts.length}</span>;
                                    })()}
                                  </div>}
                                </div>
                                {visualPassed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : isIgnored ? <CheckCircle2 className="w-3.5 h-3.5 text-gray-300 shrink-0" /> : clickable && <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0 opacity-0 group-hover:opacity-100 transition" />}
                              </button>
                              {!visualPassed && !allApproved && !allIgnored && (
                                <div className="flex items-center gap-0.5">
                                  {showApprove && (
                                    <button type="button" onClick={() => toggleCategoryApprove(cat.id)}
                                      className="shrink-0 p-2 rounded-lg hover:bg-emerald-50 transition text-surface-300 hover:text-emerald-500 group/btn"
                                      title="Setujui — anggap sudah benar"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform duration-200" />
                                    </button>
                                  )}
                                  <button type="button" onClick={() => toggleCategoryIgnore(cat.id)}
                                    className="shrink-0 p-2 rounded-lg hover:bg-surface-100 transition text-surface-300 hover:text-surface-500 group/btn"
                                    title="Abaikan issue ini"
                                  >
                                    <X className="w-3.5 h-3.5 group-hover/btn:rotate-90 transition-transform duration-200" />
                                  </button>
                                </div>
                              )}
                              {isApproved && (
                                <button type="button" onClick={() => toggleCategoryApprove(cat.id)}
                                  className="shrink-0 p-2 rounded-lg hover:bg-amber-50 transition text-emerald-400 hover:text-amber-500 group/btn"
                                  title="Batalkan persetujuan"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 group-hover/btn:rotate-180 transition-transform duration-300" />
                                </button>
                              )}
                              {isIgnored && !isPassed && (
                                <button type="button" onClick={() => toggleCategoryIgnore(cat.id)}
                                  className="shrink-0 p-2 rounded-lg hover:bg-surface-100 transition text-surface-400 hover:text-surface-600 group/btn"
                                  title="Batalkan abaikan"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 group-hover/btn:rotate-180 transition-transform duration-300" />
                                </button>
                              )}
                            </div>
                          );
                        };
                        return (
                          <>
                            {a.length > 0 && <div className="space-y-2"><div className="flex items-center gap-1.5 text-[10px] font-semibold text-surface-600 uppercase tracking-wider mb-1.5 px-0.5"><AlertCircle className="w-3 h-3" /> Perlu Diperbaiki</div>{a.map((c) => renderRow(c, true, false))}</div>}
                            {b.length > 0 && <div className={a.length > 0 ? 'mt-5 space-y-2' : 'space-y-2'}><div className="flex items-center gap-1.5 text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1.5 px-0.5"><Info className="w-3 h-3" /> Perlu Review</div>{b.map((c) => renderRow(c, false, true))}</div>}
                            {c.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-gray-100">
                                <button type="button" onClick={() => setShowPassedIssues(!showPassedIssues)}
                                  className="flex items-center gap-2 text-[10px] font-medium text-gray-400 hover:text-gray-600 transition px-0.5"
                                >
                                  <span className={`inline-block transition-transform duration-200 ${showPassedIssues ? 'rotate-90' : ''}`}>▶</span>
                                  {showPassedIssues ? 'Sembunyikan' : 'Lihat'}{' '}
                                  <span className="text-gray-400">{c.length} kategori lulus</span>
                                </button>
                                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showPassedIssues ? 'max-h-[500px] opacity-100 mt-1.5' : 'max-h-0 opacity-0'}`}>
                                  <div className="space-y-1">
                                    {c.map((cat) => renderRow(cat, false))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {activeEvalTab === 'sop' ? (
                    <div className="mt-10 pt-8 border-t border-surface-200">
                      <h3 className="text-xs font-bold text-surface-900 mb-4 flex items-center gap-2">
                        <div className="p-1.5 bg-surface-100 rounded-lg"><BrainCircuit className="w-4 h-4 text-surface-700" /></div> AI Evaluation
                      </h3>

                      {!hasChecked && (
                        <div className="flex flex-col items-center gap-3 py-8 text-center animate-fade-in">
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-50 to-surface-50 border-2 border-dashed border-surface-200 flex items-center justify-center shadow-sm">
                            <BrainCircuit className="w-5 h-5 text-surface-400" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-surface-700 mb-1">Analisis AI</p>
                            <p className="text-[11px] text-surface-500 leading-relaxed">Klik <strong className="text-brand-600 font-bold">Periksa</strong> untuk melihat hasil</p>
                          </div>
                        </div>
                      )}

                      {hasChecked && aiResults && aiResults.results.length > 0 && (() => {
                        const toggleAiIgnore = (id: number) => {
                          const next = new Set(ignoredIds);
                          if (next.has(id)) next.delete(id); else next.add(id);
                        setIgnoredIds(next);
                        ignoredIdsRef.current = next;
                          const nextApproved = new Set(approvedIds);
                          nextApproved.delete(id);
                          setApprovedIds(nextApproved);
                          approvedIdsRef.current = nextApproved;
                          requestAnimationFrame(() => applyHighlights(undefined, activeEvalTab));
                        };
                        const toggleAiApprove = (id: number) => {
                          const next = new Set(approvedIds);
                          if (next.has(id)) next.delete(id); else next.add(id);
                          setApprovedIds(next);
                          approvedIdsRef.current = next;
                          const nextIgnored = new Set(ignoredIds);
                          nextIgnored.delete(id);
                          setIgnoredIds(nextIgnored);
                          ignoredIdsRef.current = nextIgnored;
                          requestAnimationFrame(() => applyHighlights(undefined, activeEvalTab));
                        };
                        const visibleAiResults = aiResults.results.filter((r) => {
                          if (r.status === 'deferred') return true;
                          if (r.passed) return true;
                          if (!r.problematic_text?.trim()) return false;
                          // Auto-hide if problematic text no longer exists in article (typo already fixed)
                          const lowerArticle = article.toLowerCase();
                          const texts = r.problematic_text.split('|||').filter(Boolean);
                          const anyStillExists = texts.some((t) => {
                            const clean = t.trim().toLowerCase();
                            return clean.length > 0 && lowerArticle.includes(clean);
                          });
                          return anyStillExists;
                        });
                        if (visibleAiResults.length === 0) return null;
                        return (
                          <>
                            <div className="space-y-5">
                              {visibleAiResults.map((r) => {
                                const score = r.aiConfidence || 0;
                                const passed = r.status === 'passed';
                                const isError = r.category === 'Error' && !passed;
                                const hasText = !!r.problematic_text?.trim();
                                const isIgnored = ignoredIds.has(r.id);
                                const hasAutoCorrect = r.auto_correct_button;
                                const Card = 'div';
                                const cardProps = (hasText && !passed && !isIgnored) ? { role: 'button' as const, tabIndex: 0, onClick: () => { setActiveIssueId(r.id); focusIssue(r); requestAnimationFrame(() => applyHighlights(undefined, activeEvalTab)); }, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveIssueId(r.id); focusIssue(r); requestAnimationFrame(() => applyHighlights(undefined, activeEvalTab)); } } } : {};
                                const isActive = activeIssueId === r.id;
                                const cardBorder = passed
                                  ? 'bg-white border-emerald-200 border-l-[3px] border-l-emerald-400'
                                  : isError
                                    ? 'bg-gradient-to-br from-white to-red-50/30 border-red-200 border-l-[3px] border-l-red-400 shadow-sm hover:shadow-md hover:border-red-300'
                                    : 'bg-gradient-to-br from-white to-yellow-50/30 border-yellow-200 border-l-[3px] border-l-yellow-400 shadow-sm hover:shadow-md hover:border-yellow-300';
                                const cardInteractive = hasText && !passed && !isIgnored ? 'cursor-pointer active:scale-[0.99]' : '';
                                const cardActive = isActive ? 'ring-2 ring-yellow-400/50 ring-offset-1' : '';
                                return (
                                  <div key={r.id} className={`flex items-start gap-1 transition-all duration-300 ease-in-out ${isIgnored ? 'opacity-60 scale-[0.98]' : 'opacity-100 scale-100'}`}>
                                    <Card {...cardProps}
                                      className={`flex-1 flex flex-col p-4 rounded-2xl border text-left transition-all duration-200 group ${cardBorder} ${cardInteractive} ${cardActive}`}
                                    >
                                      <div className="flex items-start gap-3">
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-1.5">
                                            <div className="text-[13px] font-semibold text-gray-800 leading-snug">{r.question}</div>
                                            {!passed && r.category && (
                                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${isError ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-yellow-50 text-yellow-600 border border-yellow-200'}`}>
                                                {r.category}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-[11px] text-gray-500 leading-relaxed mb-1">{r.reason || '-'}</div>
                                          {hasText && (
                                            <div className="mt-2 text-[10px] text-gray-400 bg-gray-50/80 border border-gray-100 px-3 py-2 rounded-xl italic leading-relaxed">&ldquo;{r.problematic_text}&rdquo;</div>
                                          )}
                                          {r.suggested_fix && !passed && (
                                            <div className={`mt-2.5 text-[11px] text-gray-700 bg-white border px-3 py-2.5 rounded-xl shadow-sm leading-relaxed ${isError ? 'border-red-100 border-l-[3px] border-l-red-400' : 'border-yellow-100 border-l-[3px] border-l-yellow-400'}`}>
                                              <span className={`font-semibold ${isError ? 'text-red-600' : 'text-yellow-600'}`}>Saran:</span> {r.suggested_fix}
                                            </div>
                                          )}
                                          {hasAutoCorrect && !passed && (
                                            <button
                                              type="button"
                                              disabled={fixingId === r.id}
                                              onClick={(e) => { e.stopPropagation(); handleAutoCorrect(r); }}
                                              className={`mt-2 text-[10px] font-semibold px-3 py-1.5 rounded-xl text-white disabled:opacity-50 transition flex items-center gap-1.5 shadow-sm ${isError ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-500 hover:bg-yellow-600'}`}
                                            >
                                              {fixingId === r.id ? <Loader className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                                              {fixingId === r.id ? 'Memperbaiki...' : 'Auto Correct'}
                                            </button>
                                          )}
                                        </div>
                                        {!passed && (
                                          <div className="flex flex-col items-center gap-1 shrink-0 min-w-[28px]">
                                            <span className={`text-[11px] font-bold ${passed ? 'text-emerald-600' : isError ? 'text-red-500' : 'text-yellow-500'}`}>{score}</span>
                                          </div>
                                        )}
                                      </div>
                                      {!passed && (
                                        <div className="mt-2.5 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                          <div className={`h-full rounded-full transition-all ${passed ? 'bg-emerald-400' : isError ? 'bg-red-400' : 'bg-yellow-400'}`} style={{ width: `${score}%` }} />
                                        </div>
                                      )}
                                    </Card>
                                    {!passed && !isIgnored && (
                                      <div className="flex flex-col items-center gap-0.5 mt-2">
                                        {!isError && (
                                          <button type="button" onClick={() => toggleAiApprove(r.id)}
                                            className="shrink-0 p-2 rounded-lg hover:bg-emerald-50 transition text-surface-300 hover:text-emerald-500 group/btn"
                                            title="Setujui — anggap sudah benar"
                                          >
                                            <CheckCircle2 className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform duration-200" />
                                          </button>
                                        )}
                                        <button type="button" onClick={() => toggleAiIgnore(r.id)}
                                          className="shrink-0 p-2 rounded-lg hover:bg-surface-100 transition text-surface-300 hover:text-surface-500 group/btn"
                                          title="Abaikan issue ini"
                                        >
                                          <X className="w-3.5 h-3.5 group-hover/btn:rotate-90 transition-transform duration-200" />
                                        </button>
                                      </div>
                                    )}
                                    {!passed && isIgnored && (
                                      <button type="button" onClick={() => toggleAiIgnore(r.id)}
                                        className="shrink-0 p-2 rounded-lg hover:bg-surface-100 transition text-surface-400 hover:text-surface-600 mt-2 group/btn"
                                        title="Batalkan abaikan"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5 group-hover/btn:rotate-180 transition-transform duration-300" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                      {aiResults && aiResults.results.length === 0 && (
                        <>
                          {aiFeatureErrors['sop-ai-eval'] ? (
                            <AiErrorFallback feature="sop-ai-eval" onRetry={() => runAnalysis()} onDismiss={() => clearError('sop-ai-eval')} />
                          ) : (
                            <div className="flex items-center gap-2.5 p-3 rounded-xl border bg-emerald-50 border-emerald-100">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              <span className="text-[11px] text-emerald-700 leading-relaxed">AI tidak menemukan masalah pada artikel ini.</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : null}

                  {activeEvalTab === 'ai-detector' ? (
                    <div className="flex flex-col animate-fade-in" style={{ minHeight: '200px' }}>
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-brand-50 rounded-lg"><ShieldCheck className="w-4 h-4 text-brand-600" /></div>
                          <span className="text-xs font-bold text-surface-900">AI Content Detector</span>
                        </div>
                        <span className="text-[10px] text-surface-400 italic">Gunakan tombol Periksa utama</span>
                      </div>

                      {!aiDetectorResult && !aiDetectorLoading && (
                        <div className="flex flex-col items-center justify-center h-full text-center py-12">
                          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-50 to-surface-50 border-2 border-dashed border-surface-200 flex items-center justify-center mb-5 shadow-sm animate-float">
                            <ShieldCheck className="w-8 h-8 text-surface-400" />
                          </div>
                          <p className="text-sm font-bold text-surface-700 mb-1.5">AI Detector</p>
                          <p className="text-[11px] text-surface-500 max-w-[200px] leading-relaxed">
                            Deteksi apakah teks terdeteksi sebagai AI-generated menggunakan ChatGPT.
                          </p>
                        </div>
                      )}

                      {aiFeatureErrors['ai-detector'] && (
                        <AiErrorFallback feature="ai-detector" onRetry={() => handleDetectAI()} onDismiss={() => clearError('ai-detector')} />
                      )}

                      {aiDetectorResult && !aiFeatureErrors['ai-detector'] && (
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
                                <><Loader className="w-3.5 h-3.5 text-white animate-spin" /> Memperbaiki...</>
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
<div className="p-2 space-y-1">
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
                    <div className="flex flex-col animate-fade-in" style={{ minHeight: '200px' }}>
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-brand-50 rounded-lg"><ScanLine className="w-4 h-4 text-brand-600" /></div>
                          <span className="text-xs font-bold text-surface-900">Plagiarism Checker</span>
                        </div>
                        <span className="text-[10px] text-surface-400 italic">Gunakan tombol Periksa utama</span>
                      </div>

                      {!plagiarismResult && !plagiarismLoading && (
                        <div className="flex flex-col items-center justify-center h-full text-center py-12">
                          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-50 to-surface-50 border-2 border-dashed border-surface-200 flex items-center justify-center mb-5 shadow-sm animate-float">
                            <ScanLine className="w-8 h-8 text-surface-400" />
                          </div>
                          <p className="text-sm font-bold text-surface-700 mb-1.5">Plagiarism Checker</p>
                          <p className="text-[11px] text-surface-500 max-w-[200px] leading-relaxed">
                            Periksa plagiasi artikel menggunakan ChatGPT.
                          </p>
                        </div>
                      )}

                      {aiFeatureErrors['plagiarism'] && (
                        <AiErrorFallback feature="plagiarism" onRetry={() => handleCheckPlagiarism()} onDismiss={() => clearError('plagiarism')} />
                      )}

                      {plagiarismResult && !aiFeatureErrors['plagiarism'] && (
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
                                <><Loader className="w-3.5 h-3.5 text-white animate-spin" /> Memperbaiki...</>
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
<div className="p-2 space-y-1">
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
            <><Target className="w-3.5 h-3.5" /> Lihat Evaluasi{activeReport && ` (${activeReport.items.filter((i) => i.status === 'passed').length}/${activeReport.items.length})`}</>
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

              {aiFeatureErrors['keyword-gen'] && (
                <div className="mb-3">
                  <AiErrorFallback feature="keyword-gen" onDismiss={() => clearError('keyword-gen')} />
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
                          const kdColor = m.keywordDifficulty >= 60 ? 'text-emerald-600' : m.keywordDifficulty >= 30 ? 'text-yellow-600' : 'text-red-600';
                          const relColor = rel >= 7 ? 'text-emerald-600' : rel >= 4 ? 'text-yellow-600' : 'text-red-600';
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
              <AlertCircle className="w-5 h-5 text-yellow-500" />
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
        .issue-highlight-error {
          background-color: rgba(254, 226, 226, 0.7);
          border-bottom: 2px solid rgba(220, 38, 38, 0.4);
          border-radius: 2px;
          cursor: pointer;
        }
        .issue-highlight-error:hover {
          background-color: rgba(252, 165, 165, 0.85);
        }
        .issue-highlight-active {
          box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.6), 0 0 0 4px rgba(250, 204, 21, 0.25);
          border-radius: 3px;
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
        .issue-highlight-ignored {
          background-color: rgba(156, 163, 175, 0.35);
          border-bottom: 2px solid rgba(107, 114, 128, 0.4);
          border-radius: 2px;
          cursor: pointer;
          opacity: 0.6;
        }
        .issue-highlight-ignored:hover {
          background-color: rgba(156, 163, 175, 0.5);
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

export default function App() {
  return (
    <AiErrorProvider>
      <AppContent />
    </AiErrorProvider>
  );
}

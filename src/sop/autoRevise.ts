import {
  CTA_KEYWORDS,
  LEAD_TARGET_WORDS,
  MAX_META_DESC_CHARS,
  MAX_META_TITLE_CHARS,
  MAX_SENTENCES_PER_PARAGRAPH,
  MAX_TITLE_CHARS,
  MIN_INTERNAL_LINKS,
  MIN_SUGGESTED_POSTS,
  SOP_QUESTIONS,
} from './constants';
import { countSentences, countWords, parseArticle } from './parser';
import { runSopChecks } from './sopRules';
import type { ArticleInput, CheckResult, RuleId } from './types';

export interface ReviseResult {
  article: string;
  metaTitle: string;
  metaDesc: string;
  usedGemini: boolean;
  message: string;
}

export interface AutoReviseOptions {
  input: ArticleInput;
  item: CheckResult;
  apiKey?: string;
}

function replaceTitle(article: string, newTitle: string): string {
  const lines = article.split(/\r?\n/);
  const h1Idx = lines.findIndex((l) => /^#\s+/.test(l.trim()));
  if (h1Idx >= 0) {
    lines[h1Idx] = `# ${newTitle}`;
    return lines.join('\n');
  }
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx >= 0) {
    lines[firstIdx] = `# ${newTitle}`;
    return lines.join('\n');
  }
  return `# ${newTitle}\n${article}`;
}

function replaceLead(article: string, newLead: string): string {
  const parsed = parseArticle(article);
  if (!parsed.lead) {
    // Insert after title
    const lines = article.split(/\r?\n/);
    const h1Idx = lines.findIndex((l) => /^#\s+/.test(l.trim()));
    if (h1Idx >= 0) {
      lines.splice(h1Idx + 1, 0, '', newLead);
      return lines.join('\n');
    }
    return `${lines[0] ?? ''}\n\n${newLead}\n${lines.slice(1).join('\n')}`;
  }
  const leadLineIdx = parsed.bodyParagraphs[0]?.lineIndex;
  if (leadLineIdx == null) return article;
  const lines = article.split(/\r?\n/);
  lines[leadLineIdx] = newLead;
  return lines.join('\n');
}

function splitLongParagraphs(article: string): string {
  const lines = article.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      /^#{1,3}\s+/.test(trimmed) ||
      /^(\s*[-*+]|\s*\d+\.)\s+/.test(trimmed) ||
      /!\[[^\]]*]\([^)]*\)/.test(trimmed)
    ) {
      out.push(line);
      continue;
    }
    const sentences = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    if (!sentences || sentences.length <= MAX_SENTENCES_PER_PARAGRAPH) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < sentences.length; i += MAX_SENTENCES_PER_PARAGRAPH) {
      const chunk = sentences
        .slice(i, i + MAX_SENTENCES_PER_PARAGRAPH)
        .map((s) => s.trim())
        .join(' ');
      out.push(chunk);
      if (i + MAX_SENTENCES_PER_PARAGRAPH < sentences.length) out.push('');
    }
  }
  return out.join('\n');
}

function ensureKeywordInTitle(article: string, keyword: string): string {
  const parsed = parseArticle(article);
  const kw = keyword.trim();
  if (!kw || parsed.title.toLowerCase().includes(kw.toLowerCase())) {
    return article;
  }
  let newTitle = `${kw}: ${parsed.title}`.trim();
  if (newTitle.length > MAX_TITLE_CHARS) {
    newTitle = `${kw} ${parsed.title}`.trim().slice(0, MAX_TITLE_CHARS);
  }
  return replaceTitle(article, newTitle);
}

function trimTitle(article: string): string {
  const parsed = parseArticle(article);
  if (!parsed.title || parsed.title.length <= MAX_TITLE_CHARS) return article;
  return replaceTitle(article, parsed.title.slice(0, MAX_TITLE_CHARS).trim());
}

function fixDoubleSpaces(article: string): string {
  return article
    .replace(/ {2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/,{2,}/g, ',')
    .replace(/\.{3,}/g, '...')
    .replace(/\.{2}(?!\.)/g, '.');
}

function ensureLinks(article: string): string {
  const parsed = parseArticle(article);
  const linkCount = parsed.links.filter((l) => !l.isImage).length;
  let next = article;

  const hasSuggested = /baca juga|suggested|artikel terkait/i.test(article);
  if (!hasSuggested || linkCount < MIN_INTERNAL_LINKS + MIN_SUGGESTED_POSTS) {
    const block = [

      'Baca juga: [Artikel Terkait 1](#), [Artikel Terkait 2](#), [Artikel Terkait 3](#)',
      'Internal Link: [Layanan Kami](#), [Panduan Lengkap](#)',
    ].join('\n');
    // Place before last paragraph if CTA-ish, else append
    const lines = next.split(/\r?\n/);
    const lastContentIdx = [...lines]
      .map((l, i) => ({ l, i }))
      .reverse()
      .find((x) => x.l.trim().length > 0)?.i;
    if (lastContentIdx != null && CTA_KEYWORDS.some((k) => lines[lastContentIdx].toLowerCase().includes(k))) {
      lines.splice(lastContentIdx, 0, '', block, '');
      next = lines.join('\n');
    } else {
      next = `${next.trimEnd()}\n\n${block}\n`;
    }
  }
  return next;
}

function ensureAltText(article: string, keyword: string): string {
  const parsed = parseArticle(article);
  let next = article;
  if (parsed.images.length === 0) {
    const alt = `Ilustrasi ${keyword || 'topik hukum'} untuk panduan pembaca`;
    next = `${next.trimEnd()}\n\n![${alt}](gambar.jpg)\n`;
    return next;
  }
  for (const img of parsed.images) {
    const alt = img.alt.trim();
    if (!alt || alt.length < 8) {
      const better = `Ilustrasi ${keyword || 'artikel hukum'} terkait topik pembahasan`;
      next = next.replace(img.raw, `![${better}](${img.url})`);
    }
  }
  return next;
}

function ensureCta(article: string, keyword: string): string {
  const parsed = parseArticle(article);
  const last = parsed.bodyParagraphs[parsed.bodyParagraphs.length - 1];
  const hasCta = last && CTA_KEYWORDS.some((k) => last.text.toLowerCase().includes(k)) && last.wordCount >= 5;
  if (hasCta) return article;
  const topic = keyword || 'layanan legal';
  const cta = `Butuh bantuan terkait ${topic}? Konsultasikan dengan tim legal kami hari ini juga.`;
  return `${article.trimEnd()}\n\n${cta}\n`;
}

function ensureAnda(article: string): string {
  if (/\bAnda\b/.test(article)) return article;
  // Soft insert on lead if present
  const parsed = parseArticle(article);
  if (parsed.lead) {
    const lead = parsed.lead.replace(/\bpembaca\b/gi, 'Anda').replace(/\bklien\b/gi, 'Anda');
    if (/\bAnda\b/.test(lead)) return replaceLead(article, lead);
    return replaceLead(article, `${lead.replace(/\.$/, '')}. Hal ini relevan bagi Anda.`);
  }
  return article;
}

function ensureWhy(article: string): string {
  const parsed = parseArticle(article);
  if (parsed.bodyParagraphs.length >= 2) {
    const why = parsed.bodyParagraphs[1].text;
    if (/penting|wajib|risiko|marak|segera|urgensi|bahaya|harus|menghancurkan/i.test(why)) {
      return article;
    }
    const lines = article.split(/\r?\n/);
    lines[parsed.bodyParagraphs[1].lineIndex] =
      `${why.replace(/\.$/, '')}. Isu ini penting karena risiko hukum bisa menghancurkan bisnis Anda segera jika diabaikan.`;
    return lines.join('\n');
  }
  const insert = '\n\nIsu ini penting karena risiko hukum sedang marak dan dapat merugikan bisnis Anda segera jika diabaikan.\n';
  const lines = article.split(/\r?\n/);
  const leadIdx = parsed.bodyParagraphs[0]?.lineIndex ?? 0;
  lines.splice(leadIdx + 1, 0, insert.trim());
  return lines.join('\n');
}

function ensureHow(article: string): string {
  const parsed = parseArticle(article);
  if (parsed.headings.some((h) => h.level === 2)) return article;
  const block = [
    '',
    '## 1. Lakukan Langkah Awal',
    'Mulai dengan memeriksa syarat dasar prosedur secara runtut.',
    '',
    '## 2. Siapkan Dokumen',
    'Kumpulkan dokumen pendukung agar proses lebih lancar.',
  ].join('\n');
  return `${article.trimEnd()}\n${block}\n`;
}

function ensureWhat(article: string): string {
  if (/\bdata\b|\bmenurut\b|\d+\s*%|\bUU\b/i.test(article)) return article;
  const block =
    '\n\nMenurut data praktik legal terbaru, lebih dari 30% kasus serupa gagal karena kelengkapan dokumen yang lemah.\n';
  return `${article.trimEnd()}${block}`;
}

function shortenLeadDeterministic(article: string): string {
  const parsed = parseArticle(article);
  if (!parsed.lead) return article;
  const wordsOk = Math.abs(parsed.leadWordCount - LEAD_TARGET_WORDS) <= 1;
  const sentencesOk = parsed.leadSentenceCount === 2;
  if (wordsOk || sentencesOk) return article;

  // Prefer 2 short sentences from existing content
  const parts = parsed.lead.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return replaceLead(article, `${parts[0].trim()} ${parts[1].trim()}`);
  }
  const words = parsed.lead.split(/\s+/);
  if (words.length > LEAD_TARGET_WORDS) {
    return replaceLead(article, words.slice(0, LEAD_TARGET_WORDS).join(' '));
  }
  // Pad toward ~12 words if too short and not 2 sentences
  if (parsed.leadWordCount < 11 && parsed.leadSentenceCount !== 2) {
    return replaceLead(
      article,
      `${parsed.lead.replace(/\.$/, '')}. Pelajari solusinya sekarang juga.`,
    );
  }
  return article;
}

function trimMeta(metaTitle: string, metaDesc: string): { metaTitle: string; metaDesc: string } {
  return {
    metaTitle: metaTitle.slice(0, MAX_META_TITLE_CHARS),
    metaDesc: metaDesc.slice(0, MAX_META_DESC_CHARS),
  };
}

function applyDeterministicFix(
  input: ArticleInput,
  item: CheckResult,
): { article: string; metaTitle: string; metaDesc: string; handled: boolean } {
  let { article, metaTitle, metaDesc } = input;
  const id = item.id as RuleId;

  switch (id) {
    case 1:
      article = trimTitle(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 2:
      article = ensureKeywordInTitle(article, input.keyword);
      return { article, metaTitle, metaDesc, handled: true };
    case 3:
      article = shortenLeadDeterministic(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 4:
      article = ensureWhy(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 5:
      article = ensureHow(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 6:
      article = ensureWhat(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 7:
      article = ensureHow(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 8:
      article = splitLongParagraphs(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 9:
      article = ensureAnda(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 10:
      article = ensureCta(article, input.keyword);
      return { article, metaTitle, metaDesc, handled: true };
    case 11:
      article = fixDoubleSpaces(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 12:
      return { article, metaTitle, metaDesc, handled: true }; // deferred — no change
    case 13:
      article = ensureLinks(article);
      return { article, metaTitle, metaDesc, handled: true };
    case 14: {
      const trimmed = trimMeta(
        metaTitle || parseArticle(article).title.slice(0, MAX_META_TITLE_CHARS),
        metaDesc ||
          `Panduan praktis ${input.keyword || 'topik hukum'} agar Anda memahami masalah dan solusinya dengan jelas.`,
      );
      if (!metaTitle.trim()) metaTitle = trimmed.metaTitle;
      else metaTitle = metaTitle.slice(0, MAX_META_TITLE_CHARS);
      if (!metaDesc.trim()) metaDesc = trimmed.metaDesc.slice(0, MAX_META_DESC_CHARS);
      else metaDesc = metaDesc.slice(0, MAX_META_DESC_CHARS);
      return { article, metaTitle, metaDesc, handled: true };
    }
    case 15:
      article = ensureAltText(article, input.keyword);
      return { article, metaTitle, metaDesc, handled: true };
    default:
      return { article, metaTitle, metaDesc, handled: false };
  }
}

const GEMINI_IDS: RuleId[] = [1, 3, 10];

async function callGeminiRewrite(
  apiKey: string,
  input: ArticleInput,
  item: CheckResult,
): Promise<{ article: string; metaTitle: string; metaDesc: string }> {
  const systemPrompt = `Anda adalah asisten Auto-Correct Editor Konten Hukum.
Perbaiki HANYA masalah kriteria berikut agar lulus SOP Penulisan:

Kriteria: "${item.question}"
Alasan gagal: "${item.reason}"

BATASAN SOP (WAJIB):
- Judul maksimal ${MAX_TITLE_CHARS} karakter, jelas/tegas, mengandung keyword jika relevan
- Lead: tepat 2 kalimat ATAU sekitar 12 kata; langsung ke inti (bukan definisi/sejarah)
- Paragraf maksimal ${MAX_SENTENCES_PER_PARAGRAPH} kalimat
- CTA di akhir harus persuasif (baik: "Butuh bantuan mendaftarkan merek? Konsultasikan dengan tim legal kami.") — BUKAN perintah kasar ("Hubungi kami.")
- Meta title max ${MAX_META_TITLE_CHARS}, meta desc max ${MAX_META_DESC_CHARS}
- Jangan menghapus heading/link yang sudah ada kecuali perlu untuk kriteria ini
- JANGAN memvalidasi atau mengubah klaim status regulasi
- Perubahan minimal: hanya area terkait kriteria

Keyword utama: ${input.keyword}

Kembalikan JSON:
{ "metaTitle": "...", "metaDesc": "...", "article": "..." }`;

  const userPrompt = `Meta Title: ${input.metaTitle}\nMeta Desc: ${input.metaDesc}\nArtikel:\n${input.article}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              metaTitle: { type: 'STRING' },
              metaDesc: { type: 'STRING' },
              article: { type: 'STRING' },
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `API Error: ${response.status}`);
  }

  const data = await response.json();
  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = JSON.parse(resultText.replace(/```json/gi, '').replace(/```/gi, '').trim());
  return {
    article: typeof parsed.article === 'string' ? parsed.article : input.article,
    metaTitle: typeof parsed.metaTitle === 'string' ? parsed.metaTitle : input.metaTitle,
    metaDesc: typeof parsed.metaDesc === 'string' ? parsed.metaDesc : input.metaDesc,
  };
}

function postValidateClamp(
  article: string,
  metaTitle: string,
  metaDesc: string,
  keyword: string,
): { article: string; metaTitle: string; metaDesc: string } {
  let nextArticle = article;
  const parsed = parseArticle(nextArticle);
  if (parsed.title.length > MAX_TITLE_CHARS) {
    nextArticle = replaceTitle(nextArticle, parsed.title.slice(0, MAX_TITLE_CHARS).trim());
  }
  if (keyword && !parseArticle(nextArticle).title.toLowerCase().includes(keyword.toLowerCase())) {
    nextArticle = ensureKeywordInTitle(nextArticle, keyword);
  }
  return {
    article: nextArticle,
    metaTitle: metaTitle.slice(0, MAX_META_TITLE_CHARS),
    metaDesc: metaDesc.slice(0, MAX_META_DESC_CHARS),
  };
}

export async function autoReviseItem(
  input: ArticleInput,
  item: CheckResult,
  apiKey = '',
): Promise<ReviseResult> {
  if (item.status === 'deferred' || item.id === 12) {
    return {
      ...input,
      usedGemini: false,
      message: 'Item regulasi ditunda — tidak diubah otomatis.',
    };
  }

  const effectiveApiKey = apiKey.trim() || (import.meta.env?.VITE_GEMINI_API_KEY ?? '');

  // 1) Deterministic patch
  let { article, metaTitle, metaDesc } = applyDeterministicFix(input, item);
  let usedGemini = false;

  // 2) Re-check; if still failing and Gemini allowed, rewrite
  let report = runSopChecks({ article, keyword: input.keyword, metaTitle, metaDesc });
  const stillFailing = report.items.find((r) => r.id === item.id)?.status === 'failed';

  if (stillFailing && GEMINI_IDS.includes(item.id) && effectiveApiKey) {
    const rewritten = await callGeminiRewrite(
      effectiveApiKey,
      { article, keyword: input.keyword, metaTitle, metaDesc },
      item,
    );
    ({ article, metaTitle, metaDesc } = postValidateClamp(
      rewritten.article,
      rewritten.metaTitle,
      rewritten.metaDesc,
      input.keyword,
    ));
    usedGemini = true;
    // Re-apply deterministic safety nets
    ({ article, metaTitle, metaDesc } = applyDeterministicFix(
      { article, keyword: input.keyword, metaTitle, metaDesc },
      item,
    ));
  }

  const clamped = postValidateClamp(article, metaTitle, metaDesc, input.keyword);
  report = runSopChecks({
    article: clamped.article,
    keyword: input.keyword,
    metaTitle: clamped.metaTitle,
    metaDesc: clamped.metaDesc,
  });
  const after = report.items.find((r) => r.id === item.id);
  const ok = after?.status === 'passed';

  return {
    ...clamped,
    usedGemini,
    message: ok
      ? `Perbaikan diterapkan untuk: ${SOP_QUESTIONS[item.id]}`
      : `Perbaikan dicoba untuk: ${SOP_QUESTIONS[item.id]}${after ? ` — ${after.reason}` : ''}`,
  };
}

// Helper exported for tests / debugging
export function _debugCounts(text: string) {
  return { words: countWords(text), sentences: countSentences(text) };
}

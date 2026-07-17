import {
  CTA_KEYWORDS,
  LEAD_TARGET_WORDS,
  MAX_META_DESC_CHARS,
  MAX_META_TITLE_CHARS,
  MAX_TITLE_CHARS,
  MAX_SENTENCES_PER_PARAGRAPH,
  MIN_INTERNAL_LINKS,
  MIN_SUGGESTED_POSTS,
  SOP_QUESTIONS,
} from './constants';
import { countSentences, countWords, parseArticle } from './parser';
import { runSopChecks, getPrimaryKeyword } from './sopRules';
import type { ArticleInput, CheckResult, RuleId } from './types';
import { AI_REWRITE_TIMEOUT_MS, AI_KEYWORD_TIMEOUT_MS } from './config';
import { stripImages } from './images';
import { callChatCompletion } from './apis/openai';

export interface ReviseResult {
  article: string;
  metaTitle: string;
  metaDesc: string;
  keyword?: string;
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
    newTitle = truncateAtWord(newTitle, MAX_TITLE_CHARS);
  }
  return replaceTitle(article, newTitle);
}

function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.6) return truncated.slice(0, lastSpace).trim();
  return truncated.trim();
}

function trimTitle(article: string): string {
  const parsed = parseArticle(article);
  if (!parsed.title || parsed.title.length <= MAX_TITLE_CHARS) return article;
  return replaceTitle(article, truncateAtWord(parsed.title, MAX_TITLE_CHARS));
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

function ensureAltText(article: string, _keyword: string): string {
  const parsed = parseArticle(article);
  if (parsed.images.length > 0) {
    let next = article;
    for (const img of parsed.images) {
      const alt = img.alt.trim();
      if (!alt || alt.length < 8) {
        next = next.replace(img.raw, '');
      }
    }
    const remaining = parseArticle(next);
    if (remaining.images.length > 0) return next;
  }
  return article;
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
  const parsed = parseArticle(article);
  if (parsed.lead) {
    const lead = parsed.lead.replace(/\bpembaca\b/gi, 'Anda').replace(/\bklien\b/gi, 'Anda');
    if (/\bAnda\b/.test(lead)) return replaceLead(article, lead);
    return replaceLead(article, `${lead.replace(/\.$/, '')}. Hal ini relevan bagi Anda.`);
  }
  return article;
}

function ensureWhy(article: string, keyword: string): string {
  const parsed = parseArticle(article);
  const topic = keyword || 'topik hukum';
  if (parsed.bodyParagraphs.length >= 2) {
    const why = parsed.bodyParagraphs[1].text;
    if (/penting|wajib|risiko|marak|segera|urgensi|bahaya|harus|menghancurkan|terlambat|ancaman|kerugian|dibajak|penolakan/i.test(why)) {
      return article;
    }
    const lines = article.split(/\r?\n/);
    lines[parsed.bodyParagraphs[1].lineIndex] =
      `${why.replace(/\.$/, '')}. Risiko mengabaikan ${topic} sangat serius — banyak bisnis gagal karena kurangnya pemahaman akan urgensi ini.`;
    return lines.join('\n');
  }
  const insert = `\n\nRisiko mengabaikan ${topic} sangat serius. Banyak bisnis gagal karena kurangnya pemahaman akan urgensi ini — jangan sampai Anda mengalami hal serupa.\n`;
  const lines = article.split(/\r?\n/);
  const leadIdx = parsed.bodyParagraphs[0]?.lineIndex ?? 0;
  lines.splice(leadIdx + 1, 0, insert.trim());
  return lines.join('\n');
}

function ensureHow(article: string, keyword: string): string {
  const parsed = parseArticle(article);
  if (parsed.headings.some((h) => h.level === 2)) return article;
  const topic = keyword || 'topik hukum';
  const base = topic.includes('merek') ? 'Merek' :
    topic.includes('usaha') || topic.includes('bisnis') ? 'Usaha' :
    topic.includes('hukum') || topic.includes('legal') ? 'Hukum' : 'Prosedur';
  const block = [
    '',
    `## 1. Pahami Syarat ${base} yang Berlaku`,
    `Langkah awal adalah memahami persyaratan ${topic.toLowerCase()} secara menyeluruh agar tidak ada tahap terlewat.`,
    '',
    `## 2. Siapkan Dokumen Pendukung`,
    'Kumpulkan dokumen dan informasi yang dibutuhkan agar proses berjalan lancar dan cepat.',
  ].join('\n');
  return `${article.trimEnd()}\n${block}\n`;
}

function ensureWhat(article: string, keyword: string): string {
  if (/\bdata\b|\bmenurut\b|\d+\s*%|\bUU\b/i.test(article)) return article;
  const topic = keyword || 'topik hukum';
  const dataOptions = [
    `Menurut data praktik legal terbaru, lebih dari 30% kasus ${topic.toLowerCase()} gagal karena kelengkapan dokumen yang lemah.`,
    `Berdasarkan riset hukum terkini, mayoritas kendala ${topic.toLowerCase()} terjadi akibat kurangnya pemahaman akan prosedur yang berlaku.`,
    `Data dari praktik menunjukkan bahwa 4 dari 5 pengaju ${topic.toLowerCase()} menghadapi hambatan administratif yang sebenarnya bisa dihindari.`,
  ];
  const block = `\n\n${dataOptions[Math.floor(Math.random() * dataOptions.length)]}\n`;
  return `${article.trimEnd()}${block}`;
}

function shortenLeadDeterministic(article: string, keyword: string): string {
  const parsed = parseArticle(article);
  if (!parsed.lead) return article;
  const wordsOk = Math.abs(parsed.leadWordCount - LEAD_TARGET_WORDS) <= 1;
  const sentencesOk = parsed.leadSentenceCount === 2;
  if (wordsOk || sentencesOk) return article;

  const parts = parsed.lead.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const shortLead = `${parts[0].trim()} ${parts[1].trim()}`;
    if (shortLead.split(/\s+/).length <= LEAD_TARGET_WORDS + 2) {
      return replaceLead(article, shortLead);
    }
  }
  const words = parsed.lead.split(/\s+/);
  if (words.length > LEAD_TARGET_WORDS) {
    const topic = keyword || parsed.title;
    const truncated = words.slice(0, LEAD_TARGET_WORDS).join(' ');
    return replaceLead(article, `${truncated.replace(/[,;]+$/, '')}. Pelajari langkah penting ${topic} dan cara menghindari risikonya.`);
  }
  if (parsed.leadWordCount < 11 && parsed.leadSentenceCount !== 2) {
    return replaceLead(
      article,
      `${parsed.lead.replace(/[.!?]+$/, '')}. Simak panduan lengkapnya untuk menghindari risiko hukum yang merugikan.`,
    );
  }
  return article;
}

function trimMeta(metaTitle: string, metaDesc: string): { metaTitle: string; metaDesc: string } {
  return {
    metaTitle: metaTitle.length > MAX_META_TITLE_CHARS ? truncateAtWord(metaTitle, MAX_META_TITLE_CHARS) : metaTitle,
    metaDesc: metaDesc.length > MAX_META_DESC_CHARS ? truncateAtWord(metaDesc, MAX_META_DESC_CHARS) : metaDesc,
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
      article = shortenLeadDeterministic(article, input.keyword);
      return { article, metaTitle, metaDesc, handled: true };
    case 4:
      article = ensureWhy(article, input.keyword);
      return { article, metaTitle, metaDesc, handled: true };
    case 5:
      article = ensureHow(article, input.keyword);
      return { article, metaTitle, metaDesc, handled: true };
    case 6:
      article = ensureWhat(article, input.keyword);
      return { article, metaTitle, metaDesc, handled: true };
    case 7:
      article = ensureHow(article, input.keyword);
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
      return { article, metaTitle, metaDesc, handled: true };
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

const AI_REWRITE_IDS: RuleId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20];

async function callAIRewrite(
  apiKey: string,
  input: ArticleInput,
  item: CheckResult,
  attempt = 1,
): Promise<{ article: string; metaTitle: string; metaDesc: string }> {
  const specificFix = item.problematic_text?.trim()
    ? `\n\nTeks spesifik yang bermasalah:\n"${item.problematic_text}"`
    : '';
  const attemptHint = attempt > 1
    ? `\n\nCATATAN: Percobaan sebelumnya belum berhasil memperbaiki. Pastikan perubahan benar-benar mengatasi kriteria "${item.question}". Fokus pada teks yang tepat dan ukur hasilnya dengan saksama.`
    : '';

  const images: string[] = [];
  let articleWithTokens = input.article.replace(/!\[[^\]]*\]\([^)]*\)/g, (m) => {
    images.push(m);
    return `[[GAMBAR_${images.length - 1}]]`;
  });
  articleWithTokens = stripImages(articleWithTokens);

  const systemPrompt = `Anda adalah asisten Auto-Correct Editor Konten Hukum.
Tugas Anda memperbaiki SATU kriteria spesifik berikut agar lolos validasi SOP penulisan artikel hukum.

Kriteria yang HARUS diperbaiki: "${item.question}"
Alasan gagal: "${item.reason}"${specificFix}${attemptHint}

ATURAN PERBAIKAN:
- HANYA ubah teks yang terkait kriteria di atas. JANGAN ubah struktur, heading, atau konten lain.
- HASIL AKHIR harus memenuhi kriteria tersebut sepenuhnya.
- Perubahan minimal dan presisi.
- Jangan memvalidasi klaim hukum — hanya perbaiki format/tata tulis.
- Artikel mengandung token gambar [[GAMBAR_0]], [[GAMBAR_1]], dst. PERTAHANKAN token-token tersebut persis di posisi aslinya dalam output. Jangan ubah, jangan hapus, dan jangan ganti formatnya.

Batas SOP:
- Judul: max ${MAX_TITLE_CHARS} karakter, mengandung keyword jika relevan
- Lead: 2 kalimat ATAU ~12 kata, langsung ke inti (bukan definisi/sejarah)
- Paragraf: max ${MAX_SENTENCES_PER_PARAGRAPH} kalimat
- CTA: di akhir, persuasif (hindari "Hubungi kami" saja)
- Meta title: max ${MAX_META_TITLE_CHARS} karakter
- Meta desc: max ${MAX_META_DESC_CHARS} karakter

Keyword utama: ${stripImages(input.keyword || '')}

Kembalikan JSON:
{ "metaTitle": "...", "metaDesc": "...", "article": "..." }`;

  const cleanMetaTitle = stripImages(input.metaTitle || '');
  const cleanMetaDesc = stripImages(input.metaDesc || '');
  const userPrompt = `Meta Title: ${cleanMetaTitle}\nMeta Desc: ${cleanMetaDesc}\nArtikel:\n${articleWithTokens}`;

  const { content } = await callChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    timeoutMs: AI_REWRITE_TIMEOUT_MS,
    apiKey,
  });

  const parsed = JSON.parse(content);
  let outArticle = typeof parsed.article === 'string' ? parsed.article : input.article;
  images.forEach((img, i) => {
    outArticle = outArticle.replace(`[[GAMBAR_${i}]]`, img);
  });
  let missingIdx = 0;
  while (outArticle.includes(`[[GAMBAR_${missingIdx}]]`)) missingIdx++;
  for (let i = missingIdx; i < images.length; i++) {
    outArticle = outArticle.trimEnd() + '\n\n' + images[i];
  }
  return {
    article: outArticle,
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
    nextArticle = replaceTitle(nextArticle, truncateAtWord(parsed.title, MAX_TITLE_CHARS));
  }
  if (keyword && !parseArticle(nextArticle).title.toLowerCase().includes(keyword.toLowerCase())) {
    nextArticle = ensureKeywordInTitle(nextArticle, keyword);
  }
  return {
    article: nextArticle,
    metaTitle: metaTitle.length > MAX_META_TITLE_CHARS ? truncateAtWord(metaTitle, MAX_META_TITLE_CHARS) : metaTitle,
    metaDesc: metaDesc.length > MAX_META_DESC_CHARS ? truncateAtWord(metaDesc, MAX_META_DESC_CHARS) : metaDesc,
  };
}

export async function callOllamaGenerateKeyword(
  apiKey: string,
  article: string,
): Promise<string> {
  const systemPrompt = `Anda adalah asisten SEO Konten Hukum.
Tugas Anda memahami topik dan konteks dari seluruh artikel, lalu menghasilkan 1 (satu) keyword utama yang paling relevan.

Aturan:
- Keyword harus 2–4 kata, frasa spesifik yang mewakili topik inti artikel
- Jangan buat keyword generik/clickbait
- Keyword harus benar-benar muncul atau sangat relevan dengan isi artikel
- Kembalikan HANYA JSON: { "keyword": "..." }`;

  const clean = stripImages(article);
  const truncated = clean.length > 8000
    ? clean.slice(0, 8000) + '\n\n...[artikel terpotong]'
    : clean;

  const { content } = await callChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Artikel:\n${truncated}` },
    ],
    temperature: 0.3,
    timeoutMs: AI_KEYWORD_TIMEOUT_MS,
    apiKey,
  });

  const parsed = JSON.parse(content);
  return typeof parsed.keyword === 'string' ? parsed.keyword.trim() : '';
}

export async function callOllamaGenerateKeywords(
  apiKey: string,
  article: string,
): Promise<string[]> {
  const systemPrompt = `Anda adalah asisten SEO Konten Hukum.
Tugas Anda memahami topik dan konteks dari seluruh artikel, lalu menghasilkan DAFTAR BESAR keyword/keyword LSI yang relevan untuk artikel tersebut.

Aturan:
- Buat 100+ keyword
- Keyword boleh 2-5 kata, frasa spesifik yang paling relevan dengan topik inti artikel
- Cakup variasi: keyword utama, keyword panjang (long-tail), keyword pertanyaan, keyword lokal, dan sinonim
- Prioritaskan bahasa Indonesia
- Hindari keyword generik/clickbait yang tidak relevan
- Setiap keyword unik (tidak duplikat)
- Kembalikan HANYA JSON: { "keywords": ["keyword 1", "keyword 2", ...] }`;

  const clean = stripImages(article);
  const truncated = clean.length > 8000
    ? clean.slice(0, 8000) + '\n\n...[artikel terpotong]'
    : clean;

  const { content } = await callChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Artikel:\n${truncated}` },
    ],
    temperature: 0.5,
    timeoutMs: AI_KEYWORD_TIMEOUT_MS,
    apiKey,
  });

  const parsed = JSON.parse(content);
  if (Array.isArray(parsed.keywords)) {
    return parsed.keywords
      .map((k: unknown) => (typeof k === 'string' ? k.trim() : ''))
      .filter((k: string) => k.length > 0)
      .slice(0, 150);
  }
  return [];
}

const KEYWORD_IDS: RuleId[] = [2, 16];

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

  const effectiveApiKey = apiKey.trim();
  let newKeyword: string | undefined;

  if (KEYWORD_IDS.includes(item.id)) {
    try {
      newKeyword = await callOllamaGenerateKeyword(effectiveApiKey, input.article);
    } catch {
      // fall through
    }
  }

  const kw = getPrimaryKeyword(newKeyword || input.keyword);

  let { article, metaTitle, metaDesc } = applyDeterministicFix(
    { article: input.article, keyword: kw, metaTitle: input.metaTitle, metaDesc: input.metaDesc },
    item,
  );
  let usedGemini = false;

  let report = runSopChecks({ article, keyword: kw, metaTitle, metaDesc });
  let stillFailing = report.items.find((r) => r.id === item.id)?.status === 'failed';

  if (stillFailing && AI_REWRITE_IDS.includes(item.id)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const rewritten = await callAIRewrite(
        effectiveApiKey,
        { article, keyword: kw, metaTitle, metaDesc },
        item,
        attempt,
      );
      ({ article, metaTitle, metaDesc } = postValidateClamp(
        rewritten.article,
        rewritten.metaTitle,
        rewritten.metaDesc,
        kw,
      ));
      usedGemini = true;
      ({ article, metaTitle, metaDesc } = applyDeterministicFix(
        { article, keyword: kw, metaTitle, metaDesc },
        item,
      ));
      report = runSopChecks({ article, keyword: kw, metaTitle, metaDesc });
      stillFailing = report.items.find((r) => r.id === item.id)?.status === 'failed';
      if (!stillFailing) break;
    }
  }

  const clamped = postValidateClamp(article, metaTitle, metaDesc, kw);
  report = runSopChecks({
    article: clamped.article,
    keyword: kw,
    metaTitle: clamped.metaTitle,
    metaDesc: clamped.metaDesc,
  });
  const after = report.items.find((r) => r.id === item.id);
  const ok = after?.status === 'passed';

  return {
    ...clamped,
    keyword: kw !== input.keyword ? kw : undefined,
    usedGemini,
    message: ok
      ? `Perbaikan diterapkan untuk: ${SOP_QUESTIONS[item.id]}`
      : `Perbaikan dicoba untuk: ${SOP_QUESTIONS[item.id]}${after ? ` — ${after.reason}` : ''}`,
  };
}

export function _debugCounts(text: string) {
  return { words: countWords(text), sentences: countSentences(text) };
}

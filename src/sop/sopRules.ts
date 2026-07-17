import {
  CTA_KEYWORDS,
  FORBIDDEN_REGULATIONS,
  HOW_KEYWORDS,
  LEAD_TARGET_SENTENCES,
  LEAD_TARGET_WORDS,
  LEAD_WORD_TOLERANCE,
  MAX_KEYWORD_DENSITY,
  MAX_META_DESC_CHARS,
  MAX_META_TITLE_CHARS,
  MAX_PARAGRAPH_WORDS,
  MAX_SENTENCES_PER_PARAGRAPH,
  MAX_SENTENCE_WORDS,
  MAX_TITLE_CHARS,
  MIN_INTERNAL_LINKS,
  MIN_KEYWORD_DENSITY,
  MIN_SUGGESTED_POSTS,
  POWER_WORDS,
  REGULATION_PATTERNS,
  SOP_QUESTIONS,
  STRONG_TITLE_WORDS,
  TARGET_WORD_MAX,
  TARGET_WORD_MIN,
  URGENCY_KEYWORDS,
  WEAK_CTA_EXACT,
  WEAK_TITLE_WORDS,
  WEAK_WORDS,
  WHAT_KEYWORDS,
} from './constants';
import { parseArticle } from './parser';
import { calculateSopScore } from './scoring';
import type { ArticleInput, CheckResult, ParsedArticle, RuleId, SopReport } from './types';

function result(
  id: RuleId,
  status: CheckResult['status'],
  reason: string,
  problematic_text = '',
): CheckResult {
  return {
    id,
    question: SOP_QUESTIONS[id],
    status,
    passed: status === 'passed' || status === 'deferred',
    reason,
    problematic_text,
  };
}

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => {
    const needle = n.toLowerCase();
    if (needle.includes(' ')) return lower.includes(needle);
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
  });
}

export function getPrimaryKeyword(keyword: string): string {
  return keyword.split(',').map((k) => k.trim()).filter(Boolean)[0] || '';
}

function containsUrgency(text: string): boolean {
  if (!containsAny(text, URGENCY_KEYWORDS)) return false;
  // Ignore negated phrasing like "tanpa urgensi" / "tidak penting"
  const negated =
    /\b(tanpa|tidak|bukan)\s+(penting|wajib|risiko|urgensi|bahaya|ancaman)\b/i.test(text);
  if (!negated) return true;
  // Still pass if another positive urgency signal remains
  const stripped = text
    .replace(/\b(tanpa|tidak|bukan)\s+(penting|wajib|risiko|urgensi|bahaya|ancaman)\b/gi, ' ')
    .trim();
  return containsAny(stripped, URGENCY_KEYWORDS);
}

function checkTitleClarity(parsed: ParsedArticle): CheckResult {
  if (!parsed.title.trim()) {
    return result(1, 'failed', 'Judul tidak ditemukan. Gunakan heading # atau baris pertama sebagai judul.', '');
  }
  if (parsed.title.length > MAX_TITLE_CHARS) {
    return result(
      1,
      'failed',
      `Judul melebihi ${MAX_TITLE_CHARS} karakter (${parsed.title.length} karakter).`,
      parsed.title,
    );
  }
  if (parsed.title.length < 8) {
    return result(1, 'failed', 'Judul terlalu pendek untuk dianggap jelas dan menarik.', parsed.title);
  }

  const lower = parsed.title.toLowerCase();
  const startsWeak = WEAK_TITLE_WORDS.some((w) => lower.startsWith(w));
  if (startsWeak) {
    return result(
      1,
      'failed',
      'Judul terlalu umum dan tidak menarik. Gunakan formulasi manfaat/langkah yang tegas, bukan pengantar umum seperti "Pembahasan Mengenai...".',
      parsed.title,
    );
  }

  const hasNumber = /\d/.test(parsed.title);
  const hasStrongSignal = STRONG_TITLE_WORDS.some((w) => lower.includes(w));
  if (!hasNumber && !hasStrongSignal) {
    return result(
      1,
      'failed',
      'Judul belum menunjukkan manfaat atau langkah spesifik. Tambahkan angka, kata "cara", "tips", "manfaat", "risiko", atau ajakan konkret agar pembaca tertarik.',
      parsed.title,
    );
  }

  return result(
    1,
    'passed',
    `Judul padat, menarik, dan dalam batas ${MAX_TITLE_CHARS} karakter.`,
    '',
  );
}

function checkKeywordInTitle(parsed: ParsedArticle, keyword: string): CheckResult {
  const kw = getPrimaryKeyword(keyword).toLowerCase();
  if (!kw) {
    return result(2, 'failed', 'Keyword utama belum diisi.', '');
  }
  if (!parsed.title.toLowerCase().includes(kw)) {
    return result(2, 'failed', `Keyword "${keyword}" tidak ditemukan di judul.`, parsed.title);
  }
  return result(2, 'passed', 'Keyword utama sudah ada di judul.', '');
}

function checkLead(parsed: ParsedArticle): CheckResult {
  if (!parsed.lead.trim()) {
    return result(3, 'failed', 'Kalimat pembuka (lead) tidak ditemukan setelah judul. Tambahkan 2 kalimat singkat yang langsung masuk ke inti masalah.', parsed.title);
  }
  const wordsOk =
    Math.abs(parsed.leadWordCount - LEAD_TARGET_WORDS) <= LEAD_WORD_TOLERANCE;
  const sentencesOk = parsed.leadSentenceCount === LEAD_TARGET_SENTENCES;
  if (wordsOk || sentencesOk) {
    return result(
      3,
      'passed',
      `Lead memenuhi kriteria (${parsed.leadSentenceCount} kalimat / ${parsed.leadWordCount} kata).`,
      '',
    );
  }
  return result(
    3,
    'failed',
    `Lead harus 2 kalimat atau sekitar 12 kata. Saat ini ${parsed.leadSentenceCount} kalimat / ${parsed.leadWordCount} kata.`,
    parsed.lead,
  );
}

function checkWhy(parsed: ParsedArticle): CheckResult {
  // Paragraph after lead = intro WHY
  const body = parsed.bodyParagraphs;
  if (body.length < 2) {
    return result(4, 'failed', 'Paragraf pembuka (WHY) setelah lead belum ada. Jelaskan mengapa pembaca harus peduli pada masalah ini.', parsed.bodyParagraphs[0]?.text ?? parsed.lead ?? parsed.title);
  }
  const why = body[1];
  if (!containsUrgency(why.text)) {
    return result(
      4,
      'failed',
      'Paragraf WHY belum menunjukkan urgensi/kenapa masalah ini penting. Gunakan kata seperti risiko, bahaya, kerugian, atau sebelum terlambat.',
      why.text,
    );
  }
  return result(4, 'passed', 'Paragraf WHY memuat sinyal urgensi masalah.', '');
}

function checkHow(parsed: ParsedArticle): CheckResult {
  const h2 = parsed.headings.filter((h) => h.level === 2);
  if (h2.length === 0) {
    return result(5, 'failed', 'Belum ada subjudul H2 untuk bagian prosedur (HOW). Tambahkan H2 seperti "Langkah-langkah..." atau "Cara Mengajukan...".', parsed.title);
  }
  const hasHowSignal =
    containsAny(parsed.textContent, HOW_KEYWORDS) ||
    h2.some((h) => /\d+\./.test(h.text) || containsAny(h.text, HOW_KEYWORDS));
  if (!hasHowSignal) {
    return result(
      5,
      'failed',
      'Bagian HOW belum menunjukkan langkah/prosedur yang jelas. Tambahkan urutan langkah atau penjelasan cara mengatasi masalah.',
      h2[0]?.text ?? '',
    );
  }
  return result(5, 'passed', 'Bagian HOW memiliki H2 dan indikator prosedur.', '');
}

function checkWhat(parsed: ParsedArticle): CheckResult {
  const hasData =
    containsAny(parsed.textContent, WHAT_KEYWORDS) ||
    /\d+\s*%/.test(parsed.textContent) ||
    /\b\d{2,}\b/.test(parsed.textContent);
  if (!hasData) {
    return result(
      6,
      'failed',
      'Bagian pendukung (WHAT) belum memuat data, fakta, atau pandangan ahli. Tambahkan angka, persen, kutipan, atau dasar hukum.',
      parsed.bodyParagraphs[1]?.text ?? parsed.bodyParagraphs[0]?.text ?? parsed.lead ?? parsed.title,
    );
  }
  return result(6, 'passed', 'Ditemukan indikasi data/fakta/dukungan di artikel.', '');
}

function checkHeadingHierarchy(parsed: ParsedArticle): CheckResult {
  const h2 = parsed.headings.filter((h) => h.level === 2);
  const h3 = parsed.headings.filter((h) => h.level === 3);
  if (h2.length === 0) {
    return result(7, 'failed', 'Struktur heading belum rapi: minimal butuh 1 subjudul H2 untuk membagi artikel.', parsed.title);
  }
  let seenH2 = false;
  for (const h of parsed.headings) {
    if (h.level === 2) seenH2 = true;
    if (h.level === 3 && !seenH2) {
      return result(
        7,
        'failed',
        'Subjudul H3 muncul sebelum H2. Pastikan urutannya H2 dulu, baru H3.',
        h.text,
      );
    }
  }
  if (h3.length > 0 && h2.length === 0) {
    return result(7, 'failed', 'Ada H3 tanpa H2. Tambahkan H2 terlebih dahulu.', h3[0].text);
  }
  return result(7, 'passed', `Hirarki heading rapi (${h2.length} H2, ${h3.length} H3).`, '');
}

function checkParagraphLength(parsed: ParsedArticle): CheckResult {
  const offenders = parsed.bodyParagraphs.filter(
    (p) => p.sentenceCount > MAX_SENTENCES_PER_PARAGRAPH || p.wordCount > MAX_PARAGRAPH_WORDS,
  );
  if (offenders.length > 0) {
    const worst = offenders.reduce((a, b) => {
      const scoreA = a.sentenceCount + a.wordCount / 10;
      const scoreB = b.sentenceCount + b.wordCount / 10;
      return scoreA >= scoreB ? a : b;
    });
    return result(
      8,
      'failed',
      `${offenders.length} paragraf terlalu panjang (tertinggi ${worst.sentenceCount} kalimat / ${worst.wordCount} kata). Batas ideal maksimal ${MAX_SENTENCES_PER_PARAGRAPH} kalimat atau ${MAX_PARAGRAPH_WORDS} kata.`,
      worst.text,
    );
  }
  return result(8, 'passed', 'Semua paragraf mematuhi batas kalimat dan jumlah kata.', '');
}

function checkLanguage(parsed: ParsedArticle): CheckResult {
  if (!/\bAnda\b/.test(parsed.textContent)) {
    return result(
      9,
      'failed',
      'Gaya bahasa terlalu formal/jarak. Gunakan kata ganti "Anda" untuk berbicara langsung dengan pembaca, misalnya "Anda perlu tahu bahwa..."',
      parsed.lead || parsed.bodyParagraphs[0]?.text || parsed.title,
    );
  }
  return result(9, 'passed', 'Artikel menggunakan sapaan "Anda" untuk pembaca.', '');
}

function checkCta(parsed: ParsedArticle): CheckResult {
  const candidates = parsed.bodyParagraphs.slice(-2);
  if (candidates.length === 0) {
    return result(10, 'failed', 'Tidak ada paragraf penutup untuk CTA.', '');
  }
  const ctaPara = [...candidates].reverse().find((p) => containsAny(p.text, CTA_KEYWORDS));
  if (!ctaPara) {
    return result(
      10,
      'failed',
      'CTA belum ditemukan di bagian akhir artikel.',
      candidates[candidates.length - 1]?.text ?? '',
    );
  }
  const normalized = ctaPara.text.trim().toLowerCase();
  if (WEAK_CTA_EXACT.includes(normalized) || ctaPara.wordCount < 5) {
    return result(
      10,
      'failed',
      'CTA terlalu lemah/singkat. Gunakan ajakan persuasif (contoh: konsultasikan dengan tim legal).',
      ctaPara.text,
    );
  }
  return result(10, 'passed', 'CTA di akhir artikel sudah relevan dan persuasif.', '');
}

function checkTypos(parsed: ParsedArticle): CheckResult {
  const issues: string[] = [];
  if (/ {2,}/.test(parsed.raw)) {
    issues.push('spasi ganda');
  }
  if (/,{2,}/.test(parsed.raw) || /\?{2,}/.test(parsed.raw) || /!{2,}/.test(parsed.raw)) {
    issues.push('tanda baca berulang');
  }
  if (/(?<!\.)\.\.(?!\.)/.test(parsed.raw)) {
    issues.push('titik ganda');
  }

  const badLine = parsed.lines.find(
    (l) =>
      / {2,}/.test(l) ||
      /,{2,}|\?{2,}|!{2,}|(?<!\.)\.\.(?!\.)/.test(l),
  );
  if (issues.length > 0) {
    return result(
      11,
      'failed',
      `Ditemukan masalah format/teks: ${issues.join(', ')}. Periksa kembali spasi dan tanda baca.`,
      badLine?.trim() ?? parsed.lines.find((l) => l.trim().length > 0) ?? '',
    );
  }
  return result(11, 'passed', 'Tidak ada indikasi typo format ringan.', '');
}

function checkRegulation(parsed: ParsedArticle): CheckResult {
  const found: string[] = [];
  for (const pattern of REGULATION_PATTERNS) {
    const matches = parsed.textContent.match(pattern);
    if (matches) found.push(...matches);
  }

  if (found.length === 0) {
    return result(
      12,
      'failed',
      'Belum ada dasar hukum seperti "UU No. 20 Tahun 2016" atau peraturan terkini. Tambahkan regulasi yang masih berlaku untuk memperkuat argumen.',
      parsed.lead || parsed.bodyParagraphs[0]?.text || parsed.title,
    );
  }

  const forbidden = found.find((ref) =>
    FORBIDDEN_REGULATIONS.some((f) => ref.toLowerCase().includes(f)),
  );
  if (forbidden) {
    return result(
      12,
      'failed',
      `Regulasi yang dirujuk tidak boleh digunakan: ${forbidden}. Periksa kembali aturan yang masih berlaku.`,
      forbidden,
    );
  }

  return result(
    12,
    'passed',
    `Ditemukan referensi regulasi: ${found.slice(0, 2).join(', ')}${found.length > 2 ? '...' : ''}. Pastikan masih berlaku saat publish.`,
    '',
  );
}

function checkKeywordDensity(parsed: ParsedArticle, keyword: string): CheckResult {
  const kw = getPrimaryKeyword(keyword).toLowerCase();
  if (!kw || parsed.wordCount === 0) {
    return result(
      16,
      'failed',
      'Keyword utama belum diisi. Isi keyword dulu agar bisa dicek penyebarannya di artikel.',
      parsed.title,
    );
  }

  const density = (parsed.textContent.toLowerCase().split(kw).length - 1) / (parsed.wordCount / 100);
  const leadHasKw = parsed.lead.toLowerCase().includes(kw);
  const headingsWithKw = parsed.headings.filter((h) => h.text.toLowerCase().includes(kw)).length;

  if (density < MIN_KEYWORD_DENSITY) {
    return result(
      16,
      'failed',
      `Keyword "${keyword}" terlalu jarang muncul (${density.toFixed(2)}%). Idealnya ${MIN_KEYWORD_DENSITY}-${MAX_KEYWORD_DENSITY}%. Sebarkan di beberapa paragraf secara alami.`,
      parsed.lead || parsed.title,
    );
  }
  if (density > MAX_KEYWORD_DENSITY) {
    return result(
      16,
      'failed',
      `Keyword "${keyword}" terlalu sering muncul (${density.toFixed(2)}%), risiko terlihat seperti spam. Kurangi dan gunakan sinonim.`,
      parsed.lead || parsed.title,
    );
  }
  if (!leadHasKw) {
    return result(
      16,
      'failed',
      `Keyword "${keyword}" belum muncul di lead. Sebaiknya kalimat pembuka mengandung keyword agar pembaca langsung paham topik.`,
      parsed.lead,
    );
  }
  if (headingsWithKw === 0) {
    return result(
      16,
      'failed',
      `Keyword "${keyword}" belum muncul di subjudul H2/H3. Tambahkan di salah satu heading untuk memperkuat fokus artikel.`,
      parsed.headings[0]?.text ?? parsed.title,
    );
  }

  return result(
    16,
    'passed',
    `Keyword "${keyword}" memiliki densitas ${density.toFixed(2)}% dan sudah muncul di judul, lead, dan ${headingsWithKw} heading.`,
    '',
  );
}

function checkSentenceLength(parsed: ParsedArticle): CheckResult {
  const longSentences = parsed.bodyParagraphs
    .flatMap((p) =>
      p.text
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => ({ text: s, words: s.split(/\s+/).length })),
    )
    .filter((s) => s.words > MAX_SENTENCE_WORDS);

  if (longSentences.length > 0) {
    const worst = longSentences.reduce((a, b) => (a.words >= b.words ? a : b));
    return result(
      17,
      'failed',
      `${longSentences.length} kalimat melebihi ${MAX_SENTENCE_WORDS} kata (terpanjang ${worst.words} kata). Pecah kalimat panjang agar lebih mudah dibaca.`,
      worst.text,
    );
  }
  return result(
    17,
    'passed',
    `Semua kalimat dalam batas ${MAX_SENTENCE_WORDS} kata.`,
    '',
  );
}

function checkHeadingQuality(parsed: ParsedArticle, keyword: string): CheckResult {
  const h2 = parsed.headings.filter((h) => h.level === 2);
  if (h2.length === 0) {
    return result(18, 'failed', 'Belum ada subheading H2. Tambahkan H2 untuk membagi topik.', '');
  }

  const kw = getPrimaryKeyword(keyword).toLowerCase();
  const weak = h2.find((h) => {
    const t = h.text.toLowerCase();
    return t.length < 8 || /^\d+\.?\s*$/i.test(t) || t.split(/\s+/).length < 2;
  });
  if (weak) {
    return result(
      18,
      'failed',
      'Ada subheading H2 yang terlalu pendek atau tidak deskriptif. Buat subheading yang menjelaskan isi bagian.',
      weak.text,
    );
  }

  if (kw && !h2.some((h) => h.text.toLowerCase().includes(kw))) {
    return result(
      18,
      'failed',
      `Keyword "${keyword}" belum muncul di subheading H2. Tambahkan keyword pada H2 untuk fokus SEO yang lebih kuat.`,
      h2[0].text,
    );
  }

  return result(
    18,
    'passed',
    `${h2.length} subheading H2 cukup deskriptif dan relevan dengan topik.`,
    '',
  );
}

function checkWeakWords(parsed: ParsedArticle): CheckResult {
  const lower = parsed.textContent.toLowerCase();
  const found = WEAK_WORDS.filter((w) => lower.includes(w));
  const power = POWER_WORDS.filter((w) => lower.includes(w));

  if (found.length > 0) {
    const firstWeak = found[0];
    const sentence = parsed.bodyParagraphs
      .flatMap((p) => p.text.split(/[.!?]+/))
      .find((s) => s.toLowerCase().includes(firstWeak));
    return result(
      19,
      'failed',
      `Ditemukan kata lemah yang membuat argumen terasa ragu-ragu: "${found.join(', ')}". Ganti dengan kata yang lebih tegas dan meyakinkan.`,
      sentence?.trim() || firstWeak,
    );
  }
  if (power.length < 2) {
    return result(
      19,
      'failed',
      'Artikel kurang memiliki kata kuat/persuasif. Tambahkan istilah seperti wajib, risiko, sanksi, atau lindungi untuk memperkuat pesan.',
      parsed.bodyParagraphs[0]?.text || parsed.lead || parsed.title,
    );
  }
  return result(
    19,
    'passed',
    `Tidak ditemukan kata lemah dan terdapat ${power.length} kata kuat/persuasif.`,
    '',
  );
}

function checkWordCount(parsed: ParsedArticle): CheckResult {
  if (parsed.wordCount < TARGET_WORD_MIN) {
    return result(
      20,
      'failed',
      `Jumlah kata (${parsed.wordCount}) kurang dari target minimum ${TARGET_WORD_MIN} kata. Tambahkan penjelasan atau contoh kasus.`,
      '',
    );
  }
  if (parsed.wordCount > TARGET_WORD_MAX) {
    return result(
      20,
      'failed',
      `Jumlah kata (${parsed.wordCount}) melebihi target maksimum ${TARGET_WORD_MAX} kata. Pertimbangkan memangkas bagian yang kurang esensial.`,
      '',
    );
  }
  return result(
    20,
    'passed',
    `Jumlah kata ${parsed.wordCount} berada dalam target ${TARGET_WORD_MIN}-${TARGET_WORD_MAX} kata.`,
    '',
  );
}

function checkLinks(parsed: ParsedArticle): CheckResult {
  const contentLinks = parsed.links.filter((l) => !l.isImage);
  const suggestedSection = parsed.lines.findIndex((line) =>
    /baca juga|suggested|artikel terkait|internal link/i.test(line),
  );

  let suggestedCount = 0;
  if (suggestedSection >= 0) {
    for (let i = suggestedSection; i < Math.min(suggestedSection + 8, parsed.lines.length); i++) {
      const matches = parsed.lines[i].match(/\[[^\]]+]\([^)]*\)/g);
      if (matches) suggestedCount += matches.length;
    }
  }

  const contextualLinks = contentLinks.length;
  const internalOk = contextualLinks >= MIN_INTERNAL_LINKS;
  const suggestedOk = suggestedCount >= MIN_SUGGESTED_POSTS;

  if (!internalOk || !suggestedOk) {
    const snippet =
      suggestedSection >= 0
        ? parsed.lines[suggestedSection].trim()
        : contentLinks[0]?.raw ?? '';
    return result(
      13,
      'failed',
      `Artikel butuh minimal ${MIN_INTERNAL_LINKS} link internal dan ${MIN_SUGGESTED_POSTS} artikel terkait. Saat ini: link internal=${contextualLinks}, artikel terkait≈${suggestedCount}.`,
      snippet || parsed.bodyParagraphs[parsed.bodyParagraphs.length - 1]?.text || parsed.title,
    );
  }
  return result(
    13,
    'passed',
    `Link internal (${contextualLinks}) dan artikel terkait (${suggestedCount}) sudah memenuhi target.`,
    '',
  );
}

function checkMeta(metaTitle: string, metaDesc: string): CheckResult {
  if (!metaTitle.trim() || !metaDesc.trim()) {
    return result(14, 'failed', 'Meta title dan/atau meta description masih kosong. Isi keduanya agar artikel siap tampil di hasil pencarian.', metaTitle || metaDesc || '');
  }
  if (metaTitle.length > MAX_META_TITLE_CHARS) {
    return result(
      14,
      'failed',
      `Meta title terlalu panjang (${metaTitle.length} karakter). Maksimal ${MAX_META_TITLE_CHARS} karakter.`,
      metaTitle,
    );
  }
  if (metaDesc.length > MAX_META_DESC_CHARS) {
    return result(
      14,
      'failed',
      `Meta description terlalu panjang (${metaDesc.length} karakter). Maksimal ${MAX_META_DESC_CHARS} karakter.`,
      metaDesc,
    );
  }
  return result(14, 'passed', 'Meta title dan description sudah terisi dengan panjang yang sesuai.', '');
}

export function runSopChecks(input: ArticleInput): SopReport {
  const parsed = parseArticle(input.article);
  const items: CheckResult[] = [
    checkTitleClarity(parsed),
    checkKeywordInTitle(parsed, input.keyword),
    checkLead(parsed),
    checkWhy(parsed),
    checkHow(parsed),
    checkWhat(parsed),
    checkHeadingHierarchy(parsed),
    checkParagraphLength(parsed),
    checkLanguage(parsed),
    checkCta(parsed),
    checkTypos(parsed),
    checkRegulation(parsed),
    checkKeywordDensity(parsed, input.keyword),
    checkSentenceLength(parsed),
    checkHeadingQuality(parsed, input.keyword),
    checkWeakWords(parsed),
    checkWordCount(parsed),
    checkLinks(parsed),
    checkMeta(input.metaTitle, input.metaDesc),
  ];
  return calculateSopScore(items, parsed.wordCount);
}

export function getParsedArticle(article: string): ParsedArticle {
  return parseArticle(article);
}

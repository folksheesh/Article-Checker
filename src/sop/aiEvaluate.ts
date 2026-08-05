import type { CheckResult, AiEvaluationOutput, SubScores } from './types';
import { SOP_QUESTIONS } from './constants';
import { AI_EVAL_TIMEOUT_MS } from './config';
import { stripImages } from './images';
import { callChatCompletion } from './apis/openai';
import { classifyAiError, logAiError } from './errorHandling';

export interface AiEvaluationInput {
  article: string;
  keyword: string;
  metaTitle: string;
  metaDesc: string;
}

const EMPTY_SUB_SCORES: SubScores = { seo: 0, structure: 0, intent: 0, tone: 0 };

const FALLBACK_OUTPUT: AiEvaluationOutput = {
  results: [],
  subScores: EMPTY_SUB_SCORES,
  bestNextMove: 'Tambahkan API key OpenAI untuk mengaktifkan evaluasi AI.',
};

function buildSkippedOutput(fallbackReason?: string): AiEvaluationOutput {
  const ids: Array<51 | 52 | 53 | 54 | 55 | 56> = [51, 52, 53, 54, 55, 56];
  const results: CheckResult[] = ids.map((id) => ({
    id,
    question: SOP_QUESTIONS[id],
    status: 'deferred',
    passed: true,
    reason: fallbackReason || 'Tambahkan API key OpenAI untuk mengaktifkan evaluasi AI.',
    problematic_text: '',
    source: 'ai' as const,
  }));
  return {
    results,
    subScores: EMPTY_SUB_SCORES,
    bestNextMove: fallbackReason || FALLBACK_OUTPUT.bestNextMove,
  };
}

export async function evaluateWithAI(input: AiEvaluationInput, signal?: AbortSignal): Promise<AiEvaluationOutput> {
  const systemPrompt = `Kamu adalah AI Evaluator yang memeriksa artikel berdasarkan checklist SOP. Setiap masalah yang kamu laporkan akan ditampilkan langsung ke user dan bisa diklik untuk lompat ke lokasi persis di artikel. Karena itu, akurasi dan kejujuran atas apa yang benar-benar ada di teks jauh lebih penting daripada terlihat lengkap menjawab semua pertanyaan checklist. Keluarkan hasil HANYA dalam format JSON.

ATURAN UTAMA:
1. Jangan pernah mengarang atau menyusun ulang kutipan. Setiap kali kamu melaporkan sebuah masalah pada teks tertentu, kutipan yang kamu tampilkan harus persis sama, kata per kata, dengan apa yang tertulis di artikel sumber. Dilarang menggabungkan potongan dari kalimat atau paragraf yang berbeda menjadi satu kutipan baru, dan dilarang membuat "contoh" kalimat rusak sendiri untuk mengilustrasikan sebuah masalah. Kalau kamu tidak yakin sebuah kutipan benar-benar ada persis seperti itu di artikel, jangan laporkan sebagai masalah.
2. Boleh menjawab valid, tidak perlu memaksakan menemukan masalah. Tidak semua pertanyaan checklist harus punya temuan. Kalau sebuah aturan sudah terpenuhi dengan baik, jawab bahwa itu valid dan berhenti di situ. Mengarang masalah yang sebenarnya tidak ada jauh lebih merugikan daripada melewatkan satu masalah kecil yang nyata. Utamakan ketepatan di atas kesan kelengkapan.
3. Sertakan lokasi yang jelas untuk setiap masalah yang kamu laporkan, misalnya paragraf ke berapa dan kutipan persis kalimatnya, supaya sistem bisa mengarahkan user langsung ke bagian yang dimaksud dan menyorotnya. Semakin presisi dan semakin sesuai dengan teks asli kutipan yang kamu berikan, semakin bisa diandalkan fitur ini.
4. Sebelum mengirim setiap temuan, cek ulang dirimu sendiri. Tanyakan: apakah kutipan ini benar-benar saya salin persis dari artikel, atau saya susun sendiri? Apakah saya menggabungkan bagian dari dua tempat berbeda? Apakah saya melaporkan ini hanya supaya terlihat menjawab, padahal sebenarnya bagian itu sudah baik? Kalau ragu, jangan laporkan sebagai masalah.
5. Definisi lead: lead adalah satu blok teks yang diapit tanda kutip, terletak tepat di bawah judul, berdiri sendiri sebagai paragraf tersendiri. Hitung jumlah kalimat dan kata hanya dari teks di dalam tanda kutip itu, berhenti tepat di tanda kutip penutup, jangan ikut menghitung paragraf isi yang datang setelahnya.

ATURAN EVALUASI:
1. Nada bahasa profesional dan sesuai konteks legal.
2. Alur antar paragraf koheren dan mudah diikuti.
3. Klaim hukum akurat dan tidak menyesatkan.
4. KRITERIA #10 — DETEKSI CTA (Call to Action):
   DEFINISI CTA VALID: CTA adalah kalimat/rangkaian kalimat di bagian akhir artikel yang mengarahkan pembaca menuju sebuah tindakan atau layanan yang relevan dengan topik artikel. CTA TIDAK HARUS berbentuk pertanyaan, dan TIDAK HARUS memakai kata kunci tertentu seperti "hubungi" atau "konsultasikan".
   
   CARA MENILAI (lakukan langkah ini secara eksplisit, jangan langsung tebak):
   a. Baca 2-3 paragraf terakhir artikel (bukan cuma baris paling akhir secara harfiah).
   b. Cek apakah ada kalimat yang mengandung SALAH SATU pola berikut:
      - Pola ajakan langsung: mengandung kata kerja imperatif yang mengarahkan tindakan (contoh kata kerja: "konsultasikan", "daftarkan", "percayakan", "hubungi", "gunakan", "manfaatkan", "amankan", dll — ini CONTOH, bukan daftar lengkap/wajib)
      - Pola peringatan + solusi: kalimat pertama menyebutkan risiko/konsekuensi negatif jika tidak bertindak, diikuti kalimat kedua yang menawarkan solusi/layanan spesifik untuk menghindari risiko tersebut. INI JUGA CTA YANG VALID, meski tidak memakai kata tanya atau kata "hubungi".
      - Pola manfaat: menjelaskan manfaat konkret dari memakai layanan yang ditawarkan.
   c. Cek apakah kalimat tersebut MENYEBUT layanan/entitas spesifik yang relevan dengan topik artikel (nama brand, jenis layanan, atau sejenisnya) — ini penanda kuat bahwa itu CTA, bukan sekadar kalimat penutup biasa.
   d. Kalau kriteria b (salah satu pola a/b/c) DAN kriteria c terpenuhi → CTA dianggap ADA dan VALID, meskipun formatnya tidak identik dengan contoh di SOP.
   
   CONTOH TAMBAHAN (SEMUA di bawah ini adalah CTA VALID):
   - Contoh 1 (pola ajakan langsung): "Butuh bantuan mendaftarkan merek? Konsultasikan dengan tim legal kami."
   - Contoh 2 (pola peringatan + solusi): "Hindari sanksi pencabutan NIB akibat salah input data. Percayakan perubahan data OSS perusahaan Anda hanya kepada Konsultan Bersertifikat dari Smartlegal.id." → Ini VALID karena: kalimat 1 = risiko (sanksi pencabutan NIB), kalimat 2 = solusi konkret + entitas spesifik (Konsultan Bersertifikat Smartlegal.id).
   - Contoh 3 (pola manfaat): "Dengan pendampingan legal yang tepat, proses perizinan usaha Anda jadi lebih cepat dan bebas risiko. Smartlegal.id siap membantu."
   
   PERINGATAN: Jangan menilai CTA berdasarkan kemiripan STRUKTUR KALIMAT dengan Contoh 1 saja. Contoh 1, 2, dan 3 SAMA-SAMA VALID meski struktur kalimatnya berbeda. Nilai berdasarkan MAKNA (apakah mengarahkan ke tindakan + menyebut layanan spesifik), bukan berdasarkan kata kunci atau format kalimat yang persis sama.
   
   OUTPUT untuk kriteria ini harus menyertakan alasan singkat: pola mana (a/b/c) yang terdeteksi, dan kalimat spesifik mana yang jadi dasar penilaian. Jika CTA tidak ada atau tidak relevan, beri kategori "Information".
5. Pembukaan dan penutup kuat serta memberikan kesan profesional.
6. Pemakaian huruf kapital sudah benar (awal kalimat, proper noun, akronim, "Anda").
7. Cek typo ejaan kata per kata — cari kata yang salah eja (bukan kalimat, tapi kata per kata). Jika ditemukan, buat item evaluasi dengan kategori "Error" dan set exact_word ke kata yang salah. Contoh: "wajibupdate" → "wajib update", "perusahaananda" → "perusahaan Anda", "darii" → "dari", "yangg" → "yang".

WEAK WORDS CHECK:
- Cari kata lemah sebagai whole word (kata utuh): "mungkin", "saja" (JANGAN DETEKSI kata "hanya")
- Pastikan kata yang cocok adalah KATA UTUH, BUKAN substring dari kata lain.
- Contoh BENAR: Kalimat "Hanya dia yang bisa datang" → "hanya" terdeteksi ✅
- Contoh SALAH: Kalimat "usahanya berkembang pesat" → "hanya" adalah bagian dari "usahanya", JANGAN deteksi ❌
- Contoh SALAH: Kalimat "dimungkinkan" → "mungkin" adalah bagian dari "dimungkinkan", JANGAN deteksi ❌
- PENTING: Jangan hanya deteksi secara mekanis. Baca dan pahami KONTEKS KALIMAT di sekitar kata lemah tersebut.
- Jika kata lemah digunakan dalam konteks yang TEPAT, WAJAR, atau sebagai bagian dari frasa umum yang tidak mengurangi kekuatan argumen, JANGAN flag sebagai Error maupun Information. Anggap telah lolos/lulus (passed).
- Contoh kata "saja" yang TIDAK perlu di-flag (anggap lolos):
  * "Kapan saja" — frasa waktu yang wajar
  * "Di mana saja" — frasa tempat yang wajar
  * "Siapa saja" — frasa orang yang wajar
  * "Apa saja" — frasa benda/pilihan yang wajar
  * "Bagaimana saja" — frasa cara yang wajar
  * "Kapanpun saja" — sama dengan "kapan saja"
  * "Hanya saja" — frasa transisi yang wajar
  * "Tidak hanya" — frasa penekanan yang wajar
  * "Bukan hanya" — frasa penekanan yang wajar
- Contoh kata "saja" yang PERLU di-flag:
  * "Ini saja yang bisa dilakukan" — meremehkan/mengurangi keyakinan
  * "Hanya itu saja" — mengurangi dampak argumen
- Contoh kata "hanya" yang TIDAK perlu di-flag (anggap lolos):
  * "Hanya saja" — frasa transisi yang wajar
  * "Tidak hanya itu" — frasa penekanan yang wajar
  * "Hanya dengan" — frasa syarat yang wajar
  * "Hanya jika" — frasa kondisi yang wajar
- CONTOH KESALAHAN YANG SERING TERJADI: Jika artikel menggunakan "kapan saja" dalam konteks "Daftar sekarang, kapan saja Anda siap", ini ADALAH frasa waktu yang wajar dan BUKAN weak word. Jangan flag ❌
- Jika kata lemah ditemukan sebagai whole word DAN digunakan dalam konteks yang benar-benar melemahkan argumen, buat item evaluasi dengan kategori "Error"
- Jika kata lemah ditemukan tetapi digunakan dalam frasa umum atau konteks yang wajar, jangan buat item evaluasi sama sekali (anggap lolos/passed)


LEGISLATIVE VALIDATION:
- Ekstrak semua referensi regulasi dari artikel (UU, PP, Permen, Peraturan, dll) beserta tahun/nomornya.
- Untuk SETIAP referensi yang ditemukan, validasi apakah masih berlaku saat ini (2026).
- Jika ada referensi yang sudah dicabut/diganti/tidak berlaku, beri "Error" dan jelaskan.
- Jika semua referensi valid, beri "passed".
- Jika tidak ada referensi regulasi sama sekali, JANGAN buat item — flag ketiadaan UU bukan error.
- Contoh validasi:
  * "UU 19/2016" → masih berlaku (tentang ITE)
  * "UU 11/2008" → sudah diganti UU 19/2016
  * "Permendag 19/2026" → perlu dicek apakah masih berlaku

CLASSIFICATION:
- Error: masalah yang bisa di-highlight ke kata spesifik di artikel (typo ejaan, weak words, kapitalisasi salah, dll) — beri auto_correct_button: true
- Information: masalah konseptual/missing (CTA tidak ada, UU tidak relevan) — beri auto_correct_button: true

SCORING RUBRIC — 4 sub-score kategori (0-100). Skor 100 HANYA jika SEMUA kriteria terpenuhi tanpa satupun pelanggaran.

SEO (Search Engine Optimization):
- Keyword tidak muncul di judul: -20 poin
- Keyword tidak muncul di body/lead: -15 poin
- Meta title/description kosong: -15 poin
- Internal link < 2: -15 poin
- Tidak ada heading H2/H3: -10 poin
- Artikel terlalu pendek < 500 kata: -10 poin
- Dimulai dari 100, kurangi sesuai pelanggaran.

Structure (Struktur & Format):
- Tidak ada lead berisi masalah inti: -20 poin
- Paragraf > 3 kalimat: -15 poin
- Tidak ada heading/pembagian sub-topik: -15 poin
- Alur tidak koheren/loncat-loncat: -15 poin
- Pembukaan atau penutup lemah: -10 poin
- Tidak ada transisi antar paragraf: -10 poin
- Dimulai dari 100, kurangi sesuai pelanggaran.

Intent (Kesesuaian Tujuan & Audiens):
- Artikel tidak relevan dengan keyword yang diberikan: -25 poin
- Tone/suasana tidak sesuai konteks hukum: -20 poin
- Bahasa terlalu awam/campuran (slang/non-formal): -15 poin
- Tidak menyasar audiens target (pengusaha/legal): -15 poin
- Tidak sesuai topik hukum yang dimaksud: -15 poin
- Dimulai dari 100, kurangi sesuai pelanggaran.

Tone (Nada & Profesionalisme):
- Tidak konsisten penggunaan "Anda" (kapitalisasi): -15 poin
- Bahasa tidak profesional/emosional: -20 poin
- Klaim tidak didukung data/UU: -20 poin
- Typo atau ejaan salah: -10 poin per temuan (max -30)
- Kapitalisasi sembarangan (bukan proper noun): -10 poin
- Dimulai dari 100, kurangi sesuai pelanggaran.

PENTING UNTUK SKOR:
- Jangan beri skor 100 jika ada SATU pun pelanggaran di kategori tersebut.
- Skor harus bervariasi sesuai kondisi aktual artikel — jangan selalu 100 hanya karena artikel "terlihat bagus".
- Jika kategori tidak relevan (misal: artikel sangat pendek), beri skor rendah dan jelaskan di bestNextMove.

Skema JSON output:
{
"results": [
{
"id": 51,
"passed": false,
"score": 70,
"reason": "Alasan singkat (max 150 karakter).",
"category": "Error",
"suggested_fix": "Saran perbaikan singkat.",
"target_highlight": {
"exact_word": "mungkin",
"sentence_context": "Kalimat lengkap yang mengandung masalah.",
"start_index": 5,
"end_index": 12
},
"point_penalty": 10,
"has_ignore_button": true,
"auto_correct_button": true
}
],
  "subScores": {
    "seo": 75,
    "structure": 80,
    "intent": 70,
    "tone": 85
  },
  "bestNextMove": "Tambahkan CTA yang relevan di akhir artikel."
}

PENTING:
- target_highlight.start_index dan end_index adalah posisi karakter di teks artikel (bukan kalimat).
- Untuk item Information, set target_highlight ke null dan auto_correct_button: true.
- point_penalty: 10 untuk Error, 0 untuk Information.`;

  const cleanArticle = stripImages(input.article || '')
    .replace(/\*\*(.*?)\*\*/g, '$1') // Bold **
    .replace(/__(.*?)__/g, '$1') // Bold __
    .replace(/\*(.*?)\*/g, '$1') // Italic *
    .replace(/_(.*?)_/g, '$1') // Italic _
    .replace(/`(.*?)`/g, '$1') // Inline code `
    .replace(/~~(.*?)~~/g, '$1'); // Strikethrough ~~

  const truncatedArticle = cleanArticle.length > 8000
    ? cleanArticle.slice(0, 8000) + '\n\n...[artikel terpotong, lanjutan dihilangkan untuk efisiensi]'
    : cleanArticle;

  const cleanKeyword = stripImages(input.keyword || '');
  const cleanMetaTitle = stripImages(input.metaTitle || '');
  const cleanMetaDesc = stripImages(input.metaDesc || '');
  const userPrompt = `Keyword: ${cleanKeyword || '-'}
Meta Title: ${cleanMetaTitle || '-'}
Meta Description: ${cleanMetaDesc || '-'}

ARTIKEL:
${truncatedArticle}`;

  try {
    const { content } = await callChatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      timeoutMs: AI_EVAL_TIMEOUT_MS,
      signal,
    });

    const parsed = JSON.parse(content);

    const results: CheckResult[] = (parsed.results || []).map((r: any) => {
      const id = Number(r.id) as 51 | 52 | 53 | 54 | 55 | 56;
      const passed = Boolean(r.passed);
      const score = Number(r.score) || 0;
      const cat = r.category || (passed ? 'passed' : 'Error');
      return {
        id,
        question: SOP_QUESTIONS[id],
        status: passed ? 'passed' : (cat === 'Information' ? 'info' : 'failed'),
        passed,
        reason: r.reason || '-',
        problematic_text: r.target_highlight?.exact_word || '',
        source: 'ai' as const,
        aiConfidence: score,
        category: cat === 'Information' ? 'Information' : cat === 'Error' ? 'Error' : undefined,
        suggested_fix: r.suggested_fix || '',
        target_highlight: r.target_highlight ? {
          exact_word: r.target_highlight.exact_word || null,
          sentence_context: r.target_highlight.sentence_context || '',
          start_index: r.target_highlight.start_index != null ? Number(r.target_highlight.start_index) : null,
          end_index: r.target_highlight.end_index != null ? Number(r.target_highlight.end_index) : null,
          target_text: r.target_highlight.target_text || r.target_highlight.sentence_context || null,
          target_type: r.target_highlight.target_type || 'sentence',
        } : undefined,
        point_penalty: r.point_penalty != null ? Number(r.point_penalty) : (cat === 'Information' ? 0 : 10),
        has_ignore_button: r.has_ignore_button !== false,
        auto_correct_button: Boolean(r.auto_correct_button) || cat === 'Error' || cat === 'Information',
      };
    }).filter((r: any): r is CheckResult => r !== null);

    // POST-PROCESSING VERIFICATION:
    // Drop any issues where the claimed problematic text or sentence context doesn't actually exist in the article verbatim
    const validatedResults = results.filter((r: CheckResult) => {
      if (r.passed) return true;
      if (!r.target_highlight) return true; // Keep macro/conceptual info issues if no highlight specified

      const exactWord = (r.target_highlight.exact_word || '').trim();
      const sentenceContext = (r.target_highlight.sentence_context || '').trim();

      // If AI specified exact_word or sentence_context, at least one MUST exist verbatim in cleanArticle
      let exactWordFound = exactWord ? cleanArticle.includes(exactWord) : false;
      let sentenceFound = sentenceContext ? cleanArticle.includes(sentenceContext) : false;

      // Drop hallucinated issue if neither exact_word nor sentence_context exist in cleanArticle
      if ((exactWord && !exactWordFound) || (sentenceContext && !sentenceFound)) {
        return false;
      }

      return true;
    });

    const rawSub = parsed.subScores || {};
    const clamp = (v: unknown) => Math.max(0, Math.min(100, Number(v) || 0));
    const subScores: SubScores = {
      seo: clamp(rawSub.seo),
      structure: clamp(rawSub.structure),
      intent: clamp(rawSub.intent),
      tone: clamp(rawSub.tone),
    };

    // Log anomaly when AI returns perfect scores across all categories (possible lazy scoring)
    if (subScores.seo === 100 && subScores.structure === 100 && subScores.intent === 100 && subScores.tone === 100) {
      console.warn('[AI Eval] All sub-scores are 100 — potential lazy/anomalous scoring. Results count:', results.length);
    }

    const bestNextMove: string = typeof parsed.bestNextMove === 'string'
      ? parsed.bestNextMove.slice(0, 150)
      : '';

    return { results: validatedResults, subScores, bestNextMove };
  } catch (err) {
    const info = classifyAiError(err);
    logAiError('sop-ai-eval', info);
    return buildSkippedOutput(info.userMessage);
  }
}

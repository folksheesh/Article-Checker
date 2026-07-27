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
  const systemPrompt = `Anda adalah Editor Senior dan Ahli Hukum Konten Digital Indonesia.
Tugas Anda mengevaluasi artikel hukum berdasarkan SOP dan aturan berikut. Keluarkan hasil HANYA dalam format JSON.

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
- Cari kata lemah sebagai whole word (kata utuh): "mungkin", "saja", "hanya"
- Pastikan kata yang cocok adalah KATA UTUH, BUKAN substring dari kata lain.
- Contoh BENAR: Kalimat "Hanya dia yang bisa datang" → "hanya" terdeteksi ✅
- Contoh SALAH: Kalimat "usahanya berkembang pesat" → "hanya" adalah bagian dari "usahanya", JANGAN deteksi ❌
- Contoh SALAH: Kalimat "dimungkinkan" → "mungkin" adalah bagian dari "dimungkinkan", JANGAN deteksi ❌
- Jika ditemukan kata lemah sebagai whole word, buat item evaluasi dengan kategori "Error"

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

  const cleanArticle = stripImages(input.article || '');

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
        } : undefined,
        point_penalty: r.point_penalty != null ? Number(r.point_penalty) : (cat === 'Information' ? 0 : 10),
        has_ignore_button: r.has_ignore_button !== false,
        auto_correct_button: Boolean(r.auto_correct_button) || cat === 'Error' || cat === 'Information',
      };
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

    return { results, subScores, bestNextMove };
  } catch (err) {
    const info = classifyAiError(err);
    logAiError('sop-ai-eval', info);
    return buildSkippedOutput(info.userMessage);
  }
}

import type { CheckResult, AiEvaluationOutput, SubScores } from './types';
import { SOP_QUESTIONS } from './constants';
import { AI_EVAL_TIMEOUT_MS } from './config';
import { stripImages } from './images';
import { callChatCompletion } from './apis/openai';

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

export async function evaluateWithAI(input: AiEvaluationInput, apiKey = '', signal?: AbortSignal): Promise<AiEvaluationOutput> {
  const systemPrompt = `Anda adalah Editor Senior dan Ahli Hukum Konten Digital Indonesia.
Tugas Anda mengevaluasi artikel hukum berdasarkan SOP dan aturan berikut. Keluarkan hasil HANYA dalam format JSON.

ATURAN EVALUASI:
1. Nada bahasa profesional dan sesuai konteks legal.
2. Alur antar paragraf koheren dan mudah diikuti.
3. Klaim hukum akurat dan tidak menyesatkan.
4. CTA persuasif dan relevan dengan topik.
5. Pembukaan dan penutup kuat serta memberikan kesan profesional.
6. Pemakaian huruf kapital sudah benar (awal kalimat, proper noun, akronim, "Anda").

WEAK WORDS CHECK:
- Cari kata lemah: "mungkin", "saja", "hanya"
- Jika ditemukan, buat item evaluasi dengan kategori "Error"

LEGISLATIVE VALIDATION:
- Referensi UU bersifat OPSIONAL. JANGAN flag ketiadaan UU sebagai error.
- Jika ada referensi UU yang tidak relevan dengan topik artikel, beri saran informasi.
- Jika tidak ada UU, jangan buat item evaluasi untuk ini.

CLASSIFICATION:
- Error: masalah yang bisa di-highlight ke kata spesifik di artikel (weak words, kapitalisasi salah, dll)
- Information: masalah konseptual/missing (CTA tidak ada, UU tidak relevan) — beri auto_correct_button: true

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
      "auto_correct_button": false
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
      apiKey,
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
        auto_correct_button: Boolean(r.auto_correct_button),
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

    const bestNextMove: string = typeof parsed.bestNextMove === 'string'
      ? parsed.bestNextMove.slice(0, 150)
      : '';

    return { results, subScores, bestNextMove };
  } catch (err) {
    console.error('AI evaluation error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return buildSkippedOutput(`AI error: ${msg}`);
  }
}

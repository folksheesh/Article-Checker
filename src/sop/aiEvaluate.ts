import type { CheckResult, AiEvaluationOutput, SubScores } from './types';
import { SOP_QUESTIONS } from './constants';
import { OLLAMA_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_SKIP_AUTH, AI_EVAL_TIMEOUT_MS } from './config';
import { stripImages } from './images';

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
  bestNextMove: 'Tambahkan API key Ollama untuk mengaktifkan evaluasi AI.',
};

function buildSkippedOutput(fallbackReason?: string): AiEvaluationOutput {
  const ids: Array<51 | 52 | 53 | 54 | 55 | 56> = [51, 52, 53, 54, 55, 56];
  const results: CheckResult[] = ids.map((id) => ({
    id,
    question: SOP_QUESTIONS[id],
    status: 'deferred',
    passed: true,
    reason: fallbackReason || 'Tambahkan API key Ollama untuk mengaktifkan evaluasi AI.',
    problematic_text: '',
    source: 'ai' as const,
  }));
  return {
    results,
    subScores: EMPTY_SUB_SCORES,
    bestNextMove: fallbackReason || FALLBACK_OUTPUT.bestNextMove,
  };
}

export async function evaluateWithAI(input: AiEvaluationInput, _apiKey: string, signal?: AbortSignal): Promise<AiEvaluationOutput> {
  const apiKey = _apiKey.trim() || OLLAMA_API_KEY;
  if (!apiKey.trim() && !OLLAMA_SKIP_AUTH) {
    return buildSkippedOutput();
  }

  const systemPrompt = `Anda adalah Editor Senior dan Ahli Hukum Konten Digital Indonesia.
Tugas Anda mengevaluasi artikel hukum berdasarkan 5 kriteria kualitas berikut. Keluarkan hasil HANYA dalam format JSON.

Kriteria:
1. Nada bahasa profesional dan sesuai konteks legal (tidak terlalu kasual, tidak terlalu akademik, terpercaya untuk klien).
2. Alur antar paragraf koheren dan mudah diikuti (ada transisi logis, tidak melompat-lompat).
3. Klaim hukum akurat dan tidak menyesatkan (tidak membuat klaim absolut jika tidak pasti, tidak mengada-ada).
4. CTA persuasif dan relevan dengan topik (bukan hanya "hubungi kami" kering).
5. Pembukaan dan penutup kuat serta memberikan kesan profesional.
6. Pemakaian huruf kapital dan kecil pada kata-kata sudah benar (kata di awal kalimat menggunakan huruf kapital, nama badan hukum / merek / proper noun ditulis dengan kapitalisasi yang benar, akronim seperti "PT", "UU", "Pasal" ditulis dengan tepat, tidak ada kata ALL CAPS di tengah kalimat biasa, dan kata sapaan "Anda" selalu diawali huruf kapital).

Setiap kriteria dinilai dengan skor 0-100 dan diberikan alasan singkat (max 150 karakter) serta kutipan teks yang bermasalah jika ada.

Selain itu, berikan sub-skor (0-100) untuk 4 aspek berikut:
- seo: Kekuatan SEO artikel (keyword density, meta title/desc, heading structure, link)
- structure: Struktur artikel (heading hierarchy, paragraf, panjang, koherensi)
- intent: Kesesuaian dengan search intent (apakah menjawab kebutuhan pencari)
- tone: Kualitas nada bahasa (profesional, kredibel, mudah dipahami)

Dan berikan rekomendasi "bestNextMove" — satu langkah prioritas tertinggi yang paling berdampak untuk memperbaiki artikel (max 100 karakter).

Skema JSON:
{
  "results": [
    {
      "id": 51,
      "passed": true,
      "score": 85,
      "reason": "Alasan singkat lulus/gagal.",
      "problematic_text": "Kutipan teks yang bermasalah atau kosong jika lulus."
    }
  ],
  "subScores": {
    "seo": 75,
    "structure": 80,
    "intent": 70,
    "tone": 85
  },
  "bestNextMove": "Tambahkan CTA yang relevan di akhir artikel."
}`;

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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_EVAL_TIMEOUT_MS);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`AI request failed: ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content ?? '';
    const cleaned = resultText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const parsed = JSON.parse(cleaned);

    const results: CheckResult[] = (parsed.results || []).map((r: any) => {
      const id = Number(r.id) as 51 | 52 | 53 | 54 | 55 | 56;
      const passed = Boolean(r.passed);
      const score = Number(r.score) || 0;
      return {
        id,
        question: SOP_QUESTIONS[id],
        status: passed ? 'passed' : ('failed' as CheckResult['status']),
        passed,
        reason: r.reason || '-',
        problematic_text: r.problematic_text || '',
        source: 'ai' as const,
        aiConfidence: score,
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

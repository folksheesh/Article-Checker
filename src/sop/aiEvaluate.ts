import type { CheckResult } from './types';
import { SOP_QUESTIONS } from './constants';
import { OLLAMA_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_SKIP_AUTH } from './config';

export interface AiEvaluationInput {
  article: string;
  keyword: string;
  metaTitle: string;
  metaDesc: string;
}

export async function evaluateWithAI(input: AiEvaluationInput, _apiKey: string): Promise<CheckResult[]> {
  const apiKey = _apiKey.trim() || OLLAMA_API_KEY;
  if (!apiKey.trim() && !OLLAMA_SKIP_AUTH) {
    return createSkippedResults();
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
  ]
}`;

  const cleanArticle = (input.article || '')
    .replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\([^)]*\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)(?:\?[^)]*)?\)/gi, '')
    .replace(/\[[^\]]*\]:\s*\S+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)/gi, '')
    .replace(/\b\w+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)\b/gi, '')
    .trim();

  // Truncate to first 3000 chars for faster AI processing
  const truncatedArticle = cleanArticle.length > 3000
    ? cleanArticle.slice(0, 3000) + '\n\n...[artikel terpotong, lanjutan dihilangkan untuk efisiensi]'
    : cleanArticle;

  const userPrompt = `Keyword: ${input.keyword || '-'}
Meta Title: ${input.metaTitle || '-'}
Meta Description: ${input.metaDesc || '-'}

ARTIKEL:
${truncatedArticle}`;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey && !OLLAMA_SKIP_AUTH) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

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

    return (parsed.results || []).map((r: any) => {
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
  } catch (err) {
    console.error('AI evaluation error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return createSkippedResults(`AI error: ${msg}`);
  }
}

function createSkippedResults(fallbackReason?: string): CheckResult[] {
  const ids: Array<51 | 52 | 53 | 54 | 55 | 56> = [51, 52, 53, 54, 55, 56];
  return ids.map((id) => ({
    id,
    question: SOP_QUESTIONS[id],
    status: 'deferred',
    passed: true,
    reason: fallbackReason || 'Tambahkan API key Ollama untuk mengaktifkan evaluasi AI.',
    problematic_text: '',
    source: 'ai' as const,
  }));
}

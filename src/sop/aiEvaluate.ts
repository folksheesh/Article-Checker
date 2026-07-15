import type { CheckResult } from './types';
import { SOP_QUESTIONS } from './constants';

export interface AiEvaluationInput {
  article: string;
  keyword: string;
  metaTitle: string;
  metaDesc: string;
}

export async function evaluateWithAI(input: AiEvaluationInput, apiKey: string): Promise<CheckResult[]> {
  if (!apiKey.trim()) {
    return createSkippedResults();
  }

  const systemPrompt = `Anda adalah Editor Senior dan Ahli Hukum Konten Digital Indonesia.
Tugas Anda mengevaluasi artikel hukum berdasarkan 5 kriteria kualitas berikut. Keluarkan hasil HANYA dalam format JSON.

Kriteria:
1. Nada bahasa profesional dan sesuai konteks legal (tidak terlalu kasual, tidak terlalu akademik,可信 untuk klien).
2. Alur antar paragraf koheren dan mudah diikuti (ada transisi logis, tidak melompat-lompat).
3. Klaim hukum akurat dan tidak menyesatkan (tidak membuat klaim absolut jika tidak pasti, tidak mengada-ada).
4. CTA persuasif dan relevan dengan topik (bukan hanya "hubungi kami" kering).
5. Pembukaan dan penutup kuat serta memberikan kesan profesional.

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

  const userPrompt = `Keyword: ${input.keyword || '-'}
Meta Title: ${input.metaTitle || '-'}
Meta Description: ${input.metaDesc || '-'}

ARTIKEL:
${input.article}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`AI request failed: ${response.status}`);
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cleaned = resultText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const parsed = JSON.parse(cleaned);

    return (parsed.results || []).map((r: any) => {
      const id = Number(r.id) as 51 | 52 | 53 | 54 | 55;
      const passed = Boolean(r.passed);
      const score = Number(r.score) || 0;
      return {
        id,
        question: SOP_QUESTIONS[id],
        status: passed ? 'passed' : ('failed' as CheckResult['status']),
        passed,
        reason: `${r.reason || '-'} (skor AI: ${score})`,
        problematic_text: r.problematic_text || '',
        source: 'ai' as const,
        aiConfidence: score,
      };
    });
  } catch (err) {
    console.error('AI evaluation error:', err);
    return createSkippedResults('AI tidak dapat dijalankan saat ini.');
  }
}

function createSkippedResults(fallbackReason?: string): CheckResult[] {
  const ids: Array<51 | 52 | 53 | 54 | 55> = [51, 52, 53, 54, 55];
  return ids.map((id) => ({
    id,
    question: SOP_QUESTIONS[id],
    status: 'deferred',
    passed: true,
    reason: fallbackReason || 'Tambahkan API key Gemini untuk mengaktifkan evaluasi AI.',
    problematic_text: '',
    source: 'ai' as const,
  }));
}

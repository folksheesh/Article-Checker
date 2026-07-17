import { callChatCompletion } from './openai';

export interface AIDetectionResult {
  provider: 'openai' | 'none';
  aiProbability: number;
  humanProbability: number;
  sentences?: Array<{ text: string; ai_probability: number }>;
  explanation?: string;
  error?: string;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function detectAIContent(text: string): Promise<AIDetectionResult> {
  if (!text.trim()) {
    return { provider: 'none', aiProbability: 0, humanProbability: 0, error: 'Tidak ada teks untuk diperiksa.' };
  }

  try {
    const { content } = await callChatCompletion({
      messages: [
        {
          role: 'system',
          content: `Anda adalah AI Content Detector. Analisis teks berikut dan tentukan probabilitas bahwa teks tersebut dibuat oleh AI (seperti ChatGPT, Gemini, dll) vs ditulis oleh manusia.

Kembalikan JSON SAJA tanpa markdown atau pembungkus apapun:
{
  "aiProbability": <0-100>,
  "sentences": [
    { "text": "<kalimat>", "ai_probability": <0-100> }
  ],
  "explanation": "<penjelasan singkat mengapa teks memiliki probabilitas tersebut, sebut pola spesifik yang ditemukan>"
}

aiProbability adalah skor keseluruhan (0 = pasti manusia, 100 = pasti AI).
sentences adalah array analisis per kalimat (maks 10 kalimat terpenting).
explanation adalah evaluasi tekstual: jelaskan pola spesifik yang membuat teks terlihat AI atau manusia (mis: repetisi frasa, transisi kaku, variasi kosakata, naturalness, dll).
Bersikaplah objektif.`,
        },
        { role: 'user', content: text.slice(0, 8000) },
      ],
      temperature: 0.1,
      timeoutMs: 30_000,
    });

    const data = JSON.parse(content);
    const aiProbability = clampPercent(data.aiProbability ?? 50);
    const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : undefined;
    const sentences = Array.isArray(data.sentences)
      ? data.sentences.map((s: any) => ({
          text: String(s.text || ''),
          ai_probability: clampPercent(s.ai_probability ?? 50),
        }))
      : undefined;

    return {
      provider: 'openai',
      aiProbability,
      humanProbability: 100 - aiProbability,
      sentences,
      explanation,
    };
  } catch (err) {
    console.error('AI detector error:', err);
    return {
      provider: 'none',
      aiProbability: 0,
      humanProbability: 0,
      error: err instanceof Error ? err.message : 'Gagal mendeteksi AI.',
    };
  }
}

import { callChatCompletion } from './openai';

export interface PlagiarismResult {
  provider: 'openai' | 'none';
  plagiarismScore: number;
  matchedSources: Array<{ url: string; matchedText: string; score: number }>;
  explanation?: string;
  error?: string;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function checkPlagiarism(text: string): Promise<PlagiarismResult> {
  if (!text.trim()) {
    return { provider: 'none', plagiarismScore: 0, matchedSources: [], error: 'Tidak ada teks untuk diperiksa.' };
  }

  try {
    const { content } = await callChatCompletion({
      messages: [
        {
          role: 'system',
          content: `Anda adalah Plagiarism Checker. Analisis teks berikut dan deteksi kemungkinan plagiarisme.

Kembalikan JSON SAJA tanpa markdown atau pembungkus apapun:
{
  "plagiarismScore": <0-100>,
  "matchedSources": [
    { "url": "<sumber>", "matchedText": "<teks yang cocok>", "score": <0-100> }
  ],
  "explanation": "<evaluasi tekstual: jelaskan mengapa teks memiliki skor tersebut, frasa/struktur mana yang mencurigakan, dan apakah pola penulisan mengindikasikan saduran atau terjemahan>"
}

plagiarismScore: skor kemungkinan plagiarisme (0 = original, 100 = plagiat).
matchedSources: sumber-sumber yang mungkin mirip (bisa dikosongkan jika tidak yakin).
url: gunakan domain wajar seperti wikipedia.org, situs berita, dll.
explanation: evaluasi mendetail tentang faktor-faktor yang memengaruhi skor.
Bersikaplah objektif. Jika teks tampak original, beri skor rendah.`,
        },
        { role: 'user', content: text.slice(0, 8000) },
      ],
      temperature: 0.1,
      timeoutMs: 30_000,
    });

    const data = JSON.parse(content);
    const matchedSources = Array.isArray(data.matchedSources)
      ? data.matchedSources.map((s: any) => ({
          url: String(s.url || ''),
          matchedText: String(s.matchedText || ''),
          score: clampPercent(s.score ?? 0),
        }))
      : [];
    const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : undefined;

    return {
      provider: 'openai',
      plagiarismScore: clampPercent(data.plagiarismScore ?? 0),
      matchedSources,
      explanation,
    };
  } catch (err) {
    console.error('Plagiarism checker error:', err);
    return {
      provider: 'none',
      plagiarismScore: 0,
      matchedSources: [],
      error: err instanceof Error ? err.message : 'Gagal memeriksa plagiasi.',
    };
  }
}

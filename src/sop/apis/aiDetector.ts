import { callChatCompletion } from './openai';
import { classifyAiError, logAiError } from '../errorHandling';

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

function calculateBurstiness(text: string): { sentenceCount: number; stdDev: number; avgLength: number } {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  if (sentences.length <= 1) return { sentenceCount: sentences.length, stdDev: 0, avgLength: text.length };

  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / lengths.length;

  return { sentenceCount: sentences.length, stdDev: Math.sqrt(variance), avgLength };
}

function countAiTransitions(text: string): number {
  const aiPhrases = [
    /\bdalam era (digital|modern)\b/gi,
    /\bpenting untuk (diingat|dipahami|dicatat)\b/gi,
    /\bdi samping itu\b/gi,
    /\bsebagai kesimpulan\b/gi,
    /\bdalam mengarungi dinamika\b/gi,
    /\btidak dapat dipungkiri\b/gi,
    /\bperlu digarisbawahi\b/gi,
    /\bdalam hal ini\b/gi,
  ];
  return aiPhrases.reduce((count, regex) => count + (text.match(regex) || []).length, 0);
}

export async function detectAIContent(text: string): Promise<AIDetectionResult> {
  const cleanInput = text.trim();
  if (!cleanInput) {
    return { provider: 'none', aiProbability: 0, humanProbability: 0, error: 'Tidak ada teks untuk diperiksa.' };
  }

  const { sentenceCount, stdDev, avgLength } = calculateBurstiness(cleanInput);
  const transitionCount = countAiTransitions(cleanInput);

  try {
    const { content } = await callChatCompletion({
      messages: [
        {
          role: 'system',
          content: `Anda adalah Expert AI Content Forensics & Stylometrics Auditor spesialis Bahasa Indonesia.
Tugas Anda: Menganalisis teks artikel hukum/bisnis dan menentukan probabilitas apakah teks tersebut dibuat oleh AI Generatif (ChatGPT, Gemini, Claude) atau ditulis secara organik oleh Penulis Manusia.

STATISTIK TEKS INI:
- Rata-rata kata per kalimat: ${avgLength.toFixed(1)} kata
- Deviasi Standar Panjang Kalimat (Burstiness): ${stdDev.toFixed(2)} (Semakin tinggi > 8 = Manusia, < 4 = AI)
- Jumlah Frasa Transisi Klise AI: ${transitionCount}

METODOLOGI ANALISIS (Wajib Diikuti):
1. **Burstiness (Variasi Struktur):** 
   - Tulisan Manusia: Panjang kalimat bervariasi secara acak (ada kalimat sangat pendek < 6 kata diselingi kalimat agak panjang).
   - Tulisan AI: Struktur seragam, panjang kalimat simetris (stdDev < 4.0), tiap paragraf cenderung berukuran rata 2-3 kalimat.
2. **Perplexity & Cliché Fingerprints:** 
   - Tulisan AI sering memakai frasa transisi generik klise seperti:
     * "Dalam era digital saat ini...", "Penting untuk diingat bahwa...", "Di samping itu...", "Sebagai kesimpulan...", "Dalam mengarungi dinamika...", "Tidak dapat dipungkiri bahwa..."
   - Tulisan Manusia: Bahasa lebih langsung (direct), bernada percakapan profesional, menggunakan idiom natural.
3. **Pola Kesimpulan & Rangkuman Kaku:** AI suka merangkum ulang poin di tiap paragraf dan menutup artikel dengan nada sangat diplomatis/generik.

CONTOH KALIMAT AI vs MANUSIA:
- AI (AI Prob 90-100%): "Dalam mengarungi dinamika bisnis modern, penting bagi setiap pelaku usaha untuk senantiasa memperhatikan aspek keabsahan legalitas."
- Manusia (AI Prob 0-15%): "Bisnis Anda mau naik kelas dari Menengah ke Besar? Hati-hati, operasional bisa dihentikan jika belum update data OSS."

ATURAN OUTPUT:
Kembalikan JSON SAJA tanpa format markdown atau pembungkus lain:
{
  "sentences": [
    { "text": "<kutipan KALIMAT PERSIS dari artikel>", "ai_probability": <0-100> }
  ],
  "aiProbability": <0-100>,
  "explanation": "<penjelasan ringkas (1-2 kalimat) sebutkan pola frasa klise AI yang paling menonjol atau variasi kalimat yang membuat teks alami/kaku>"
}

Catatan Penting:
- 'text' di dalam 'sentences' HARUS BERISI KUTIPAN KALIMAT PERSIS yang ada di dalam artikel. Dilarang mengarang atau mengubah kata!`,
        },
        { role: 'user', content: cleanInput.slice(0, 8000) },
      ],
      temperature: 0.0,
      timeoutMs: 30_000,
    });

    const data = JSON.parse(content);
    const rawSentences = Array.isArray(data.sentences) ? data.sentences : [];

    // Filter sentences: ensure text actually exists in cleanInput verbatim
    const validSentences = rawSentences
      ? rawSentences
          .map((s: any) => ({
            text: String(s.text || '').trim(),
            ai_probability: clampPercent(s.ai_probability ?? 50),
          }))
          .filter((s: { text: string; ai_probability: number }) => s.text.length > 5 && cleanInput.includes(s.text))
      : [];

    let baseScore = 0;
    if (validSentences.length > 0) {
      const sum = validSentences.reduce((acc: number, s: { ai_probability: number }) => acc + s.ai_probability, 0);
      baseScore = sum / validSentences.length;
    } else {
      baseScore = Number(data.aiProbability ?? 50);
    }

    // Hybrid score adjustment using standard statistical heuristics
    if (stdDev < 4.0 && sentenceCount > 5) {
      baseScore += 10; // Low burstiness penalty
    }
    if (transitionCount > 0) {
      baseScore += transitionCount * 4; // Cliché transitions penalty
    }

    const finalAiProbability = clampPercent(baseScore);
    const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : undefined;

    return {
      provider: 'openai',
      aiProbability: finalAiProbability,
      humanProbability: 100 - finalAiProbability,
      sentences: validSentences.length > 0 ? validSentences : undefined,
      explanation,
    };
  } catch (err) {
    const info = classifyAiError(err);
    logAiError('ai-detector', info);
    return {
      provider: 'none',
      aiProbability: 0,
      humanProbability: 0,
      error: info.userMessage,
    };
  }
}

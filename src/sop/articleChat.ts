import { OLLAMA_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_SKIP_AUTH } from './config';

const SYSTEM_PROMPT = `Anda adalah asisten penulis artikel hukum Indonesia. Tugas Anda membantu user menyempurnakan artikel mereka.

Anda akan menerima artikel saat ini dan permintaan user. Balaslah dengan versi artikel yang sudah dimodifikasi sesuai permintaan user.

Aturan:
- Output HANYA teks artikel yang sudah dimodifikasi (dalam format Markdown)
- Jangan tambahkan penjelasan, komentar, atau catatan tambahan
- Jangan gunakan pembuka seperti "Tentu, berikut artikel yang sudah diperbaiki"
- Pertahankan struktur Markdown asli artikel
- Jangan mengubah bagian yang tidak diminta
- Jika user meminta sesuatu di luar konteks artikel, tolak dengan sopan
- Gunakan bahasa Indonesia yang baik dan benar
- Artikel mungkin mengandung token penanda gambar berbentuk [[GAMBAR_0]], [[GAMBAR_1]], dst. JANGAN ubah, jangan hapus, dan PERTAHANKAN token tersebut persis di posisi aslinya.`;

export async function callArticleChat(
  article: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = OLLAMA_API_KEY;
  if (!apiKey.trim() && !OLLAMA_SKIP_AUTH) {
    throw new Error('API key tidak tersedia. Tambahkan VITE_OLLAMA_API_KEY di .env');
  }

  // Extract images into placeholder tokens. The current text model does not
  // support image input, so we strip the raw image data before sending and
  // restore it from the original article afterward.
  const images: string[] = [];
  const articleForAi = article.replace(/!\[[^\]]*\]\([^)]*\)/g, (m) => {
    images.push(m);
    return `[[GAMBAR_${images.length - 1}]]`;
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && !OLLAMA_SKIP_AUTH) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `ARTIKEL SAAT INI:\n${articleForAi}\n\nPERMINTAAN USER:\n${userPrompt}`,
          },
        ],
        stream: false,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Gagal menghubungi AI: ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }

    const data = await response.json();
    let resultText: string = data.choices?.[0]?.message?.content ?? '';
    resultText = resultText.trim();

    // Restore original images from placeholders
    images.forEach((img, i) => {
      resultText = resultText.split(`[[GAMBAR_${i}]]`).join(img);
    });
    // Drop any leftover tokens the model may have produced
    resultText = resultText.replace(/\[\[GAMBAR_\d+\]\]/g, '');

    return resultText;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

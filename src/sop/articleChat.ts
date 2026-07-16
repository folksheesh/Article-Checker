import { OLLAMA_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_SKIP_AUTH } from './config';

const SYSTEM_PROMPT = `Anda adalah asisten penulis artikel hukum Indonesia. Tugas Anda membantu user menulis dan menyempurnakan artikel mereka.

Anda akan menerima artikel saat ini dan pesan dari user.

Ada dua jenis permintaan user:

1. **Permintaan mengubah artikel** — jika user meminta perubahan pada artikel (perbaiki, tambah, hapus, ubah, dll.), maka Anda harus mengembalikan SELURUH artikel yang sudah dimodifikasi dalam format Markdown. Awali respons Anda dengan: [ARTICLE]

2. **Pertanyaan tentang artikel** — jika user bertanya tentang artikel (saran, pendapat, analisis, evaluasi, dll.), maka Anda harus menjawab secara naratif seperti rekan diskusi. Awali respons Anda dengan: [ANSWER]

Aturan:
- Jika user meminta perubahan, output HANYA teks artikel yang sudah dimodifikasi setelah tag [ARTICLE], tanpa penjelasan tambahan
- Jika user bertanya, berikan jawaban yang informatif dan profesional setelah tag [ANSWER], gunakan bahasa Indonesia
- Pertahankan struktur Markdown asli artikel saat memodifikasi
- Jangan mengubah bagian artikel yang tidak diminta
- Jika user meminta sesuatu di luar konteks artikel, tolak dengan sopan
- Artikel mungkin mengandung token penanda gambar berbentuk [[GAMBAR_0]], [[GAMBAR_1]], dst. JANGAN ubah, jangan hapus, dan PERTAHANKAN token tersebut persis di posisi aslinya`;

export interface ChatResponse {
  type: 'article' | 'answer';
  content: string;
}

export async function callArticleChat(
  article: string,
  userPrompt: string,
): Promise<ChatResponse> {
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
            content: `ARTIKEL SAAT INI:\n${articleForAi}\n\nPESAN USER:\n${userPrompt}`,
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
    resultText = resultText.replace(/\[\[GAMBAR_\d+\]\]/g, '');

    // Determine response type
    if (resultText.startsWith('[ARTICLE]')) {
      return { type: 'article', content: resultText.replace(/^\[ARTICLE\]\s*/, '').trim() };
    }
    if (resultText.startsWith('[ANSWER]')) {
      return { type: 'answer', content: resultText.replace(/^\[ANSWER\]\s*/, '').trim() };
    }
    // Fallback: if it looks like markdown with headings, treat as article
    if (/^#{1,3}\s/m.test(resultText) || resultText.includes('\n---\n')) {
      return { type: 'article', content: resultText };
    }
    return { type: 'answer', content: resultText };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

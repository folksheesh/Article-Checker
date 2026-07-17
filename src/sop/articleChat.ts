import { AI_CHAT_TIMEOUT_MS } from './config';
import { stripImages } from './images';
import { callChatCompletion } from './apis/openai';

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
  apiKey = '',
): Promise<ChatResponse> {
  const images: string[] = [];
  let articleForAi = article.replace(/!\[[^\]]*\]\([^)]*\)/g, (m) => {
    images.push(m);
    return `[[GAMBAR_${images.length - 1}]]`;
  });
  articleForAi = stripImages(articleForAi);

  const { content } = await callChatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `ARTIKEL SAAT INI:\n${articleForAi}\n\nPESAN USER:\n${stripImages(userPrompt)}`,
      },
    ],
    temperature: 0.4,
    timeoutMs: AI_CHAT_TIMEOUT_MS,
    apiKey,
  });

  let resultText = content.trim();

  images.forEach((img, i) => {
    resultText = resultText.split(`[[GAMBAR_${i}]]`).join(img);
  });
  resultText = resultText.replace(/\[\[GAMBAR_\d+\]\]/g, '');

  if (resultText.startsWith('[ARTICLE]')) {
    return { type: 'article', content: resultText.replace(/^\[ARTICLE\]\s*/, '').trim() };
  }
  if (resultText.startsWith('[ANSWER]')) {
    return { type: 'answer', content: resultText.replace(/^\[ANSWER\]\s*/, '').trim() };
  }
  if (/^#{1,3}\s/m.test(resultText) || resultText.includes('\n---\n')) {
    return { type: 'article', content: resultText };
  }
  return { type: 'answer', content: resultText };
}

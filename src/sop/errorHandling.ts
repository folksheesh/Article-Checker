export type AiErrorType = 'rate_limit' | 'quota' | 'timeout' | 'network' | 'unknown' | 'abort';

export type AiFeature =
  | 'sop-ai-eval'
  | 'ai-detector'
  | 'plagiarism'
  | 'auto-correct'
  | 'keyword-gen'
  | 'chat'
  | 'meta-desc';

export interface AiErrorInfo {
  type: AiErrorType;
  userMessage: string;
  technicalDetail: string;
}

export const AI_ERROR_MESSAGES: Record<AiErrorType, string> = {
  rate_limit:
    'Sistem sedang sibuk memproses banyak permintaan. Silakan coba lagi dalam beberapa menit.',
  quota:
    'Layanan pengecekan AI sedang tidak tersedia untuk saat ini. Tim kami sudah diberi tahu. Anda tetap bisa melanjutkan menulis, dan coba cek lagi nanti.',
  timeout:
    'Pengecekan memakan waktu lebih lama dari biasanya. Silakan coba lagi.',
  network:
    'Koneksi ke server terputus. Periksa koneksi internet Anda dan coba lagi.',
  unknown:
    'Terjadi kendala saat memproses pengecekan. Silakan coba lagi, atau hubungi admin jika masalah berlanjut.',
  abort: '',
};

export function classifyAiError(err: unknown): AiErrorInfo {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (/429|rate.?limit|too many (concurrent|requests)/i.test(lower)) {
    return { type: 'rate_limit', userMessage: AI_ERROR_MESSAGES.rate_limit, technicalDetail: msg };
  }

  if (/quota|insufficient|402|billing|payment|exhausted/i.test(lower)) {
    return { type: 'quota', userMessage: AI_ERROR_MESSAGES.quota, technicalDetail: msg };
  }

  if (err instanceof DOMException && err.name === 'AbortError') {
    return { type: 'abort', userMessage: '', technicalDetail: msg };
  }

  if (/timeout|timed ?out/i.test(lower)) {
    return { type: 'timeout', userMessage: AI_ERROR_MESSAGES.timeout, technicalDetail: msg };
  }

  if (/fetch failed|network|econnrefused|econnreset|enetunreach|dns|internet connection|Failed to fetch/i.test(lower)) {
    return { type: 'network', userMessage: AI_ERROR_MESSAGES.network, technicalDetail: msg };
  }

  return { type: 'unknown', userMessage: AI_ERROR_MESSAGES.unknown, technicalDetail: msg };
}

export function logAiError(feature: AiFeature, error: AiErrorInfo): void {
  if (error.type === 'abort') return;
  console.error(`[AI Error][${feature}] type=${error.type} detail=${error.technicalDetail}`);
}

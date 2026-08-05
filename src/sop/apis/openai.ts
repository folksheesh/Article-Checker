import {
  GEMINI_API_KEY,
  GEMINI_BASE_URL,
  GEMINI_MODEL,
  HUGGINGFACE_API_KEY,
  HUGGINGFACE_BASE_URL,
  HUGGINGFACE_MODEL,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  OLLAMA_API_KEY,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  OLLAMA_SKIP_AUTH,
} from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  apiKey?: string;
  stripJsonBlock?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  usedOpenAI: boolean;
}

export async function callChatCompletion({
  messages,
  model,
  temperature = 0.3,
  timeoutMs = 45_000,
  signal,
  stripJsonBlock = true,
}: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const geminiKey = (GEMINI_API_KEY ?? '').trim();
  const openAiKey = (OPENAI_API_KEY ?? '').trim();
  const huggingfaceKey = (HUGGINGFACE_API_KEY ?? '').trim();
  const ollamaKey = (OLLAMA_API_KEY ?? '').trim();
  const geminiModel = model || GEMINI_MODEL;
  const openAiModel = model || OPENAI_MODEL;
  const huggingfaceModel = model || HUGGINGFACE_MODEL;

  // Provider chain with automatic fallback
  const providers: { name: string; key: string; call: () => Promise<ChatCompletionResult> }[] = [];

  if (ollamaKey || OLLAMA_SKIP_AUTH) {
    providers.push({ name: 'ollama', key: ollamaKey, call: () => callOllamaFallback({ messages, model: OLLAMA_MODEL, temperature, timeoutMs, signal, stripJsonBlock }) });
  }

  if (huggingfaceKey) {
    providers.push({ name: 'huggingface', key: huggingfaceKey, call: () => callHuggingFace({ messages, model: huggingfaceModel, temperature, timeoutMs, signal, apiKey: huggingfaceKey, stripJsonBlock }) });
  }

  if (geminiKey) {
    providers.push({
      name: 'gemini', key: geminiKey, call: () => callGeminiWithFallback({ messages, model: geminiModel, temperature, timeoutMs, signal, apiKey: geminiKey, stripJsonBlock }),
    });
  }

  if (openAiKey) {
    providers.push({ name: 'openai', key: openAiKey, call: () => callOpenAI({ messages, model: openAiModel, temperature, timeoutMs, signal, apiKey: openAiKey, stripJsonBlock }) });
  }

  if (providers.length === 0) {
    throw new Error('API key tidak tersedia. Tambahkan VITE_GEMINI_API_KEY, VITE_OPENAI_API_KEY, VITE_HUGGINGFACE_API_KEY, atau jalankan Ollama lokal.');
  }

  const errors: string[] = [];
  for (const p of providers) {
    try {
      if (p.name === 'gemini') {
        console.log(`[AI Model] provider=gemini model=${activeGeminiModel || geminiModel}`);
      } else {
        console.log(`[AI Model] provider=${p.name}`);
      }
      const result = await p.call();
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${p.name}: ${msg}`);
      // For Gemini quota errors, always fall through to next provider
      if (p.name === 'gemini' && /429|quota|rate.?limit/i.test(msg)) {
        console.warn(`Gemini quota exceeded, falling back to next provider: ${msg}`);
        continue;
      }
      console.warn(`${p.name} failed, falling back to next provider: ${msg}`);
    }
  }

  throw new Error(`Semua provider AI gagal.\n${errors.join('\n')}`);
}

// Memory of currently active working Gemini model
let activeGeminiModel: string | null = null;

async function callGeminiWithFallback(opts: Required<Pick<ChatCompletionOptions, 'messages' | 'model' | 'temperature' | 'timeoutMs'>> &
  Pick<ChatCompletionOptions, 'signal' | 'apiKey' | 'stripJsonBlock'>): Promise<ChatCompletionResult> {
  const defaultCandidates = [
    opts.model,
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ];

  // Prioritize active model if set, otherwise start with preferred candidates
  const candidateModels = Array.from(new Set(
    activeGeminiModel
      ? [activeGeminiModel, ...defaultCandidates]
      : defaultCandidates
  )).filter(Boolean);

  const errors: string[] = [];

  for (const m of candidateModels) {
    try {
      console.log(`[Gemini Auto-Switch Try] model=${m}`);
      const res = await callGemini({ ...opts, model: m });
      // Successfully called - remember working model for future calls
      if (activeGeminiModel !== m) {
        console.log(`[Gemini Auto-Switch Success] Active model set to: ${m}`);
        activeGeminiModel = m;
      }
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${m}: ${msg}`);
      console.warn(`[Gemini Auto-Switch Warning] Model ${m} failed (${msg}). Switching to next fallback model...`);
    }
  }

  throw new Error(`Semua model Gemini gagal.\n${errors.join('\n')}`);
}

async function callGemini({
  messages,
  model,
  temperature,
  timeoutMs,
  signal,
  apiKey,
  stripJsonBlock,
}: Required<Pick<ChatCompletionOptions, 'messages' | 'model' | 'temperature' | 'timeoutMs'>> &
  Pick<ChatCompletionOptions, 'signal' | 'apiKey' | 'stripJsonBlock'>): Promise<ChatCompletionResult> {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const conversationMsgs = messages.filter((m) => m.role !== 'system');
  const systemInstruction = systemMsgs.length > 0
    ? { parts: systemMsgs.map((m) => ({ text: m.content })) }
    : undefined;

  const contents = conversationMsgs.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature },
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    console.log(`[Gemini Request] model=${model} baseUrl=${GEMINI_BASE_URL}`);
    const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${encodeURIComponent(apiKey!)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Gemini request failed: ${response.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`);
    }

    const data = await response.json();
    let content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (stripJsonBlock) {
      content = content.replace(/```json/gi, '').replace(/```/gi, '').trim();
    }
    return { content, usedOpenAI: false };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function callHuggingFace({
  messages,
  model,
  temperature,
  timeoutMs,
  signal,
  apiKey,
  stripJsonBlock,
}: Required<Pick<ChatCompletionOptions, 'messages' | 'model' | 'temperature' | 'timeoutMs'>> &
  Pick<ChatCompletionOptions, 'signal' | 'apiKey' | 'stripJsonBlock'>): Promise<ChatCompletionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`${HUGGINGFACE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Hugging Face request failed: ${response.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content ?? '';
    if (stripJsonBlock) {
      content = content.replace(/```json/gi, '').replace(/```/gi, '').trim();
    }
    return { content, usedOpenAI: false };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function callOpenAI({
  messages,
  model,
  temperature,
  timeoutMs,
  signal,
  apiKey,
  stripJsonBlock,
}: Required<Pick<ChatCompletionOptions, 'messages' | 'model' | 'temperature' | 'timeoutMs'>> &
  Pick<ChatCompletionOptions, 'signal' | 'apiKey' | 'stripJsonBlock'>): Promise<ChatCompletionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`OpenAI request failed: ${response.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content ?? '';
    if (stripJsonBlock) {
      content = content.replace(/```json/gi, '').replace(/```/gi, '').trim();
    }
    return { content, usedOpenAI: true };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function callOllamaFallback({
  messages,
  model,
  temperature,
  timeoutMs,
  signal,
  stripJsonBlock,
}: Required<Pick<ChatCompletionOptions, 'messages' | 'model' | 'temperature' | 'timeoutMs'>> &
  Pick<ChatCompletionOptions, 'signal' | 'stripJsonBlock'>): Promise<ChatCompletionResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (OLLAMA_API_KEY) {
    headers['Authorization'] = `Bearer ${OLLAMA_API_KEY}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const url = import.meta.env.DEV
      ? `${OLLAMA_BASE_URL}/v1/chat/completions`
      : '/ollama-proxy.php';
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Ollama fallback failed: ${response.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content ?? '';
    if (stripJsonBlock) {
      content = content.replace(/```json/gi, '').replace(/```/gi, '').trim();
    }
    return { content, usedOpenAI: false };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

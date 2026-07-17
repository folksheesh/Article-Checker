import { GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_MODEL, OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OLLAMA_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_SKIP_AUTH } from '../config';

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
  model = GEMINI_MODEL,
  temperature = 0.3,
  timeoutMs = 45_000,
  signal,
  apiKey,
  stripJsonBlock = true,
}: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const geminiKey = (apiKey ?? '').trim() || GEMINI_API_KEY.trim();
  const openAiKey = OPENAI_API_KEY.trim();
  const ollamaKey = OLLAMA_API_KEY.trim();

  if (geminiKey) {
    try {
      return await callGemini({ messages, model, temperature, timeoutMs, signal, apiKey: geminiKey, stripJsonBlock });
    } catch (err) {
      const isQuota = err instanceof Error && /429|quota|rate.?limit/i.test(err.message);
      if (!isQuota) throw err;
      console.warn('Gemini quota exceeded, falling back to OpenAI:', err.message);
    }
  }

  if (openAiKey) {
    return callOpenAI({ messages, model: OPENAI_MODEL, temperature, timeoutMs, signal, apiKey: openAiKey, stripJsonBlock });
  }

  if (ollamaKey || OLLAMA_SKIP_AUTH) {
    return callOllamaFallback({ messages, model: OLLAMA_MODEL, temperature, timeoutMs, signal, stripJsonBlock });
  }

  throw new Error('API key tidak tersedia. Tambahkan VITE_GEMINI_API_KEY atau VITE_OPENAI_API_KEY di .env.');
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
    const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
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

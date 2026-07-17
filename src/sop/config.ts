/** API key for Ollama (or OpenAI-compatible) AI service. */
export const OLLAMA_API_KEY = import.meta.env?.VITE_OLLAMA_API_KEY ?? '';

/** Ollama server base URL.
 *  In dev, Vite proxies /ollama -> ollama.com to avoid CORS.
 *  In production, Vercel rewrites /ollama -> serverless function.
 *  Always use the proxy path; NEVER set this to an absolute URL in the frontend env. */
export const OLLAMA_BASE_URL = '/ollama';

/** Model name to use for AI evaluation / auto-correct. */
export const OLLAMA_MODEL = import.meta.env?.VITE_OLLAMA_MODEL ?? 'gemma4:31b';

/** Whether to skip the Authorization header (local Ollama doesn't need one). */
export const OLLAMA_SKIP_AUTH = import.meta.env?.VITE_OLLAMA_SKIP_AUTH === 'true';

/** Request timeouts in milliseconds. */
export const AI_EVAL_TIMEOUT_MS = 45_000;
export const AI_REWRITE_TIMEOUT_MS = 45_000;
export const AI_KEYWORD_TIMEOUT_MS = 45_000;
export const AI_CHAT_TIMEOUT_MS = 60_000;

/** Maximum number of undo snapshots to keep. */
export const UNDO_STACK_LIMIT = 20;

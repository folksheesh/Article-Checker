/** API key for Ollama (or OpenAI-compatible) AI service. */
export const OLLAMA_API_KEY = import.meta.env?.VITE_OLLAMA_API_KEY ?? '';

/** Ollama server base URL.
 *  In dev, Vite proxies /ollama -> ollama.com to avoid CORS.
 *  In production, Vercel rewrites /ollama -> serverless function.
 *  Always use the proxy path; NEVER set this to an absolute URL in the frontend env. */
export const OLLAMA_BASE_URL = '/ollama';

/** Model name to use for AI evaluation / auto-correct. */
export const OLLAMA_MODEL = import.meta.env?.VITE_OLLAMA_MODEL ?? 'llama3.2';

/** Whether to skip the Authorization header (local Ollama doesn't need one). */
export const OLLAMA_SKIP_AUTH = import.meta.env?.VITE_OLLAMA_SKIP_AUTH === 'true';

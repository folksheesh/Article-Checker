/** API key for Ollama (or OpenAI-compatible) AI service. */
export const OLLAMA_API_KEY = import.meta.env?.VITE_OLLAMA_API_KEY ?? '';

/** Ollama server base URL.
 *  In dev, Vite proxies /ollama -> localhost:11434 to avoid CORS.
 *  Override via VITE_OLLAMA_BASE_URL for production or custom hosts. */
export const OLLAMA_BASE_URL = import.meta.env?.VITE_OLLAMA_BASE_URL ?? '/ollama';

/** Model name to use for AI evaluation / auto-correct. */
export const OLLAMA_MODEL = import.meta.env?.VITE_OLLAMA_MODEL ?? 'llama3.2';

/** Whether to skip the Authorization header (local Ollama doesn't need one). */
export const OLLAMA_SKIP_AUTH = import.meta.env?.VITE_OLLAMA_SKIP_AUTH === 'true';

/** Fallback to Gemini API key if present (legacy). */
export const GEMINI_API_KEY = import.meta.env?.VITE_GEMINI_API_KEY ?? '';

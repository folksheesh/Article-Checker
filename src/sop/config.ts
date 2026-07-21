/** ===========================================================
 *  AI PROVIDER CONFIGURATION (Gemini — primary)
 *  =========================================================== */

/** Google Gemini API key. Used for AI evaluation, rewrite, chat, and keyword generation. */
export const GEMINI_API_KEY = import.meta.env?.VITE_GEMINI_API_KEY ?? 'AQ.Ab8RN6IFnE5BXOZouWeeDSXsQ0qIEVEOxBrdbJk2iyPqKWoHQg';

/** Gemini base URL. */
export const GEMINI_BASE_URL = import.meta.env?.VITE_GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';

/** Default model for Gemini. */
export const GEMINI_MODEL = import.meta.env?.VITE_GEMINI_MODEL ?? 'gemini-2.0-flash';

/** ===========================================================
 *  AI PROVIDER CONFIGURATION (OpenAI — fallback)
 *  =========================================================== */
 
/** OpenAI API key. Used for AI evaluation, rewrite, chat, and keyword generation. */
export const OPENAI_API_KEY = import.meta.env?.VITE_OPENAI_API_KEY ?? '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';

/** OpenAI base URL. Default is official OpenAI endpoint. */
export const OPENAI_BASE_URL = import.meta.env?.VITE_OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
 
/** Default model for OpenAI. */
export const OPENAI_MODEL = import.meta.env?.VITE_OPENAI_MODEL ?? 'gpt-4o-mini';

/** Model for premium / complex tasks. */
export const OPENAI_PREMIUM_MODEL = import.meta.env?.VITE_OPENAI_PREMIUM_MODEL ?? 'gpt-4o';

/** ===========================================================
 *  LEGACY OLLAMA CONFIGURATION (Fallback)
 *  =========================================================== */

/** API key for Ollama (or OpenAI-compatible) AI service. */
export const OLLAMA_API_KEY = import.meta.env?.VITE_OLLAMA_API_KEY ?? '';

/** Ollama server base URL. */
export const OLLAMA_BASE_URL = import.meta.env?.VITE_OLLAMA_BASE_URL ?? '/ollama';

/** Model name to use for AI evaluation / auto-correct. */
export const OLLAMA_MODEL = import.meta.env?.VITE_OLLAMA_MODEL ?? 'qwen2.5:14b';

/** Whether to skip the Authorization header (local Ollama doesn't need one). */
export const OLLAMA_SKIP_AUTH = import.meta.env?.VITE_OLLAMA_SKIP_AUTH === 'true';

/** ===========================================================
 *  AHRFFS KEYWORD ANALYTICS API
 *  =========================================================== */

/** Ahrefs API token. Required for keyword analytics dashboard. */
export const AHREFS_API_KEY = import.meta.env?.VITE_AHREFS_API_KEY ?? 'dgNQ6mJga_7eK-bG1S12WthNqIzrxDaZWAA26xvu';

/** Ahrefs API v3 base URL. */
export const AHREFS_BASE_URL = import.meta.env.DEV ? '/ahrefs-api' : (import.meta.env?.VITE_AHREFS_BASE_URL ?? 'https://api.ahrefs.com/v3');

/** Default country for keyword data. */
export const AHREFS_DEFAULT_COUNTRY = import.meta.env?.VITE_AHREFS_DEFAULT_COUNTRY ?? 'id';

/** ===========================================================
 *  AI CONTENT DETECTOR APIs
 *  =========================================================== */

/** GPTZero API key. Free tier 10,000 words/month. */
export const GPTZERO_API_KEY = import.meta.env?.VITE_GPTZERO_API_KEY ?? '';

/** GPTZero base URL. */
export const GPTZERO_BASE_URL = import.meta.env?.VITE_GPTZERO_BASE_URL ?? 'https://api.gptzero.me/v1';

/** Hugging Face access token. Used for DeepSeek via Hugging Face Router and detector inference. */
export const HUGGINGFACE_API_KEY = import.meta.env?.VITE_HUGGINGFACE_API_KEY ?? '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';

/** Hugging Face base URL for OpenAI-compatible chat completions. */
export const HUGGINGFACE_BASE_URL = import.meta.env?.VITE_HUGGINGFACE_BASE_URL ?? 'https://router.huggingface.co/v1';

/** Hugging Face inference model. Defaulted to DeepSeek via router. */
export const HUGGINGFACE_MODEL = import.meta.env?.VITE_HUGGINGFACE_MODEL ?? 'deepseek-ai/DeepSeek-V4-Flash:novita';

/** ===========================================================
 *  PLAGIARISM CHECKER APIs
 *  =========================================================== */

/** Provider for plagiarism checker. Options: 'copyleaks' | 'rapidapi'. */
export const PLAGIARISM_PROVIDER = import.meta.env?.VITE_PLAGIARISM_PROVIDER ?? 'copyleaks';

/** Copyleaks API key. */
export const COPYLEAKS_API_KEY = import.meta.env?.VITE_COPYLEAKS_API_KEY ?? '';

/** Copyleaks base URL. */
export const COPYLEAKS_BASE_URL = import.meta.env?.VITE_COPYLEAKS_BASE_URL ?? 'https://api.copyleaks.com';

/** RapidAPI key for plagiarism checker. */
export const RAPIDAPI_KEY = import.meta.env?.VITE_RAPIDAPI_KEY ?? '020bb894ecmshd7789544617fa20p151db6jsn0b9f610c97c9';

/** RapidAPI plagiarism host. */
export const RAPIDAPI_PLAGIARISM_HOST = import.meta.env?.VITE_RAPIDAPI_PLAGIARISM_HOST ?? 'plagiarism-checker-and-auto-citation-generator-multi-lingual.p.rapidapi.com';

/** ===========================================================
 *  REQUEST TIMEOUTS
 *  =========================================================== */

/** Request timeouts in milliseconds. */
export const AI_EVAL_TIMEOUT_MS = 45_000;
export const AI_REWRITE_TIMEOUT_MS = 45_000;
export const AI_KEYWORD_TIMEOUT_MS = 45_000;
export const AI_CHAT_TIMEOUT_MS = 60_000;
export const AI_DETECTOR_TIMEOUT_MS = 30_000;
export const PLAGIARISM_TIMEOUT_MS = 60_000;
export const AHREFS_TIMEOUT_MS = 30_000;

/** Maximum number of undo snapshots to keep. */
export const UNDO_STACK_LIMIT = 20;

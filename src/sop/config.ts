// ===========================================================
// AI PROVIDER CONFIGURATION (Gemini — primary)
// ===========================================================

// Gemini base URL.
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Default model for Gemini.
export const GEMINI_MODEL = 'gemini-2.0-flash';

// ===========================================================
// AI PROVIDER CONFIGURATION (OpenAI — fallback)
// ===========================================================

// OpenAI base URL. Default is official OpenAI endpoint.
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
 
// Default model for OpenAI.
export const OPENAI_MODEL = 'gpt-4o-mini';

// Model for premium / complex tasks.
export const OPENAI_PREMIUM_MODEL = 'gpt-4o';

// ===========================================================
// LEGACY OLLAMA CONFIGURATION (Fallback)
// ===========================================================

// Ollama server base URL.
export const OLLAMA_BASE_URL = '/ollama';

// Model name to use for AI evaluation / auto-correct.
export const OLLAMA_MODEL = 'qwen2.5:14b';

// Whether to skip the Authorization header (local Ollama doesn't need one).
export const OLLAMA_SKIP_AUTH = false;

// ===========================================================
// AHRFFS KEYWORD ANALYTICS API
// ===========================================================

// Ahrefs API v3 base URL.
export const AHREFS_BASE_URL = 'https://api.ahrefs.com/v3';

// Default country for keyword data.
export const AHREFS_DEFAULT_COUNTRY = 'id';

// ===========================================================
// AI CONTENT DETECTOR APIs
// ===========================================================

// GPTZero base URL.
export const GPTZERO_BASE_URL = 'https://api.gptzero.me/v1';

// Hugging Face base URL for OpenAI-compatible chat completions.
export const HUGGINGFACE_BASE_URL = 'https://router.huggingface.co/v1';

// Hugging Face inference model. Defaulted to DeepSeek via router.
export const HUGGINGFACE_MODEL = 'deepseek-ai/DeepSeek-V4-Flash:novita';

// ===========================================================
// PLAGIARISM CHECKER APIs
// ===========================================================

// Provider for plagiarism checker. Options: 'copyleaks' | 'rapidapi'.
export const PLAGIARISM_PROVIDER = 'copyleaks';

// Copyleaks base URL.
export const COPYLEAKS_BASE_URL = 'https://api.copyleaks.com';

// RapidAPI plagiarism host.
export const RAPIDAPI_PLAGIARISM_HOST = 'plagiarism-checker-and-auto-citation-generator-multi-lingual.p.rapidapi.com';

// ===========================================================
// REQUEST TIMEOUTS
// ===========================================================

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

/** ===========================================================
 *  DEVELOPMENT CONFIG
 *  =========================================================== */

export const IS_DEV = import.meta.env?.DEV === true;

# Conversation Summary

## Session: Article Checker Bug Fixing + UI Audit

### Completed

1. **Incremental re-check system** — AI checking now only re-evaluates failed items instead of all items
2. **Auto-correct fix** — `extractActualCorrection` strips AI explanatory text from corrections
3. **Nested button fix** — Fixed nested `<button>` issue in auto-correct UI
4. **Graphify run** — Knowledge graph generated for the project
5. **Webapp-testing + frontend-design audit** — Comprehensive audit with 10 findings
6. **UI improvements (7 items)**:
   - amber/navy color palette on checklist cards
   - Score number size reduced to `text-2xl`
   - Accent left borders on cards
   - Numeric badges on sidebar
   - Card-specific background colors
   - Lucide icons per metric
   - Animated donut + count-up in score rings
7. **No dark mode** — confirmed by user, not to be implemented
8. **AI eval prompt v2 — CTA & weak words**:
   - **CTA false negative** → replaced with full criteria: 3 pola validasi (ajakan langsung, peringatan+solusi, manfaat), langkah eksplisit, contoh valid (2 & 3), peringatan jangan nilai dari struktur kalimat
   - **"usahanya" → "hanya" false match** → added whole-word instruction + counter-examples ("usahanya" jangan deteksi "hanya", "dimungkinkan" jangan deteksi "mungkin")
9. **Default text selection color** — removed `.editor-surface ::selection` (was `rgba(239,68,68,0.3)` → red). Now uses browser default blue. Red only for `.issue-highlight` marks.
10. **User-friendly AI error handling**:
    - New `src/sop/errorHandling.ts` — `classifyAiError()` classifies errors into 5 types (rate_limit, quota, timeout, network, unknown) with user-friendly Indonesian messages; `logAiError()` logs technical details to console
    - New `src/sop/AiErrorContext.tsx` — `AiErrorProvider` wrapping the app, `useAiError()` hook, `AiErrorFallback` component with retry button + dismiss
    - All AI call sites updated: `runAnalysis`, `handleDetectAI`, `handleCheckPlagiarism`, `handleAutoCorrect`, `handleGenerateMetaDesc`, `handleAnalyzeKeywords`
    - 3 inline error banners replaced with `AiErrorFallback` (SOP AI eval, AI Detector, Plagiarism)
    - Global auto-correct error banner added
    - API consumers (aiEvaluate, aiDetector, plagiarism) now classify + log errors before returning
    - Raw error messages no longer shown to users; replaced with friendly, actionable Indonesian messages
    - `aiError` state variable removed (replaced by context per-feature error state)
11. **Bug fix: "Periksa" button not clickable**:
    - **Root cause:** 4 loading states (`isAnalyzing`, `aiLoading`, `aiDetectorLoading`, `plagiarismLoading`) set/reset inside sub-functions — if any sub-function's `finally` failed to reset (signal abort, unexpected error, race condition), button stayed disabled permanently
    - `React useState` updates are batched — can be delayed by 1+ frames, creating a window where the disabled attribute evaluates stale state
    - **Fix:** Added `checkingRef` (`useRef(false)`) — synchronous guard that is NOT subject to React state batching
    - `onClick` wrapper checks `checkingRef.current` (immediate return if true), sets true before `runAllChecks()`, resets false in `finally`
    - `disabled` prop simplified to `checkingRef.current || !article.trim()`
    - Loading text also uses `checkingRef.current`
    - `runAnalysis.finally` and `runAllChecks.finally` still also reset the useState booleans (for spinner UI in results tabs) but they no longer affect button behavior
12. **Bug fix: Live score always 100**:
    - **Root cause:** AI prompt had sub-score schema but NO scoring rubrics — AI defaulted to safe 100s
    - **Fix:** Added detailed SCORING RUBRIC for each category (SEO, Structure, Intent, Tone) with explicit penalty per violation, dimulai dari 100, kurangi sesuai pelanggaran
    - Skor 100 HANYA jika SEMUA kriteria terpenuhi tanpa satupun pelanggaran
    - Added anomaly detection: `console.warn` when all 4 sub-scores are 100

### Active: Bug Investigation — Article formatting breaks with keyword insertion

**Reported:** Inserting AI-generated keywords corrupts hyperlinks, spacing, and paragraph structure.

**Findings:**
- The keyword popup "Terapkan" button (`applySelectedKeywords`) only updates the `keyword` **metadata field** — it does NOT modify the article body
- Article modification occurs only when user clicks **"Auto Correct"** on SOP checks (e.g., "Judul tidak mengandung keyword", "Tidak ada CTA")
- Deterministic functions in `src/sop/autoRevise.ts` modify the article using string manipulation:
  - `replaceTitle` / `replaceLead` / `replaceBody` — regex replacements on markdown text
  - `shortenLeadDeterministic` — splits by spaces and rejoins, breaking `[text](url)` links
  - `ensureKeywordInTitle` — string prepend/insert into title
- These functions assume plain text, not markdown with links, so hyperlinks get corrupted

**Next steps needed:**
- Fix the deterministic functions to preserve markdown link syntax during rewrites
- Or ensure keyword is inserted into article body without running through auto-revise

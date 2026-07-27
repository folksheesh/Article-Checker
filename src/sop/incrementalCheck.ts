import type { CheckResult, ArticleInput, AiEvaluationOutput, SubScores, RuleId } from './types';
import type { AIDetectionResult } from './apis/aiDetector';
import { callChatCompletion } from './apis/openai';
import { stripImages } from './images';

export interface ParagraphBlock {
  index: number;
  text: string;
  hash: string;
  isHeading: boolean;
  headingLevel: number;
}

export interface ParagraphContext {
  title: string;
  sectionTitle: string;
  prevText: string;
  nextText: string;
}

export interface IncrementalState {
  paragraphs: ParagraphBlock[];
  cache: Map<string, { results: CheckResult[]; timestamp: number }>;
  lastArticle: string;
}

export interface RecheckCacheEntry {
  articleHash: string;
  paragraphs: ParagraphBlock[];
  paragraphResults: Record<string, CheckResult[]>;
  fullResults: CheckResult[];
  subScores: SubScores;
  bestNextMove: string;
  aiDetectorParagraphResults?: Record<string, AIDetectionResult['sentences']>;
  fullAiDetectorResult?: AIDetectionResult | null;
}

export interface IncrementalRecheckResult {
  results: CheckResult[];
  subScores: SubScores;
  bestNextMove: string;
  changedCount: number;
  totalCount: number;
  usedCache: boolean;
}

function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function computeArticleHash(article: string): string {
  return hashString(article);
}

export function splitIntoParagraphs(article: string): ParagraphBlock[] {
  const lines = article.split('\n');
  const blocks: ParagraphBlock[] = [];
  let currentText = '';
  let lineIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed && currentText) {
      const isHeading = /^#{1,3}\s/.test(currentText.trim());
      const headingLevel = isHeading ? (currentText.trim().match(/^#+/)?.[0].length || 0) : 0;
      blocks.push({
        index: blocks.length,
        text: currentText.trim(),
        hash: hashString(currentText.trim()),
        isHeading,
        headingLevel,
      });
      currentText = '';
    } else if (trimmed) {
      currentText += (currentText ? '\n' : '') + trimmed;
    }
    lineIndex++;
  }

  if (currentText.trim()) {
    const isHeading = /^#{1,3}\s/.test(currentText.trim());
    const headingLevel = isHeading ? (currentText.trim().match(/^#+/)?.[0].length || 0) : 0;
    blocks.push({
      index: blocks.length,
      text: currentText.trim(),
      hash: hashString(currentText.trim()),
      isHeading,
      headingLevel,
    });
  }

  return blocks;
}

export function detectChangedParagraphs(
  oldBlocks: ParagraphBlock[],
  newBlocks: ParagraphBlock[],
): { changedIndices: number[]; unchangedBlocks: ParagraphBlock[]; changedBlocks: ParagraphBlock[] } {
  const changedIndices: number[] = [];
  const unchangedBlocks: ParagraphBlock[] = [];
  const changedBlocks: ParagraphBlock[] = [];

  const maxLen = Math.max(oldBlocks.length, newBlocks.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= oldBlocks.length || i >= newBlocks.length) {
      if (i < newBlocks.length) {
        changedIndices.push(i);
        changedBlocks.push(newBlocks[i]);
      }
      continue;
    }
    if (oldBlocks[i].hash !== newBlocks[i].hash) {
      changedIndices.push(i);
      changedBlocks.push(newBlocks[i]);
    } else {
      unchangedBlocks.push(newBlocks[i]);
    }
  }

  return { changedIndices, unchangedBlocks, changedBlocks };
}

export function getParagraphContext(
  blocks: ParagraphBlock[],
  index: number,
): ParagraphContext {
  let sectionTitle = '';
  let prevText = '';
  let nextText = '';

  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i].isHeading) {
      sectionTitle = blocks[i].text.replace(/^#+\s*/, '');
      break;
    }
    if (!prevText && !blocks[i].isHeading) {
      prevText = blocks[i].text;
    }
  }

  for (let i = index + 1; i < blocks.length; i++) {
    if (!nextText && !blocks[i].isHeading) {
      nextText = blocks[i].text;
      break;
    }
  }

  return { title: '', sectionTitle, prevText, nextText };
}

export function buildInitialState(): IncrementalState {
  return {
    paragraphs: [],
    cache: new Map(),
    lastArticle: '',
  };
}

export function buildIncrementalPrompt(
  changedBlocks: ParagraphBlock[],
  contexts: ParagraphContext[],
  keyword: string,
  metaTitle: string,
  metaDesc: string,
): string {
  const blocksWithContext = changedBlocks.map((block, i) => {
    const ctx = contexts[i] || { title: '', sectionTitle: '', prevText: '', nextText: '' };
    return `
--- PARAGRAF ${block.index + 1} ---
${ctx.sectionTitle ? `Bagian: ${ctx.sectionTitle}` : ''}
${ctx.prevText ? `Paragraf sebelumnya: ${ctx.prevText}` : ''}
${ctx.nextText ? `Paragraf setelahnya: ${ctx.nextText}` : ''}
ISI:
${block.text}
`;
  }).join('\n');

  return `Anda adalah asisten pengecekan inkremental artikel hukum Indonesia.
Periksa setiap paragraf berikut untuk masalah-masalah ini SAJA:

1. Typo ejaan kata per kata — cari kata yang salah eja
2. Weak words: "mungkin", "saja", "hanya"
3. Kapitalisasi salah (awal kalimat, proper noun, "Anda")
4. Nada bahasa tidak profesional

JANGAN evaluasi hal-hal yang membutuhkan konteks seluruh artikel seperti:
- Legal validity / regulasi (ini akan dicek saat audit final)
- CTA (ini akan dicek saat audit final)
- Alur koherensi antar paragraf (ini akan dicek saat audit final)

Untuk setiap paragraf yang diperiksa, keluarkan hasil dalam format JSON berikut:
{
  "paragraph_results": [
    {
      "paragraph_index": ${changedBlocks[0]?.index ?? 0},
      "results": [
        {
          "passed": false,
          "reason": "Alasan singkat (max 100 karakter)",
          "category": "Error",
          "suggested_fix": "Perbaikan langsung",
          "target_highlight": {
            "exact_word": "kata_bermasalah",
            "sentence_context": "kalimat lengkap yang mengandung masalah"
          },
          "point_penalty": 10,
          "auto_correct_button": true,
          "has_ignore_button": true
        }
      ]
    }
  ]
}

Jika tidak ada masalah: "results": []

Keyword: ${keyword || '-'}
Meta Title: ${metaTitle || '-'}
Meta Desc: ${metaDesc || '-'}

Paragraf yang diperiksa:
${blocksWithContext}`;
}

export function parseIncrementalResponse(
  content: string,
  _changedBlocks: ParagraphBlock[],
): CheckResult[] {
  try {
    const parsed = JSON.parse(content);
    const allResults: CheckResult[] = [];

    const paragraphResults = parsed.paragraph_results || [];
    for (const pr of paragraphResults) {
      const pIndex = pr.paragraph_index ?? 0;
      const results = pr.results || [];
      for (const r of results) {
        const passed = Boolean(r.passed);
        const cat = r.category || (passed ? 'passed' : 'Error');
        allResults.push({
          id: (1000 + pIndex * 10 + allResults.length) as RuleId,
          question: `Pengecekan paragraf ${pIndex + 1}`,
          status: passed ? 'passed' : (cat === 'Information' ? 'info' : 'failed'),
          passed,
          reason: r.reason || '-',
          problematic_text: r.target_highlight?.exact_word || '',
          source: 'ai' as const,
          aiConfidence: r.score || (passed ? 100 : 70),
          category: cat === 'Information' ? 'Information' : cat === 'Error' ? 'Error' : undefined,
          suggested_fix: r.suggested_fix || '',
          target_highlight: r.target_highlight ? {
            exact_word: r.target_highlight.exact_word || null,
            sentence_context: r.target_highlight.sentence_context || '',
            start_index: r.target_highlight.start_index != null ? Number(r.target_highlight.start_index) : null,
            end_index: r.target_highlight.end_index != null ? Number(r.target_highlight.end_index) : null,
          } : undefined,
          point_penalty: r.point_penalty != null ? Number(r.point_penalty) : 10,
          has_ignore_button: r.has_ignore_button !== false,
          auto_correct_button: Boolean(r.auto_correct_button),
        });
      }
    }

    return allResults;
  } catch {
    return [];
  }
}

export async function evaluateChangedParagraphs(
  input: ArticleInput,
  changedBlocks: ParagraphBlock[],
  contexts: ParagraphContext[],
  apiKey = '',
  signal?: AbortSignal,
): Promise<CheckResult[]> {
  if (changedBlocks.length === 0) return [];

  const cleanKeyword = stripImages(input.keyword || '');
  const cleanMetaTitle = stripImages(input.metaTitle || '');
  const cleanMetaDesc = stripImages(input.metaDesc || '');

  const systemPrompt = buildIncrementalPrompt(
    changedBlocks,
    contexts,
    cleanKeyword,
    cleanMetaTitle,
    cleanMetaDesc,
  );

  const userPrompt = changedBlocks.map((b) => b.text).join('\n\n');

  try {
    const { content } = await callChatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      timeoutMs: 15000,
      signal,
      apiKey,
    });

    return parseIncrementalResponse(content, changedBlocks);
  } catch {
    return [];
  }
}

export function buildCacheKey(paragraphHash: string, keyword: string): string {
  return `${paragraphHash}_${hashString(keyword || '')}`;
}

export function mergeIncrementalResults(
  cachedResults: CheckResult[],
  newResults: CheckResult[],
): CheckResult[] {
  const seenIds = new Set<number>();
  const merged: CheckResult[] = [];

  for (const r of [...cachedResults, ...newResults]) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id);
      merged.push(r);
    }
  }

  return merged;
}

export function buildRecheckCacheFromFullResults(
  output: AiEvaluationOutput,
  paragraphs: ParagraphBlock[],
  articleHashOverride?: string,
): RecheckCacheEntry {
  const articleHash = articleHashOverride || computeArticleHash(paragraphs.map((p) => p.text).join('\n\n'));
  const paragraphResults: Record<string, CheckResult[]> = {};
  const fullResults = output.results;

  // Assign each result to paragraphs by matching problematic_text
  for (const result of fullResults) {
    const text = result.problematic_text || '';
    if (!text) continue;
    for (const p of paragraphs) {
      if (p.text.includes(text)) {
        if (!paragraphResults[p.hash]) paragraphResults[p.hash] = [];
        paragraphResults[p.hash].push(result);
        break;
      }
    }
  }

  return {
    articleHash,
    paragraphs,
    paragraphResults,
    fullResults,
    subScores: output.subScores,
    bestNextMove: output.bestNextMove,
  };
}

export function buildRecheckCacheFromAiDetector(
  result: AIDetectionResult,
  paragraphs: ParagraphBlock[],
): Pick<RecheckCacheEntry, 'aiDetectorParagraphResults' | 'fullAiDetectorResult'> {
  const aiDetectorParagraphResults: Record<string, AIDetectionResult['sentences']> = {};
  const sentences = result.sentences || [];

  for (const p of paragraphs) {
    const pSentences = sentences.filter((s: { text: string; ai_probability: number }) => p.text.includes(s.text));
    if (pSentences.length > 0) {
      aiDetectorParagraphResults[p.hash] = pSentences;
    }
  }

  return {
    aiDetectorParagraphResults,
    fullAiDetectorResult: result,
  };
}

export async function runIncrementalRecheck(
  input: ArticleInput,
  currentArticle: string,
  _currentKeyword: string,
  _currentMetaTitle: string,
  _currentMetaDesc: string,
  cachedEntry: RecheckCacheEntry | null,
  apiKey = '',
  signal?: AbortSignal,
): Promise<IncrementalRecheckResult | null> {
  const newParagraphs = splitIntoParagraphs(currentArticle);
  const currentHash = computeArticleHash(currentArticle);

  if (!cachedEntry) return null;

  // No changes at all — return full cached results
  if (cachedEntry.articleHash === currentHash) {
    return {
      results: cachedEntry.fullResults,
      subScores: cachedEntry.subScores,
      bestNextMove: cachedEntry.bestNextMove,
      changedCount: 0,
      totalCount: newParagraphs.length,
      usedCache: true,
    };
  }

  const oldParagraphs = cachedEntry.paragraphs;
  const { changedBlocks, unchangedBlocks } = detectChangedParagraphs(oldParagraphs, newParagraphs);

  if (changedBlocks.length === 0) {
    return {
      results: cachedEntry.fullResults,
      subScores: cachedEntry.subScores,
      bestNextMove: cachedEntry.bestNextMove,
      changedCount: 0,
      totalCount: newParagraphs.length,
      usedCache: true,
    };
  }

  // Evaluate only the changed paragraphs with context
  const contexts = changedBlocks.map((b) => getParagraphContext(newParagraphs, b.index));
  const newResults = await evaluateChangedParagraphs(
    input,
    changedBlocks,
    contexts,
    apiKey,
    signal,
  );

  if (signal?.aborted) return null;

  // Build merged results: cached results from unchanged paragraphs + new results
  const mergedResults: CheckResult[] = [];
  const seenHashes = new Set<string>();

  // Add cached results from unchanged paragraphs
  for (const block of unchangedBlocks) {
    const cached = cachedEntry.paragraphResults[block.hash];
    if (cached) {
      for (const r of cached) {
        if (!seenHashes.has(`${r.id}`)) {
          seenHashes.add(`${r.id}`);
          mergedResults.push(r);
        }
      }
    }
  }

  // Add new results for changed paragraphs
  for (const r of newResults) {
    if (!seenHashes.has(`${r.id}`)) {
      seenHashes.add(`${r.id}`);
      mergedResults.push(r);
    }
  }

  // Add cached article-level results (CTA, flow, opening/closing, legal)
  for (const r of cachedEntry.fullResults) {
    if (!seenHashes.has(`${r.id}`)) {
      seenHashes.add(`${r.id}`);
      mergedResults.push(r);
    }
  }

  // Build updated paragraph cache
  const updatedParagraphResults: Record<string, CheckResult[]> = { ...cachedEntry.paragraphResults };
  for (const block of changedBlocks) {
    const blockResults = newResults.filter(
      (r) => r.id >= 1000 + block.index * 10 && r.id < 1000 + (block.index + 1) * 10,
    );
    updatedParagraphResults[block.hash] = blockResults;
  }
  // Remove entries for deleted paragraphs
  for (const oldP of oldParagraphs) {
    if (!newParagraphs.some((np) => np.hash === oldP.hash)) {
      delete updatedParagraphResults[oldP.hash];
    }
  }

  return {
    results: mergedResults,
    subScores: cachedEntry.subScores,
    bestNextMove: cachedEntry.bestNextMove,
    changedCount: changedBlocks.length,
    totalCount: newParagraphs.length,
    usedCache: false,
  };
}

export function mergeAiDetectorIncremental(
  cachedEntry: RecheckCacheEntry | null,
  newParagraphs: ParagraphBlock[],
): { sentences: AIDetectionResult['sentences'] } | null {
  if (!cachedEntry?.aiDetectorParagraphResults) return null;

  const mergedSentences: AIDetectionResult['sentences'] = [];

  for (const p of newParagraphs) {
    const cached = cachedEntry.aiDetectorParagraphResults[p.hash];
    if (cached) {
      mergedSentences.push(...cached);
    }
  }

  return { sentences: mergedSentences };
}

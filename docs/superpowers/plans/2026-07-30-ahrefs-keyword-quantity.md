# Ahrefs Keyword Quantity Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Increase Ahrefs keyword recommendations from under 5 to 10+ by adding `related-terms` to the AI flow.

**Architecture:** Add a single `related-terms` API call in the AI keyword flow using top 5 AI-generated keywords as seeds, then merge with existing `overview` results and deduplicate.

**Tech Stack:** TypeScript, React, Ahrefs API v3

## Global Constraints

- Follow existing code style (no comments, same patterns)
- Use existing `fetchAhrefsRelatedTerms` and `fetchAhrefsKeywordMetrics` functions
- No UI changes — table already renders dynamic count
- Keep existing error handling patterns (mock fallback on failure)

---

### Task 1: Make `fetchAhrefsRelatedTerms` limit configurable

**Files:**
- Modify: `src/sop/apis/ahrefs.ts:96-102`

**Interfaces:**
- Consumes: existing `fetchAhrefsRelatedTerms` signature
- Produces: updated signature with optional `limit` param

- [ ] **Step 1: Update `fetchAhrefsRelatedTerms` to accept optional limit**

Change from:
```typescript
export async function fetchAhrefsRelatedTerms(
  keywords: string[],
  country = AHREFS_DEFAULT_COUNTRY,
  apiKey = '',
): Promise<AhrefsKeywordResult> {
  return ahrefsFetch('related-terms', keywords, country, apiKey, { limit: '20' });
}
```

To:
```typescript
export async function fetchAhrefsRelatedTerms(
  keywords: string[],
  country = AHREFS_DEFAULT_COUNTRY,
  apiKey = '',
  limit = 30,
): Promise<AhrefsKeywordResult> {
  return ahrefsFetch('related-terms', keywords, country, apiKey, { limit: String(limit) });
}
```

- [ ] **Step 2: Verify the file still parses**

Run: `npx tsc --noEmit src/sop/apis/ahrefs.ts`

---

### Task 2: Add related-terms call to AI keyword flow

**Files:**
- Modify: `src/App.tsx:2005-2034`

**Interfaces:**
- Consumes: `fetchAhrefsRelatedTerms(keywords, country, apiKey, limit)` from Task 1
- Produces: merged keyword results displayed in the existing table

- [ ] **Step 1: Add related-terms call after AI keywords are generated**

Replace the current block (lines ~2005-2034):

```typescript
if (aiKeywords.length > 0) {
  const topKeywords = aiKeywords.slice(0, 20);
  keywords = topKeywords;

  const results: AhrefsKeywordMetric[] = [];
  let ahrefsError = '';

  const batch1 = topKeywords.slice(0, 10);
  const batch2 = topKeywords.slice(10, 20);

  const r1 = await fetchAhrefsKeywordMetrics(batch1, 'id', AHREFS_API_KEY);
  if (r1.data.length > 0) results.push(...r1.data);
  if (r1.error) ahrefsError = r1.error;

  if (batch2.length > 0) {
    const r2 = await fetchAhrefsKeywordMetrics(batch2, 'id', AHREFS_API_KEY);
    if (r2.data.length > 0) results.push(...r2.data);
    if (r2.error && !ahrefsError) ahrefsError = r2.error;
  }

  if (results.length > 0) {
    setAhrefsMetrics(results);
  } else {
    setAhrefsMetrics(generateMockAhrefsMetrics(topKeywords));
    if (ahrefsError.includes('API key') || ahrefsError.includes('tidak dikonfigurasi')) {
      setKwGenError('Ahrefs API key tidak dikonfigurasi. Menampilkan data simulasi.');
    }
  }
  setSelectedKeywords(new Set());
```

With:

```typescript
if (aiKeywords.length > 0) {
  const topKeywords = aiKeywords.slice(0, 30);
  keywords = topKeywords;

  const results: AhrefsKeywordMetric[] = [];
  let ahrefsError = '';

  // Step A: Get related terms from top 5 AI keywords (yields keywords that ARE in Ahrefs)
  const seedKws = topKeywords.slice(0, 5);
  const related = await fetchAhrefsRelatedTerms(seedKws, 'id', AHREFS_API_KEY, 30);
  if (related.data.length > 0) results.push(...related.data);
  if (related.error && !ahrefsError) ahrefsError = related.error;

  // Step B: Check top 30 AI keywords against overview for metrics
  const batch1 = topKeywords.slice(0, 10);
  const batch2 = topKeywords.slice(10, 20);
  const batch3 = topKeywords.slice(20, 30);

  const r1 = await fetchAhrefsKeywordMetrics(batch1, 'id', AHREFS_API_KEY);
  if (r1.data.length > 0) results.push(...r1.data);
  if (r1.error && !ahrefsError) ahrefsError = r1.error;

  const r2 = await fetchAhrefsKeywordMetrics(batch2, 'id', AHREFS_API_KEY);
  if (r2.data.length > 0) results.push(...r2.data);
  if (r2.error && !ahrefsError) ahrefsError = r2.error;

  if (batch3.length > 0) {
    const r3 = await fetchAhrefsKeywordMetrics(batch3, 'id', AHREFS_API_KEY);
    if (r3.data.length > 0) results.push(...r3.data);
    if (r3.error && !ahrefsError) ahrefsError = r3.error;
  }

  // Step C: Deduplicate by keyword (keep first occurrence)
  const seen = new Set<string>();
  const deduped: AhrefsKeywordMetric[] = [];
  for (const m of results) {
    if (!seen.has(m.keyword.toLowerCase())) {
      seen.add(m.keyword.toLowerCase());
      deduped.push(m);
    }
  }

  // Step D: Sort by relevance to article, then by volume desc
  const articleText = stripImages(article);
  deduped.sort((a, b) => {
    const relDiff = computeRelevance(b.keyword, articleText) - computeRelevance(a.keyword, articleText);
    if (relDiff !== 0) return relDiff;
    return b.searchVolume - a.searchVolume;
  });

  if (deduped.length > 0) {
    setAhrefsMetrics(deduped);
  } else {
    setAhrefsMetrics(generateMockAhrefsMetrics(topKeywords));
    if (ahrefsError.includes('API key') || ahrefsError.includes('tidak dikonfigurasi')) {
      setKwGenError('Ahrefs API key tidak dikonfigurasi. Menampilkan data simulasi.');
    }
  }
  setSelectedKeywords(new Set());
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/App.tsx`

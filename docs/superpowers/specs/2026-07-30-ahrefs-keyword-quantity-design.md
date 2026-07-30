# Increase Ahrefs Keyword Recommendations Quantity

## Problem
AI flow sends 20 AI-generated keywords to Ahrefs `overview` endpoint, which only returns metrics for keywords that exist in Ahrefs' database. For niche legal content, often only 3-5 matches are returned (under 5 recommendations).

## Solution
Add a `related-terms` call to the AI flow. The `related-terms` endpoint returns keywords that ARE tracked by Ahrefs, unlike `overview` which only confirms what you feed it.

## Flow (AI source)

1. AI generates 100+ keywords (unchanged)
2. Take top 30 keywords
3. Top 5 keywords → `fetchAhrefsRelatedTerms(limit: 30)` → ~20-30 keyword suggestions with metrics from Ahrefs
4. Top 30 keywords → `fetchAhrefsKeywordMetrics()` (3 batches of 10) → metrics for keywords that exist in Ahrefs (~5-10 more)
5. Combine both results, deduplicate by keyword
6. Calculate relevance score against article text
7. Sort by relevance desc → volume desc
8. Display all results (target: 10+ recommendations)

## Changes

### `src/sop/apis/ahrefs.ts`
- Make `fetchAhrefsRelatedTerms` accept optional limit parameter (default 30)

### `src/App.tsx` — `handleAnalyzeKeywords`
- After AI keywords are generated (line ~2005), add related-terms call with top 5 AI keywords
- Merge with overview results, deduplicate, re-sort by relevance
- No UI changes needed — table rendering already handles dynamic count

## Trade-offs
- +1 API call per analysis (related-terms with 5 seeds = 1 call) — negligible cost
- Related terms may include less-relevant keywords — mitigated by relevance score sorting
- Existing overview call preserved — ensures AI-generated keywords that DO exist in Ahrefs still get metrics

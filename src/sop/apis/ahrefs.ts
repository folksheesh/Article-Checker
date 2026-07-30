import { AHREFS_API_KEY, AHREFS_BASE_URL, AHREFS_DEFAULT_COUNTRY, AHREFS_TIMEOUT_MS } from '../config';

const SELECT_FIELDS = 'keyword,volume,difficulty,cpc,traffic_potential,parent_topic';

function buildAhrefsUrl(endpoint: string, keywords: string[], country: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  params.set('keywords', keywords.map((k) => k.trim()).join(','));
  params.set('country', country);
  params.set('select', SELECT_FIELDS);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      params.set(k, v);
    }
  }
  const qs = params.toString();
  if (import.meta.env.DEV) {
    return `${AHREFS_BASE_URL}/${endpoint}?${qs}`;
  }
  return `/ahrefs-proxy.php?endpoint=${endpoint}&${qs}`;
}

export interface AhrefsKeywordMetric {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number;
  cpc: number;
  trafficPotential: number;
  parentTopic?: string;
}

export interface AhrefsKeywordResult {
  data: AhrefsKeywordMetric[];
  error?: string;
}

function parseAhrefsResponse(json: any): AhrefsKeywordMetric[] {
  const results = json?.keywords;
  if (!Array.isArray(results)) return [];
  return results.map((item: any) => ({
    keyword: item.keyword || '',
    searchVolume: Number(item.volume ?? 0) || 0,
    keywordDifficulty: Number(item.difficulty ?? 0) || 0,
    cpc: (Number(item.cpc ?? 0) || 0) / 100,
    trafficPotential: Number(item.traffic_potential ?? 0) || 0,
    parentTopic: item.parent_topic || undefined,
  }));
}

async function ahrefsFetch(endpoint: string, keywords: string[], country: string, apiKey: string, extra?: Record<string, string>): Promise<AhrefsKeywordResult> {
  const token = (apiKey ?? '').trim() || (AHREFS_API_KEY ?? '').trim();
  if (!token) {
    return { data: [], error: 'API key Ahrefs belum dikonfigurasi.' };
  }
  if (keywords.length === 0) {
    return { data: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AHREFS_TIMEOUT_MS);

  try {
    const url = buildAhrefsUrl(endpoint, keywords, country, extra);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ahrefs API error: ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }

    const json = await response.json();
    const data = parseAhrefsResponse(json);
    return { data };
  } catch (err) {
    clearTimeout(timeout);
    console.error('Ahrefs API error:', err);
    return {
      data: [],
      error: err instanceof Error ? err.message : 'Gagal mengambil data Ahrefs.',
    };
  }
}

/**
 * Fetch related keyword suggestions from Ahrefs related-terms endpoint.
 * Returns related keywords with metrics (volume, KD, CPC, etc.)
 */
export async function fetchAhrefsRelatedTerms(
  keywords: string[],
  country = AHREFS_DEFAULT_COUNTRY,
  apiKey = '',
  limit = 30,
): Promise<AhrefsKeywordResult> {
  return ahrefsFetch('related-terms', keywords, country, apiKey, { limit: String(limit) });
}

/**
 * Fetch keyword metrics from Ahrefs overview endpoint.
 */
export async function fetchAhrefsKeywordMetrics(
  keywords: string[],
  country = AHREFS_DEFAULT_COUNTRY,
  apiKey = '',
): Promise<AhrefsKeywordResult> {
  return ahrefsFetch('overview', keywords, country, apiKey);
}

/**
 * Generate mock Ahrefs metrics for demo/testing when API key is missing.
 */
export function generateMockAhrefsMetrics(keywords: string[]): AhrefsKeywordMetric[] {
  return keywords.map((keyword) => {
    const base = keyword.length;
    return {
      keyword,
      searchVolume: Math.max(100, base * 120 + Math.floor(Math.random() * 500)),
      keywordDifficulty: Math.min(100, Math.max(5, base * 3 + Math.floor(Math.random() * 40))),
      cpc: parseFloat((Math.max(0.1, base * 0.05 + Math.random() * 2).toFixed(2))),
      trafficPotential: Math.max(100, base * 200 + Math.floor(Math.random() * 1000)),
      parentTopic: keyword.split(' ')[0],
    };
  });
}

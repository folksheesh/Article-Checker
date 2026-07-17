import { AHREFS_API_KEY, AHREFS_BASE_URL, AHREFS_DEFAULT_COUNTRY, AHREFS_TIMEOUT_MS } from '../config';

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

/**
 * Fetch keyword metrics from Ahrefs API v3.
 * Reference: https://api.ahrefs.com/v3/keywords-explorer/keywords-overview
 */
export async function fetchAhrefsKeywordMetrics(
  keywords: string[],
  country = AHREFS_DEFAULT_COUNTRY,
  apiKey = '',
): Promise<AhrefsKeywordResult> {
  const token = (apiKey ?? '').trim() || AHREFS_API_KEY.trim();
  if (!token) {
    return { data: [], error: 'API key Ahrefs belum dikonfigurasi.' };
  }
  if (keywords.length === 0) {
    return { data: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AHREFS_TIMEOUT_MS);

  try {
    const params = new URLSearchParams();
    keywords.forEach((k) => params.append('keyword', k.trim()));
    params.set('country', country);
    params.set('mode', 'metrics');

    const response = await fetch(`${AHREFS_BASE_URL}/keywords-explorer/keywords-overview?${params.toString()}`, {
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
    const metrics = json?.metrics;
    if (!Array.isArray(metrics)) {
      return { data: [], error: 'Format response Ahrefs tidak valid.' };
    }

    const data: AhrefsKeywordMetric[] = metrics.map((item: any) => ({
      keyword: item.keyword || '',
      searchVolume: Number(item.search_volume ?? 0) || 0,
      keywordDifficulty: Number(item.keyword_difficulty ?? 0) || 0,
      cpc: Number(item.cpc ?? 0) || 0,
      trafficPotential: Number(item.traffic_potential ?? 0) || 0,
      parentTopic: item.parent_topic || undefined,
    }));

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

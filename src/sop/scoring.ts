import type { CheckResult, SopReport, StatusConfig } from './types';

export function calculateSopScore(results: CheckResult[], wordCount: number): SopReport {
  const scored = results.filter((r) => r.status !== 'deferred');
  const failedCount = scored.filter((r) => r.status === 'failed').length;
  const passedCount = scored.filter((r) => r.status === 'passed').length;
  const scoredTotal = scored.length;

  let status: StatusConfig;
  const pct = scoredTotal > 0 ? (passedCount / scoredTotal) * 100 : 0;
  if (pct >= 90) {
    status = {
      label: 'HIJAU',
      desc: 'Siap diterbitkan',
      color: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    };
  } else if (pct >= 70) {
    status = {
      label: 'KUNING',
      desc: 'Perlu perbaikan kecil',
      color: 'bg-amber-50 text-amber-900 border-amber-200',
    };
  } else {
    status = {
      label: 'MERAH',
      desc: 'Perlu perbaikan besar',
      color: 'bg-seal-50 text-seal-700 border-seal-100',
    };
  }

  return {
    items: results,
    score: passedCount,
    scoredTotal,
    failedCount,
    wordCount,
    status,
  };
}

import type { AiEvaluationOutput } from './types';
import type { AIDetectionResult } from './apis/aiDetector';
import type { PlagiarismResult } from './apis/plagiarism';

export type EvaluationAccuracy = {
  overall: number;
  sop: number;
  aiDetector: number;
  plagiarism: number;
  label: string;
  color: string;
  description: string;
  factors: string[];
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computeSopAccuracy(aiResults: AiEvaluationOutput | null): { score: number; factors: string[] } {
  if (!aiResults) return { score: 0, factors: ['Evaluasi SOP belum dijalankan'] };
  if (aiResults.results.length === 0) {
    return { score: 0, factors: ['Tidak ada hasil evaluasi AI'] };
  }

  const avgConfidence = aiResults.results.reduce((s, r) => s + (r.aiConfidence || 0), 0) / aiResults.results.length;
  const subScoreAvg = Object.values(aiResults.subScores || {}).reduce((s, v) => s + v, 0) / 4;
  const passedRatio = aiResults.results.filter((r) => r.status === 'passed').length / aiResults.results.length;

  const score = clamp(avgConfidence * 0.5 + subScoreAvg * 0.3 + passedRatio * 20);
  const factors: string[] = [
    `${aiResults.results.length} poin AI dinilai`,
    `Rata-rata confidence: ${Math.round(avgConfidence)}%`,
    `Skor sub-kategori: ${Math.round(subScoreAvg)}%`,
  ];
  return { score, factors };
}

export function computeAIDetectorAccuracy(result: AIDetectionResult | null): { score: number; factors: string[] } {
  if (!result) return { score: 0, factors: ['AI Detector belum dijalankan'] };
  if (result.error) return { score: 30, factors: ['AI Detector mengalami error/fallback'] };

  const certainty = Math.abs((result.aiProbability || 0) - 50) * 2;
  const sentenceCount = result.sentences?.length || 0;
  const sentenceBonus = Math.min(20, sentenceCount * 2);
  const score = clamp(certainty + sentenceBonus);
  const factors: string[] = [
    `Probabilitas AI: ${result.aiProbability}%`,
    `${sentenceCount} kalimat dianalisis`,
  ];
  return { score, factors };
}

export function computePlagiarismAccuracy(result: PlagiarismResult | null): { score: number; factors: string[] } {
  if (!result) return { score: 0, factors: ['Plagiarism checker belum dijalankan'] };
  if (result.error) return { score: 30, factors: ['Plagiarism mengalami error/fallback'] };

  const certainty = Math.abs((result.plagiarismScore || 0) - 50) * 2;
  const sourceCount = result.matchedSources?.length || 0;
  const sourceBonus = Math.min(20, sourceCount * 5);
  const score = clamp(certainty + sourceBonus);
  const factors: string[] = [
    `Skor plagiasi: ${result.plagiarismScore}%`,
    `${sourceCount} sumber cocok`,
  ];
  return { score, factors };
}

export function computeEvaluationAccuracy(
  aiResults: AiEvaluationOutput | null,
  aiDetectorResult: AIDetectionResult | null,
  plagiarismResult: PlagiarismResult | null,
): EvaluationAccuracy {
  const sop = computeSopAccuracy(aiResults);
  const aiDetector = computeAIDetectorAccuracy(aiDetectorResult);
  const plagiarism = computePlagiarismAccuracy(plagiarismResult);

  const available = [sop.score > 0, aiDetector.score > 0, plagiarism.score > 0].filter(Boolean).length;
  const overall = available === 0 ? 0 : clamp((sop.score + aiDetector.score + plagiarism.score) / available);

  let label: string;
  let color: string;
  if (overall >= 80) {
    label = 'Tinggi';
    color = 'text-emerald-600';
  } else if (overall >= 50) {
    label = 'Sedang';
    color = 'text-amber-600';
  } else {
    label = 'Rendah';
    color = 'text-red-600';
  }

  const factors: string[] = [];
  if (sop.score > 0) factors.push(`SOP: ${sop.score}%`);
  if (aiDetector.score > 0) factors.push(`AI Detector: ${aiDetector.score}%`);
  if (plagiarism.score > 0) factors.push(`Plagiarism: ${plagiarism.score}%`);
  if (factors.length === 0) factors.push('Belum ada evaluasi');

  const description = available === 0
    ? 'Jalankan evaluasi untuk melihat tingkat kepercayaan.'
    : `Tingkat kepercayaan keseluruhan: ${label.toLowerCase()} (${overall}%). Skor dihitung dari confidence AI, jumlah data, dan hasil analisis.`;

  return {
    overall,
    sop: sop.score,
    aiDetector: aiDetector.score,
    plagiarism: plagiarism.score,
    label,
    color,
    description,
    factors,
  };
}

export function getAccuracyBadgeClasses(overall: number): string {
  if (overall >= 80) return 'bg-emerald-50 border-emerald-200 text-emerald-700';
  if (overall >= 50) return 'bg-amber-50 border-amber-200 text-amber-700';
  return 'bg-red-50 border-red-200 text-red-700';
}

export function getAccuracyBarColor(overall: number): string {
  if (overall >= 80) return 'bg-emerald-500';
  if (overall >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

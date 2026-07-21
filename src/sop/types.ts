export type RuleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 51 | 52 | 53 | 54 | 55 | 56;

export type CheckStatus = 'passed' | 'failed' | 'deferred' | 'info';

export type CheckSource = 'rule' | 'ai';

export interface TargetHighlight {
  exact_word: string | null;
  sentence_context: string;
  start_index: number | null;
  end_index: number | null;
}

export interface UiAction {
  has_ignore_button: boolean;
  auto_correct_button: boolean;
}

export interface CheckResult {
  id: RuleId;
  question: string;
  status: CheckStatus;
  passed: boolean;
  reason: string;
  problematic_text: string;
  source?: CheckSource;
  aiConfidence?: number;
  ignored?: boolean;
  category?: 'Error' | 'Information';
  suggested_fix?: string;
  target_highlight?: TargetHighlight;
  point_penalty?: number;
  has_ignore_button?: boolean;
  auto_correct_button?: boolean;
  ui_action?: UiAction;
}

export type ArticleStatusLabel = 'HIJAU' | 'KUNING' | 'MERAH';

export interface StatusConfig {
  label: ArticleStatusLabel;
  desc: string;
  color: string;
}

export interface SopReport {
  items: CheckResult[];
  score: number;
  scoredTotal: number;
  failedCount: number;
  wordCount: number;
  status: StatusConfig;
}

export interface ArticleInput {
  article: string;
  keyword: string;
  metaTitle: string;
  metaDesc: string;
}

export interface SubScores {
  seo: number;
  structure: number;
  intent: number;
  tone: number;
}

export interface AiEvaluationOutput {
  results: CheckResult[];
  subScores: SubScores;
  bestNextMove: string;
}

export interface HeadingInfo {
  level: 1 | 2 | 3;
  text: string;
  raw: string;
  lineIndex: number;
}

export interface LinkInfo {
  text: string;
  url: string;
  raw: string;
  lineIndex: number;
  isImage: boolean;
}

export interface ImageInfo {
  alt: string;
  url: string;
  raw: string;
  lineIndex: number;
}

export interface ParagraphInfo {
  text: string;
  lineIndex: number;
  isHeading: boolean;
  isList: boolean;
  isImage: boolean;
  sentenceCount: number;
  wordCount: number;
}

export interface ParsedArticle {
  raw: string;
  lines: string[];
  title: string;
  titleRaw: string;
  lead: string;
  leadWordCount: number;
  leadSentenceCount: number;
  paragraphs: ParagraphInfo[];
  bodyParagraphs: ParagraphInfo[];
  headings: HeadingInfo[];
  links: LinkInfo[];
  images: ImageInfo[];
  wordCount: number;
  textContent: string;
}

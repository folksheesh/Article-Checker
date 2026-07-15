export type RuleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 51 | 52 | 53 | 54 | 55;

export type CheckStatus = 'passed' | 'failed' | 'deferred';

export type CheckSource = 'rule' | 'ai';

export interface CheckResult {
  id: RuleId;
  question: string;
  status: CheckStatus;
  passed: boolean;
  reason: string;
  problematic_text: string;
  source?: CheckSource;
  aiConfidence?: number;
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

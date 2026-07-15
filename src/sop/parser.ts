import type {
  HeadingInfo,
  ImageInfo,
  LinkInfo,
  ParagraphInfo,
  ParsedArticle,
} from './types';

export function countWords(text: string): number {
  const cleaned = text.replace(/[#*_`[\]()]/g, ' ').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function countSentences(text: string): number {
  const cleaned = text.replace(/[#*_`[\]()!]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 0;
  const parts = cleaned.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  return parts.length;
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

function isHeadingLine(line: string): boolean {
  return /^#{1,3}\s+/.test(line.trim());
}

function isListLine(line: string): boolean {
  return /^(\s*[-*+]|\s*\d+\.)\s+/.test(line);
}

function isImageLine(line: string): boolean {
  return /!\[[^\]]*]\([^)]*\)/.test(line);
}

function parseHeading(line: string, lineIndex: number): HeadingInfo | null {
  const match = line.trim().match(/^(#{1,3})\s+(.+)$/);
  if (!match) return null;
  const level = match[1].length as 1 | 2 | 3;
  return {
    level,
    text: stripMarkdownInline(match[2]),
    raw: line.trim(),
    lineIndex,
  };
}

function extractLinks(line: string, lineIndex: number): LinkInfo[] {
  const links: LinkInfo[] = [];
  const imageRegex = /!\[([^\]]*)]\(([^)]*)\)/g;
  const linkRegex = /\[([^\]]+)]\(([^)]*)\)/g;
  let m: RegExpExecArray | null;

  const imageRanges: Array<{ start: number; end: number }> = [];
  while ((m = imageRegex.exec(line)) !== null) {
    imageRanges.push({ start: m.index, end: m.index + m[0].length });
  }

  while ((m = linkRegex.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const isImage = imageRanges.some((r) => start >= r.start && end <= r.end);
    if (isImage) continue;
    // skip if preceded by ! (already handled as image via imageRanges, but belt-and-suspenders)
    if (start > 0 && line[start - 1] === '!') continue;
    links.push({
      text: m[1],
      url: m[2],
      raw: m[0],
      lineIndex,
      isImage: false,
    });
  }
  return links;
}

function extractImages(line: string, lineIndex: number): ImageInfo[] {
  const images: ImageInfo[] = [];
  const imageRegex = /!\[([^\]]*)]\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imageRegex.exec(line)) !== null) {
    images.push({
      alt: m[1].trim(),
      url: m[2],
      raw: m[0],
      lineIndex,
    });
  }
  return images;
}

export function parseArticle(article: string): ParsedArticle {
  const lines = article.split(/\r?\n/);
  const headings: HeadingInfo[] = [];
  const links: LinkInfo[] = [];
  const images: ImageInfo[] = [];
  const paragraphs: ParagraphInfo[] = [];

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const heading = parseHeading(line, lineIndex);
    if (heading) headings.push(heading);

    links.push(...extractLinks(line, lineIndex));
    images.push(...extractImages(line, lineIndex));

    const text = stripMarkdownInline(trimmed);
    const isHeading = isHeadingLine(trimmed);
    const isList = isListLine(trimmed);
    const isImage = isImageLine(trimmed) && text.length === 0;

    paragraphs.push({
      text: isHeading ? stripMarkdownInline(trimmed.replace(/^#{1,3}\s+/, '')) : text,
      lineIndex,
      isHeading,
      isList,
      isImage: isImageLine(trimmed),
      sentenceCount: isHeading || isList || isImage ? 0 : countSentences(text),
      wordCount: countWords(text),
    });
  });

  const titleHeading = headings.find((h) => h.level === 1);
  const firstNonEmpty = paragraphs[0];
  const title = titleHeading?.text
    ?? (firstNonEmpty && !firstNonEmpty.isList ? firstNonEmpty.text : '');
  const titleRaw = titleHeading?.raw
    ?? (firstNonEmpty ? lines[firstNonEmpty.lineIndex] : '');

  const bodyStartIdx = titleHeading
    ? paragraphs.findIndex((p) => p.lineIndex > titleHeading.lineIndex)
    : paragraphs.length > 1
      ? 1
      : -1;

  const leadPara =
    bodyStartIdx >= 0
      ? paragraphs.slice(bodyStartIdx).find((p) => !p.isHeading && !p.isList && !p.isImage && p.text.length > 0)
      : undefined;
  const lead = leadPara?.text ?? '';

  const bodyParagraphs = paragraphs.filter(
    (p) => !p.isHeading && !p.isList && !p.isImage && p.text.length > 0,
  );

  const textContent = paragraphs
    .filter((p) => !p.isImage)
    .map((p) => p.text)
    .join(' ');

  return {
    raw: article,
    lines,
    title,
    titleRaw,
    lead,
    leadWordCount: countWords(lead),
    leadSentenceCount: countSentences(lead),
    paragraphs,
    bodyParagraphs,
    headings,
    links,
    images,
    wordCount: countWords(textContent),
    textContent,
  };
}

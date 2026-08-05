import type {
  HeadingInfo,
  ImageInfo,
  LinkInfo,
  ParagraphInfo,
  ParsedArticle,
} from './types';

export function countWords(text: string): number {
  // Strip markdown inline punctuation and quote characters so they don't inflate word counts.
  const cleaned = text.replace(/[#*_`[\]()"'“”‘’]/g, ' ').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function countSentences(text: string): number {
  // Strip markdown inline punctuation and quote characters so trailing quotes don't count as a sentence.
  const cleaned = text.replace(/[#*_`[\]()!"'“”‘’]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 0;
  const parts = cleaned.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  return parts.length;
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/^>\s*/, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
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

  const titleHeading = headings.find((h) => h.level === 1)
    ?? headings.find((h) => h.level === 2)
    ?? headings.find((h) => h.level === 3);
  const firstNonEmpty = paragraphs.find((p) => !p.isImage && !p.isList);
  const title = titleHeading?.text
    ?? (firstNonEmpty ? firstNonEmpty.text : '');
  const titleRaw = titleHeading?.raw
    ?? (firstNonEmpty ? lines[firstNonEmpty.lineIndex] : '');
  const titleLineIndex = titleHeading?.lineIndex ?? firstNonEmpty?.lineIndex ?? -1;

  // Lead detection following strict specification:
  // 1. First paragraph(s) DIRECTLY under title
  // 2. Must be wrapped in double quotes (" or " at start, " or " at end)
  // 3. Single block only (first quoted block found)
  // 4. Can span multiple paragraphs if quote continues

  let lead = '';
  let leadRaw = '';
  let leadDetected = false;

  // Get all paragraphs after title (before any H2 heading)

  // Try to find quoted lead block
  let inQuote = false;
  let quoteText = '';
  let quoteTextRaw = '';

  // Also search raw lines (not just parsed paragraphs) for quote detection
  // because TipTap may produce bold/italic markup inside quotes
  const rawLinesAfterTitle = lines.slice(titleLineIndex + 1);

  for (let i = 0; i < rawLinesAfterTitle.length; i++) {
    const rawLine = rawLinesAfterTitle[i].trim();

    // Skip empty lines (paragraph separators) but don't break
    // Lead can have empty lines before it
    if (!rawLine) {
      // If we're in a quote and hit an empty line, the quote ended on previous line
      if (inQuote) break;
      continue;
    }

    // Skip headings, lists, images
    if (/^#{1,3}\s+/.test(rawLine)) break;
    if (/^(\s*[-*+]|\s*\d+\.)\s+/.test(rawLine)) {
      if (inQuote) break;
      continue;
    }
    if (/!\[[^\]]*]\([^)]*\)/.test(rawLine) && !rawLine.match(/[""]/)) {
      if (inQuote) break;
      continue;
    }

    const text = stripMarkdownInline(rawLine);
    if (!text) continue;

    const startsWithQuote = /^[\s\u200B]*["'\u2018\u2019\u201C\u201D\u201E\u201F\u00AB\u00BB]/i.test(text);
    // Check if the CLEANED text ends with a closing quote (allowing trailing punctuation)
    const endsWithQuote = /["'\u2018\u2019\u201C\u201D\u201E\u201F\u00AB\u00BB][.,!?\s\u200B]*$/i.test(text);

    if (!inQuote) {
      if (startsWithQuote) {
        inQuote = true;
        quoteText = text;
        quoteTextRaw = rawLine;

        if (endsWithQuote && quoteText.length > 2) {
          lead = quoteText;
          leadRaw = quoteTextRaw;
          leadDetected = true;
          break;
        }
      } else {
        // Keep searching instead of breaking immediately
        continue;
      }
    } else {
      quoteText += ' ' + text;
      quoteTextRaw += '\n' + rawLine;
      if (endsWithQuote) {
        lead = quoteText;
        leadRaw = quoteTextRaw;
        leadDetected = true;
        break;
      }
    }
  }

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
    lead: leadDetected ? lead : '',
    leadRaw: leadDetected ? leadRaw : '',
    leadWordCount: leadDetected ? countWords(lead) : 0,
    leadSentenceCount: leadDetected ? countSentences(lead) : 0,
    paragraphs,
    bodyParagraphs,
    headings,
    links,
    images,
    wordCount: countWords(textContent),
    textContent,
  };
}

export function stripImages(text: string): string {
  return text
    // Markdown images ![alt](url)
    .replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '')
    // HTML <img> tags
    .replace(/<img\b[^>]*>/gi, '')
    // Data URIs that might remain after markdown strip
    .replace(/data:image\/[a-z+]+;base64[^'")\s]*/gi, '')
    // (parenthesized image filenames) — covers [text](file.png) links too
    .replace(/\([^)]*\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)(?:\?[^)]*)?\)/gi, '')
    // Reference-style definitions [label]: url
    .replace(/\[[^\]]*\]:\s*\S+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)/gi, '')
    // Bare filenames like image.png (including quoted)
    .replace(/[\w-]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)\b/gi, '')
    // file:// URLs
    .replace(/file:\/\/\/?\S+/gi, '')
    .trim();
}

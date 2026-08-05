import { parseArticle } from '../src/sop/parser.ts';

const articleMultiLineQuote = `# Judul Artikel
"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan.
Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."

Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa.`;

console.log('=== Article Lines ===');
const lines = articleMultiLineQuote.split('\n');
lines.forEach((line, i) => console.log(`Line ${i}: "${line}"`));

console.log('\n=== Parsed ===');
const parsed = parseArticle(articleMultiLineQuote);
console.log('Title:', parsed.title);
console.log('Lead:', JSON.stringify(parsed.lead));
console.log('Lead words:', parsed.leadWordCount);
console.log('Lead sentences:', parsed.leadSentenceCount);

console.log('\n=== Paragraphs ===');
parsed.paragraphs.forEach((p, i) => {
  console.log(`Para ${i}: line=${p.lineIndex} isHeading=${p.isHeading} text="${p.text.substring(0, 50)}..."`);
});

import { parseArticle } from '../src/sop/parser.ts';

// Test case from the screenshot - multi-line quoted lead
const articleMultiline = `# Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan
"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."

Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa.

## Langkah-langkah
Langkah pertama adalah mengecek status NIB.`;

// Test case - lead with opening quote on first line, closing on second
const articleMultiLineQuote = `# Judul Artikel
"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan.
Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."

Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa.`;

// Test case - single line quoted lead
const articleSingleLine = `# Judul Artikel
"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan."

Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa.`;

// Test case - no lead (no quotes)
const articleNoLead = `# Judul Artikel
Bisnis Anda naik kelas dari Menengah ke Besar.

Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa.`;

console.log('=== Test 1: Multi-line quoted lead ===');
const parsed1 = parseArticle(articleMultiline);
console.log('Lead detected:', parsed1.lead !== '');
console.log('Lead:', JSON.stringify(parsed1.lead));
console.log('Lead words:', parsed1.leadWordCount);
console.log('Lead sentences:', parsed1.leadSentenceCount);
console.log('Expected: 21 words, 3 sentences');
console.log('');

console.log('=== Test 2: Quote spans two lines ===');
const parsed2 = parseArticle(articleMultiLineQuote);
console.log('Lead detected:', parsed2.lead !== '');
console.log('Lead:', JSON.stringify(parsed2.lead));
console.log('Lead words:', parsed2.leadWordCount);
console.log('Lead sentences:', parsed2.leadSentenceCount);
console.log('');

console.log('=== Test 3: Single line quoted lead ===');
const parsed3 = parseArticle(articleSingleLine);
console.log('Lead detected:', parsed3.lead !== '');
console.log('Lead:', JSON.stringify(parsed3.lead));
console.log('Lead words:', parsed3.leadWordCount);
console.log('Lead sentences:', parsed3.leadSentenceCount);
console.log('');

console.log('=== Test 4: No lead (no quotes) ===');
const parsed4 = parseArticle(articleNoLead);
console.log('Lead detected:', parsed4.lead !== '');
console.log('Lead:', JSON.stringify(parsed4.lead));
console.log('');

// Validate
const test1Ok = parsed1.lead !== '' && parsed1.leadWordCount === 21 && parsed1.leadSentenceCount === 3;
const test2Ok = parsed2.lead !== '' && parsed2.leadWordCount === 21 && parsed2.leadSentenceCount === 3;
const test3Ok = parsed3.lead !== '';
const test4Ok = parsed4.lead === '';

console.log('=== Results ===');
console.log('Test 1 (multiline quoted):', test1Ok ? 'PASS' : 'FAIL');
console.log('Test 2 (quote spans lines):', test2Ok ? 'PASS' : 'FAIL');
console.log('Test 3 (single line):', test3Ok ? 'PASS' : 'FAIL');
console.log('Test 4 (no lead):', test4Ok ? 'PASS' : 'FAIL');

if (!test1Ok || !test2Ok || !test3Ok || !test4Ok) {
  process.exit(1);
}

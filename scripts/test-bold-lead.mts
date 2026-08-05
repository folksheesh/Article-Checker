import { parseArticle } from '../src/sop/parser.ts';

// Realistic case from screenshot: lead with bold text inside
const articleBoldLead = `# Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan

"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban **perubahan data OSS perusahaan** menurut PP 28/2025."

Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.

Namun, di balik euforia pertumbuhan omzet, jajaran Direksi sering kali melupakan satu aspek krusial: Kepatuhan Legalitas (Legal Compliance).`;

console.log('=== Test: Lead with bold text ===');
const parsed = parseArticle(articleBoldLead);
console.log('Lead detected:', parsed.lead !== '');
console.log('Lead:', JSON.stringify(parsed.lead));
console.log('Lead words:', parsed.leadWordCount);
console.log('Lead sentences:', parsed.leadSentenceCount);
console.log('Expected: 21 words, 3 sentences');
console.log('');

console.log('=== Paragraphs ===');
parsed.paragraphs.forEach((p, i) => {
  console.log(`Para ${i}: line=${p.lineIndex} isHeading=${p.isHeading} text="${p.text.substring(0, 60)}..."`);
});

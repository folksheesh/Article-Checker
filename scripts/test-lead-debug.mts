import { parseArticle } from '../src/sop/parser.ts';

const md = [
  '# Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan',
  '',
  'Seiring dengan pertumbuhan bisnis yang Anda jalankan dan skalanya terus meningkat, kelancaran ekspansi bisnis ke depan.',
  '',
  '*“Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan****menurut PP 28/2025.”*',
  '',
  'Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa.',
].join('\n');

const parsed = parseArticle(md);
console.log('Lead detected:', parsed.leadDetected);
console.log('Lead:', JSON.stringify(parsed.lead));
console.log('Words:', parsed.leadWordCount);
console.log('Sentences:', parsed.leadSentenceCount);
console.log('Title:', JSON.stringify(parsed.title));
console.log('Paragraph count:', parsed.paragraphs.length);

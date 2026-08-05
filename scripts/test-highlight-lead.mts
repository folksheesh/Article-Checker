import { parseArticle } from '../src/sop/parser.ts';

// THE ACTUAL EDITOR TEXT (doc real): with proper spaces
const docText = '“Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025.”';

// Markdown that htmlToMarkdown produces from bold/italic rich HTML
const md = [
  '# Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan',
  '',
  'Seiring dengan pertumbuhan bisnis yang Anda jalankan dan skalanya terus meningkat, kelancaran ekspansi bisnis ke depan.',
  '',
  '*“Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan**menurut PP 28/2025.”*',
  '',
  'Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar.',
].join('\n');

const parsed = parseArticle(md);
console.log('=== parsed.lead (used as problematic_text) ===');
console.log(JSON.stringify(parsed.lead));
console.log('wordCount:', parsed.leadWordCount);

// Now check if parsed.lead is a substring of the actual editor doc text
const lowerLead = parsed.lead.toLowerCase();
const lowerDoc = docText.toLowerCase();
console.log('\n=== Does parsed.lead appear in actual doc text? ===');
console.log('parsed.lead length:', parsed.lead.length);
console.log('includes:', lowerDoc.includes(lowerLead));
console.log('doc includes "perusahaan menurut":', lowerDoc.includes('perusahaan menurut'));
console.log('lead has "perusahaanmenurut" (no space):', lowerLead.includes('perusahaanmenurut'));
console.log('doc has "perusahaanmenurut" (no space):', lowerDoc.includes('perusahaanmenurut'));
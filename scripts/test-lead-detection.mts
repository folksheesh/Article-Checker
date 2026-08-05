import { parseArticle } from '../src/sop/parser.ts';

const userLead = '"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."';

const cases = [
  {
    name: 'User lead: quoted block only',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
${userLead}

Paragraf isi pertama yang tidak dikutip.
`,
    expectedLead: userLead,
    expectedWordCount: 21,
    expectedSentenceCount: 3,
    expectedDetected: true,
  },
  {
    name: 'Quoted block but not directly after title (heading in between)',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
## Detail Penting
"Lead ini salah karena tidak langsung di bawah judul."

Paragraf isi.
`,
    expectedLead: '',
    expectedWordCount: 0,
    expectedSentenceCount: 0,
    expectedDetected: false,
  },
  {
    name: 'No lead (plain text immediately after title)',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
Paragraf pertama setelah judul tidak dikutip.
`,
    expectedLead: '',
    expectedWordCount: 0,
    expectedSentenceCount: 0,
    expectedDetected: false,
  },
  {
    name: 'Lead with curly quotes',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
“Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025.”

Paragraf isi kedua.
`,
    expectedLead: '“Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025.”',
    expectedWordCount: 21,
    expectedSentenceCount: 3,
    expectedDetected: true,
  },
  {
    'name': 'Partial quotes (only opening) - no lead',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025.

Paragraf isi kedua.
`,
    expectedLead: '',
    expectedWordCount: 0,
    expectedSentenceCount: 0,
    expectedDetected: false,
  },
  {
    name: 'Partial quotes (only closing) - no lead',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."

Paragraf isi kedua.
`,
    expectedLead: '',
    expectedWordCount: 0,
    expectedSentenceCount: 0,
    expectedDetected: false,
  },
  {
    name: 'Image before quoted lead',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
![Ilustrasi](gambar.jpg)
"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."

Paragraf isi kedua.
`,
    expectedLead: '"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."',
    expectedWordCount: 21,
    expectedSentenceCount: 3,
    expectedDetected: true,
  },
  {
    name: 'List before quoted lead',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
- Poin pertama
- Poin kedua
"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."

Paragraf isi kedua.
`,
    expectedLead: '"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."',
    expectedWordCount: 21,
    expectedSentenceCount: 3,
    expectedDetected: true,
  },
  {
    name: 'Heading immediately after quoted lead',
    article: `# Cara Mengubah Data OSS sesuai PP 28/2025
"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."

## Langkah-langkah Penting
Paragraf isi setelah H2.
`,
    expectedLead: '"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."',
    expectedWordCount: 21,
    expectedSentenceCount: 3,
    expectedDetected: true,
  },
];

let failures = 0;
for (const c of cases) {
  const parsed = parseArticle(c.article);
  const leadOk = parsed.lead === c.expectedLead;
  const wordOk = c.expectedWordCount === undefined || parsed.leadWordCount === c.expectedWordCount;
  const sentenceOk = c.expectedSentenceCount === undefined || parsed.leadSentenceCount === c.expectedSentenceCount;
  const detectedOk = c.expectedDetected === undefined || (parsed.lead !== '' ? true : false) === c.expectedDetected;
  const ok = leadOk && wordOk && sentenceOk && detectedOk;
  if (!ok) failures++;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${c.name}`);
  console.log(`  Expected lead: ${JSON.stringify(c.expectedLead)}`);
  console.log(`  Actual lead:   ${JSON.stringify(parsed.lead)}`);
  if (c.expectedWordCount !== undefined) console.log(`  Words:    expected ${c.expectedWordCount}, actual ${parsed.leadWordCount}`);
  if (c.expectedSentenceCount !== undefined) console.log(`  Sentences: expected ${c.expectedSentenceCount}, actual ${parsed.leadSentenceCount}`);
}

if (failures > 0) {
  console.log(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll tests passed.');

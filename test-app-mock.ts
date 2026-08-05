import { parseArticle } from './src/sop/parser.ts';
import fs from 'fs';

const html = `<h1>Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan</h1>
<p><em>"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."</em></p>
<p>Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.</p>
<p>Namun, di balik euforia pertumbuhan omzet, jajaran Direksi sering kali melupakan satu aspek krusial: <strong>Kepatuhan Legalitas (Legal Compliance)</strong>.</p>
<p>Banyak pelaku usaha mengira bahwa Nomor Induk Berusaha (NIB) yang dicetak saat perusahaan masih berstatus rintisan akan berlaku abadi tanpa perlu diurus ulang. Ini adalah asumsi yang sangat berbahaya. Dalam rezim hukum investasi Indonesia, peningkatan skala bisnis dan nilai modal dapat memicu perubahan tingkat risiko usaha.</p>
<p>Lantas, apakah status Usaha Besar mengharuskan Anda mengubah perizinan dasar? Jawabannya: Ya, Anda diwajibkan melakukan <strong>perubahan data OSS perusahaan</strong>. Berikut adalah panduan mitigasi risikonya.</p>`;

// mock htmlToMarkdown
function htmlToMarkdown(h) {
  return `# Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan

*"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."*

Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.

Namun, di balik euforia pertumbuhan omzet, jajaran Direksi sering kali melupakan satu aspek krusial: **Kepatuhan Legalitas (Legal Compliance)**.

Banyak pelaku usaha mengira bahwa Nomor Induk Berusaha (NIB) yang dicetak saat perusahaan masih berstatus rintisan akan berlaku abadi tanpa perlu diurus ulang. Ini adalah asumsi yang sangat berbahaya. Dalam rezim hukum investasi Indonesia, peningkatan skala bisnis dan nilai modal dapat memicu perubahan tingkat risiko usaha.

Lantas, apakah status Usaha Besar mengharuskan Anda mengubah perizinan dasar? Jawabannya: Ya, Anda diwajibkan melakukan **perubahan data OSS perusahaan**. Berikut adalah panduan mitigasi risikonya.`;
}

const md = htmlToMarkdown(html);
const parsed = parseArticle(md);

console.log("Lead:", parsed.lead);
console.log("Body paragraphs:");
parsed.bodyParagraphs.forEach((p, i) => console.log(`  [${i}]`, p.text.substring(0, 50) + '...'));

const why = parsed.bodyParagraphs[1];
console.log("WHY paragraph text:", why ? why.text : 'null');

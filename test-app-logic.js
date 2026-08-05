import fs from 'fs';
import { parseArticle } from './src/sop/parser.ts';

const html = `<h1>Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan</h1>
<p><em>"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."</em></p>
<p>Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.</p>
<p>Namun, di balik euforia pertumbuhan omzet, jajaran Direksi sering kali melupakan satu aspek krusial: <strong>Kepatuhan Legalitas (Legal Compliance)</strong>.</p>`;

function htmlToMarkdown(h) {
  return h.replace(/<h1>(.*?)<\/h1>/g, '# $1\n\n')
          .replace(/<p><em>(.*?)<\/em><\/p>/g, '*$1*\n\n')
          .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
          .replace(/<strong>(.*?)<\/strong>/g, '**$1**');
}

const md = htmlToMarkdown(html);
const parsed = parseArticle(md);
const why = parsed.bodyParagraphs[1];

const pt = why.text; // "Membawa bisnis berkembang..."

// 1. findTextMatch in App.tsx
const highlightedMd = md;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tryExact = (str) => {
  const escaped = esc(str).replace(/ /g, '\\s+');
  const re = new RegExp(escaped, 'i');
  const m = re.exec(highlightedMd);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
};
let m = tryExact(pt.replace(/\s+/g, ' ').trim());

if (!m) {
  console.log("PASS 1 FAILED!");
} else {
  console.log("PASS 1 SUCCEEDED", m);
}

// 2. Pass 2
const ranges = m ? [{ start: m.start, end: m.end, text: pt }] : [];

// simulate fullDocText
const parts = [];
const blocks = html.match(/<(h1|p)>(.*?)<\/\1>/g);
blocks.forEach(b => {
    let text = b.replace(/<[^>]+>/g, '');
    parts.push(text);
});
const fullDocText = parts.join('');

console.log("fullDocText:");
console.log(fullDocText);

const fuzzyRe = (s) => new RegExp(s.replace(/[\s\u200B\u200C\u200D\uFEFF]+/g, ' ').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s\\u200B\\u200C\\u200D\\uFEFF]+'), 'i');

for (const range of ranges) {
    const text = range.text.trim();
    const re = fuzzyRe(text);
    console.log("fuzzyRe:", re);
    let found = re.exec(fullDocText);
    if (!found) {
        console.log("PASS 2 FAILED!");
    } else {
        console.log("PASS 2 SUCCEEDED", found.index);
    }
}

// What if the issue is the Lead?
const ptLead = parsed.lead;
m = tryExact(ptLead.replace(/\s+/g, ' ').trim());
if (!m) {
  console.log("PASS 1 FAILED FOR LEAD!");
} else {
  console.log("PASS 1 SUCCEEDED FOR LEAD", m);
}
const reLead = fuzzyRe(ptLead.trim());
let foundLead = reLead.exec(fullDocText);
if (!foundLead) {
    console.log("PASS 2 FAILED FOR LEAD!");
} else {
    console.log("PASS 2 SUCCEEDED FOR LEAD", foundLead.index);
}

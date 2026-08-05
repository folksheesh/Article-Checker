import TurndownService from 'turndown';
import { parseArticle } from './src/sop/parser.ts';

const html = `<h1>Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan</h1>
<p>“Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025.”</p>
<p>Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.</p>`;

const turndownService = new TurndownService({ headingStyle: 'atx' });
const md = turndownService.turndown(html);

console.log("MARKDOWN GENERATED:");
console.log(md);

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

// ... Wait, let's just use the functions exactly as defined in App.tsx!
function findTextMatch(text, query) {
  if (!query) return null;
  const q = query.replace(/\s+/g, ' ').trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tryExact = (str) => {
    const escaped = esc(str).replace(/ /g, '\\s+');
    const re = new RegExp(escaped, 'i');
    const m = re.exec(text);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  };
  let r = tryExact(q);
  if (r) return r;
  const firstSen = q.split(/[.!?]/)[0];
  if (firstSen && firstSen.length > 10) {
    r = tryExact(firstSen);
    if (r) return r;
  }
  const clean = q.replace(/[.!?,;:]+$/g, '');
  if (clean.length > 10) {
    r = tryExact(clean);
    if (r) return r;
  }
  const words = q.split(/\s+/).filter(Boolean).map(esc);
  if (words.length > 1) {
    const pattern = words.join('(?:[\\s*_`~]|<[^>]+>)+');
    const re = new RegExp(pattern, 'i');
    const m = re.exec(text);
    if (m) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

let m = findTextMatch(highlightedMd, pt);
if (!m) {
  console.log("PASS 1 FAILED FOR WHY!");
} else {
  console.log("PASS 1 SUCCEEDED FOR WHY", m);
}

const parts = [];
const blocks = html.match(/<(h1|p)>(.*?)<\/\1>/g);
blocks.forEach(b => {
    let text = b.replace(/<[^>]+>/g, '');
    parts.push(text);
});
const fullDocText = parts.join('');

const fuzzyRe = (s) => new RegExp(s.replace(/[\s\u200B\u200C\u200D\uFEFF]+/g, ' ').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s\\u200B\\u200C\\u200D\\uFEFF]+'), 'i');

const rangeWhy = m ? { text: pt } : null;
if (rangeWhy) {
    const re = fuzzyRe(rangeWhy.text.trim());
    let found = re.exec(fullDocText);
    if (!found) {
        console.log("PASS 2 FAILED FOR WHY!");
    } else {
        console.log("PASS 2 SUCCEEDED FOR WHY", found.index);
    }
}

// LEAD TEST
const ptLead = parsed.lead;
m = findTextMatch(highlightedMd, ptLead);
if (!m) {
  console.log("PASS 1 FAILED FOR LEAD!");
} else {
  console.log("PASS 1 SUCCEEDED FOR LEAD", m);
}
if (m) {
    const reLead = fuzzyRe(ptLead.trim());
    let foundLead = reLead.exec(fullDocText);
    if (!foundLead) {
        console.log("PASS 2 FAILED FOR LEAD!");
    } else {
        console.log("PASS 2 SUCCEEDED FOR LEAD", foundLead.index);
    }
}

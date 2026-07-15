import { runSopChecks, autoReviseItem } from '../src/sop/index.ts';

const mock = {
  keyword: 'mendaftarkan merek',
  metaTitle: '5 Cara Mendaftarkan Merek Usaha Anda | Legalitas',
  metaDesc:
    'Panduan lengkap cara mendaftarkan merek usaha agar tidak dibajak. Lindungi aset bisnis Anda sekarang juga bersama tim legal kami.',
  article: `# 5 Cara Melindungi dan Mendaftarkan Merek Usaha
Pembajakan merek bisa menghancurkan bisnis Anda dalam semalam. Pelajari 5 strategi legal untuk melindungi aset berharga ini sebelum terlambat.

Kasus pencurian identitas brand sedang marak terjadi di kalangan UMKM tahun ini. Anda harus menyadari bahwa tanpa perlindungan hukum, nama bisnis yang Anda bangun bertahun-tahun bisa diklaim oleh kompetitor kapan saja.

Berikut adalah langkah-langkah yang harus Anda lakukan:
## 1. Lakukan Pengecekan di DJKI
Sebelum mendaftarkan merek, pastikan nama tersebut belum digunakan. Anda bisa mengeceknya melalui website resmi DJKI.

## 2. Siapkan Persyaratan Dokumen
Anda membutuhkan KTP, NPWP, dan logo merek yang jelas. Pastikan logo tidak meniru brand terkenal lainnya.

Menurut data Kemenkumham, lebih dari 30% penolakan merek terjadi karena adanya kemiripan visual dengan merek yang sudah terdaftar sebelumnya. Oleh karena itu, orisinalitas sangat penting.

Untuk mendaftarkan merek, pastikan Anda merujuk pada UU No. 20 Tahun 2016 tentang Merek dan Indikasi Geografis. Aturan ini masih berlaku penuh.

Baca juga: [Syarat Merek Terkenal](#), [Pentingnya Legalitas Usaha](#), [Cara Cek Merek Online](#)
Internal Link: [Layanan Registrasi Merek Kami](#), [Panduan HAKI](#)

![Ilustrasi pendaftaran merek di kantor DJKI](merek.jpg)

Butuh bantuan mendaftarkan merek agar bebas dari risiko penolakan? Konsultasikan dengan tim legal kami hari ini juga!`,
};

const bad = {
  keyword: 'merek',
  metaTitle: 'X'.repeat(80),
  metaDesc: '',
  article: `# Pembahasan Mengenai Hukum
Ini adalah lead yang sangat panjang sekali dengan banyak sekali kata sehingga jelas melanggar aturan dua belas kata maupun dua kalimat karena terus berlanjut tanpa henti sama sekali sama sekali.

Paragraf kedua tanpa urgensi sama sekali hanya cerita biasa.

Satu paragraf berisi empat kalimat. Ini kalimat dua. Ini tiga. Ini empat yang membuat gagal.

Hanya Hubungi kami.
`,
};

function printReport(label: string, input: typeof mock) {
  const r = runSopChecks(input);
  console.log('\n===', label, '===');
  console.log('status:', r.status.label, '| score:', `${r.score}/${r.scoredTotal}`, '| fail:', r.failedCount, '| words:', r.wordCount);
  for (const item of r.items) {
    console.log(
      `${item.id}. [${item.status}] ${item.passed ? 'PASS' : 'FAIL'} — ${item.reason.slice(0, 90)}`,
    );
  }
  return r;
}

const mockReport = printReport('MOCK', mock);
const badReport = printReport('BAD', bad);

const deferred = mockReport.items.find((i) => i.id === 12);
if (!deferred || deferred.status !== 'deferred') {
  throw new Error('Item 12 must be deferred');
}
console.log('\nDeferred OK');

// Auto-revise meta (14) and paragraph (8) on bad sample
const fail14 = badReport.items.find((i) => i.id === 14)!;
const revised14 = await autoReviseItem(bad, fail14);
const after14 = runSopChecks({
  article: revised14.article,
  keyword: bad.keyword,
  metaTitle: revised14.metaTitle,
  metaDesc: revised14.metaDesc,
});
console.log('\nAfter auto-revise #14:', after14.items.find((i) => i.id === 14)?.status, revised14.message);

const fail8 = badReport.items.find((i) => i.id === 8)!;
const revised8 = await autoReviseItem(
  { article: revised14.article, keyword: bad.keyword, metaTitle: revised14.metaTitle, metaDesc: revised14.metaDesc },
  fail8,
);
const after8 = runSopChecks({
  article: revised8.article,
  keyword: bad.keyword,
  metaTitle: revised8.metaTitle,
  metaDesc: revised8.metaDesc,
});
console.log('After auto-revise #8:', after8.items.find((i) => i.id === 8)?.status, revised8.message);

if (after14.items.find((i) => i.id === 14)?.status !== 'passed') {
  throw new Error('Auto-revise #14 should pass');
}
if (after8.items.find((i) => i.id === 8)?.status !== 'passed') {
  throw new Error('Auto-revise #8 should pass');
}

console.log('\nSMOKE OK');

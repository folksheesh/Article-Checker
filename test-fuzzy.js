const fullDocText = `Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.Namun, di balik euforia pertumbuhan omzet, jajaran Direksi sering kali melupakan satu aspek krusial: Kepatuhan Legalitas (Legal Compliance).Banyak pelaku usaha mengira bahwa Nomor Induk Berusaha (NIB) yang dicetak saat perusahaan masih berstatus rintisan akan berlaku abadi tanpa perlu diurus ulang. Ini adalah asumsi yang sangat berbahaya. Dalam rezim hukum investasi Indonesia, peningkatan skala bisnis dan nilai modal dapat memicu perubahan tingkat risiko usaha.Lantas, apakah status Usaha Besar mengharuskan Anda mengubah perizinan dasar? Jawabannya: Ya, Anda diwajibkan melakukan perubahan data OSS perusahaan. Berikut adalah panduan mitigasi risikonya.`;

const text = "Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.";

const fuzzyRe = (s) =>
  new RegExp(
    s.replace(/\s+/g, ' ').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'),
    'i',
  );

const re = fuzzyRe(text);
const m = re.exec(fullDocText);
console.log('Match fuzzyRe:', m ? { start: m.index, end: m.index + m[0].length } : null);

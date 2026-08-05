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

  const words = q.split(/\s+/).filter(Boolean).map(esc);
  if (words.length > 1) {
    const pattern = words.join('(?:[\\s*_~`]|<[^>]+>)+');
    try {
      const re = new RegExp(pattern, 'i');
      const m = re.exec(text);
      if (m) return { start: m.index, end: m.index + m[0].length };
    } catch { }
  }

  const clean = q.replace(/[.!?,;:]+$/g, '');
  if (clean.length > 10) {
    r = tryExact(clean);
    if (r) return r;
    if (words.length > 1) {
      const cleanWords = clean.split(/\s+/).filter(Boolean).map(esc);
      const pattern = cleanWords.join('(?:[\\s*_~`]|<[^>]+>)+');
      try {
        const re = new RegExp(pattern, 'i');
        const m = re.exec(text);
        if (m) return { start: m.index, end: m.index + m[0].length };
      } catch { }
    }
  }

  const firstSen = q.split(/[.!?]/)[0];
  if (firstSen && firstSen.length > 10) {
    r = tryExact(firstSen);
    if (r) return r;
    const senWords = firstSen.split(/\s+/).filter(Boolean).map(esc);
    if (senWords.length > 1) {
      const pattern = senWords.join('(?:[\\s*_~`]|<[^>]+>)+');
      try {
        const re = new RegExp(pattern, 'i');
        const m = re.exec(text);
        if (m) return { start: m.index, end: m.index + m[0].length };
      } catch { }
    }
  }

  return null;
}

const markdown = `
# Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan

*"Bisnis Anda naik kelas dari Menengah ke Besar? Jangan sampai operasional dihentikan. Pahami kewajiban perubahan data OSS perusahaan menurut PP 28/2025."*

Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.

Namun, di balik euforia pertumbuhan omzet, jajaran Direksi sering kali melupakan satu aspek krusial: **Kepatuhan Legalitas (Legal Compliance)**.

Banyak pelaku usaha mengira bahwa Nomor Induk Berusaha (NIB) yang dicetak saat perusahaan masih berstatus rintisan akan berlaku abadi tanpa perlu diurus ulang. Ini adalah asumsi yang sangat berbahaya. Dalam rezim hukum investasi Indonesia, peningkatan skala bisnis dan nilai modal dapat memicu perubahan tingkat risiko usaha.
`;

const whyText = "Membawa bisnis berkembang dari skala Menengah menjadi Usaha Besar adalah pencapaian luar biasa. Peningkatan ini biasanya ditandai dengan meroketnya nilai investasi, lonjakan kapasitas produksi, ekspansi cabang, hingga penambahan jumlah tenaga kerja secara masif.";

console.log('Match WHY:', findTextMatch(markdown, whyText));


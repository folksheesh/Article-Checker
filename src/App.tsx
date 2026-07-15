import { useState, useRef } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader,
  FileText,
  Send,
  Check,
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Image as ImageIcon,
  Link as LinkIcon,
  Eraser,
  Eye,
  ListChecks,
  Scale,
  ShieldCheck,
  Sparkles,
  BookOpen,
  MinusCircle,
  CircleHelp,
  Upload,
} from 'lucide-react';
import {
  autoReviseItem,
  calculateSopScore,
  evaluateWithAI,
  runSopChecks,
  TARGET_WORD_MAX,
  TARGET_WORD_MIN,
  type CheckResult,
  type SopReport,
} from './sop';

const STATUS_GUIDE: Record<string, string> = {
  HIJAU: 'Semua poin checklist sudah terpenuhi. Artikel siap diterbitkan oleh Manager.',
  KUNING: 'Ada 1–2 poin yang belum sesuai SOP. Perbaiki bagian tersebut sebelum upload CMS.',
  MERAH: 'Ada 3 atau lebih poin yang belum sesuai. Perlu perbaikan besar atau penulisan ulang.',
};

export default function App() {
  const [article, setArticle] = useState('');
  const [keyword, setKeyword] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDesc, setMetaDesc] = useState('');

  const [isChecking, setIsChecking] = useState(false);
  const [report, setReport] = useState<SopReport | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('preview');

  const [correctingId, setCorrectingId] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isAiEvaluating, setIsAiEvaluating] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyFormat = (prefix: string, suffix = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = article.substring(start, end);

    const newText =
      article.substring(0, start) + prefix + selectedText + suffix + article.substring(end);
    setArticle(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const stripMarkdown = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = article.substring(start, end);

    const cleaned = selectedText
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^[-*]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1');

    const newText = article.substring(0, start) + cleaned + article.substring(end);
    setArticle(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + cleaned.length);
    }, 0);
  };

  const mockArticles = [
    {
      keyword: 'syarat perjanjian kerjasama',
      metaTitle: 'Pembahasan Mengenai Syarat Kontrak Bisnis',
      metaDesc: 'Pembahasan mengenai syarat sah perjanjian kontrak dalam hukum bisnis di Indonesia.',
      article: `# Pembahasan Mengenai Syarat Kontrak Bisnis
Setiap perjanjian yang dibuat secara sah berlaku sebagai undang-undang bagi para pihak. Pahami syarat sah kontrak agar bisnis Anda aman.

Ketidakpahaman terhadap dasar hukum perjanjian dapat menyebabkan kerugian finansial yang signifikan. Banyak pengusaha baru yang menyesal karena klausul kontrak yang tidak jelas.

## 1. Syarat Sah Perjanjian
Pasal 1320 KUH Perdata menyebutkan empat syarat sah perjanjian: kesepakatan para pihak, kecakapan hukum, objek tertentu, dan causa yang halal.

## 2. Akibat Hukum jika Syarat Tidak Terpenuhi
Jika salah satu syarat tidak dipenuhi, perjanjian dapat batal demi hukum atau dapat dibatalkan melalui pengadilan.

Menurut data Mahkamah Agung, lebih dari 40% perkara perdata yang masuk ke pengadilan negeri berkaitan dengan sengketa kontrak. Ini menunjukkan betapa pentingnya memahami syarat sah perjanjian.

Baca juga: [Akta Notaris vs Akta Bawah Tangan](#), [Hukum Perusahaan](#), [Tips Memilih Lawyer](#)
Internal Link: [Layanan Review Kontrak](#), [Konsultasi Hukum Perusahaan](#)

![Ilustrasi perjanjian kontrak bisnis di atas meja](kontrak.jpg)

Butuh bantuan menyusun kontrak bisnis yang aman? Konsultasikan dengan tim legal kami hari ini juga!` },
    {
      keyword: 'mendirikan pt perorangan',
      metaTitle: '5 Langkah Mudah Mendirikan PT Perorangan 2026',
      metaDesc: 'Panduan langkah demi langkah mendirikan PT Perorangan tanpa minimal modal. Cocok untuk UMKM dan startup pemula.',
      article: `# 5 Langkah Mudah Mendirikan PT Perorangan 2026
PT Perorangan adalah solusi badan hukum bagi UMKM. Prosesnya mudah dan cepat. Anda tidak perlu modal besar untuk memulainya.

Sejak diterbitkannya UU Cipta Kerja, proses pendirian PT Perorangan menjadi sangat sederhana dan terjangkau. Banyak pelaku usaha yang sudah beralih ke bentuk badan hukum ini. Sayangnya masih banyak yang belum memahami prosedur pendaftarannya. Inilah panduan lengkap untuk Anda.

## 1. Siapkan Dokumen Persyaratan Anda harus menyiapkan KTP, NPWP, dan surat pernyataan pendirian. Anda bisa mengunduh format surat pernyataan dari website resmi Kemenkumham. Proses ini tidak memakan waktu lama jika dokumen sudah lengkap.

## 2. Daftar Melalui SISMINAKUM Pendaftaran dilakukan secara online melalui sistem SISMINAKUM. Biaya pendaftaran sangat terjangkau, hanya sekitar Rp 50 ribu. Proses verifikasi biasanya memakan waktu 1-3 hari kerja.

## 3. Buat NPWP Perusahaan Setelah akta terbit, segera daftarkan NPWP perusahaan. NPWP diperlukan untuk membuka rekening bank dan keperluan perpajakan.

Baca juga: [Perbedaan PT dan CV](#), [Biaya Pendirian Badan Usaha](#), [Cara Bayar Pajak Badan Usaha](#)
Internal Link: [Jasa Pendirian PT Perorangan](#), [Konsultasi Legal UMKM](#)

![Proses pendaftaran PT Perorangan melalui komputer](pt-perorangan.jpg)

Siap mendirikan PT Perorangan? Tim legal kami siap membantu Anda dari awal hingga akta terbit. Hubungi kami sekarang!` },
    {
      keyword: 'hak cipta konten digital',
      metaTitle: '3 Cara Melindungi Hak Cipta Konten Digital',
      metaDesc: 'Lindungi konten digital Anda dari pembajakan. Pahami prosedur pencatatan hak cipta dan langkah perlindungan hukumnya.',
      article: `# 3 Cara Melindungi Hak Cipta Konten Digital
Konten digital adalah aset berharga yang perlu dilindungi secara hukum. Catatkan hak cipta Anda agar tidak diklaim pihak lain.

Proses pencatatan hak cipta bisa dilakukan secara online melalui DJKI. Biayanya pun terjangkau untuk kreator individu.

## 1. Buat Karya yang Orisinal
Pastikan konten yang Anda buat benar-benar hasil karya sendiri. Hak cipta lahir secara otomatis, tetapi pencatatan memberikan bukti hukum yang kuat.

## 2. Catatkan di e-Hak Cipta DJKI
Pendaftaran dilakukan melalui portal e-Hak Cipta. Siapkan KTP, NPWP, dan contoh karya. Biaya pendaftaran mulai dari Rp 200 ribu.

## 3. Gunakan Lisensi
Tambahkan lisensi Creative Commons untuk mengatur penggunaan karya Anda oleh pihak lain.

Baca juga: [Perbedaan Hak Cipta dan Paten](#), [Cara Lapor Pelanggaran Hak Cipta](#)
Internal Link: [Layanan Pencatatan Hak Cipta](#)

![gambar](hak-cipta.jpg)

Hubungi kami.` },
    {
      keyword: 'legalitas content creator',
      metaTitle: 'Panduan Legalitas untuk Content Creator Pemula',
      metaDesc: 'Pahami kewajiban hukum sebagai content creator agar terhindar dari sengketa kontrak dan masalah perpajakan.',
      article: `# Panduan Legalitas untuk Content Creator Pemula
Menjadi content creator bukan sekadar membuat konten viral. Kamu perlu memahami aspek legal agar karier kamu aman ke depannya.

Banyak kreator pemula yang terkena masalah hukum karena tidak memiliki perjanjian kerja sama yang jelas dengan brand.

## 1. Urus NPWP
Setiap kreator yang memiliki penghasilan wajib memiliki NPWP. Untuk omzet besar, pertimbangkan membuat PT Perorangan.

## 2. Buat Perjanjian Kerja Sama
Setiap endorse harus ada perjanjian tertulis. Cantumkan jumlah tayangan, tenggat waktu, dan pembayaran.

## 3. Patuhi Aturan Iklan
Konten endorse wajib mencantumkan keterangan #ad atau #sponsored. Ini diatur oleh pedoman OJK dan BPKN.

Baca juga: [Pajak Penghasilan Kreator](#), [Cara Membuat Kontrak Endorse](#), [Perlindungan Konten Digital](#)
Internal Link: [Konsultasi Legal Kreator](#), [Jasa Pembuatan Kontrak](#)

![gambar](content-creator.jpg)

Butuh bantuan mengurus legalitas sebagai kreator? Tim kami siap membantu kamu dari awal hingga akhir.` },
    {
      keyword: 'perjanjian kerjasama',
      metaTitle: 'Panduan Lengkap Membuat Perjanjian Kerjasama Bisnis yang Kuat dan Mengikat Hukum',
      metaDesc: '',
      article: `# Panduan Lengkap Membuat Perjanjian Kerjasama Bisnis
Setiap kerjasama bisnis harus didasari perjanjian yang jelas. Tanpa perjanjian tertulis, risiko sengketa sangat tinggi dan bisa merugikan kedua belah pihak.

Banyak pelaku usaha yang mengabaikan pentingnya perjanjian tertulis karena alasan kepercayaan. Padahal, sengketa bisnis sering muncul justru di antara pihak yang saling percaya. Perlindungan hukum yang paling kuat adalah dokumen yang sah.

## 1. Identitas Para Pihak
Cantumkan nama lengkap, alamat, dan kedudukan hukum masing-masing pihak dengan benar.

## 2. Objek Kerjasama
Jelaskan secara rinci barang atau jasa yang menjadi objek perjanjian. Semakin detail semakin baik untuk menghindari multitafsir.

## 3. Jangka Waktu
Tentukan kapan perjanjian mulai berlaku dan kapan berakhir. Sertakan juga opsi perpanjangan jika diperlukan.

## 4. Penyelesaian Sengketa
Pilih forum penyelesaian sengketa: pengadilan atau arbitrase. Cantumkan domisili hukum yang jelas.

Menurut data pengadilan negeri, sengketa kontrak menjadi salah satu perkara perdata yang paling sering ditangani setiap tahunnya. Oleh karena itu, perjanjian yang baik adalah investasi jangka panjang.

Pastikan setiap perjanjian yang Anda buat sudah memenuhi syarat sah sesuai Pasal 1320 KUH Perdata. Konsultasikan dengan ahli hukum untuk hasil yang maksimal.` },
  ];

  const loadMockArticle = () => {
    const pick = mockArticles[Math.floor(Math.random() * mockArticles.length)];
    setKeyword(pick.keyword);
    setMetaTitle(pick.metaTitle);
    setMetaDesc(pick.metaDesc);
    setArticle(pick.article);
  };

  const STOP_WORDS = new Set([
    'cara', 'untuk', 'yang', 'dan', 'dari', 'dengan', 'pada', 'di', 'ke', 'membuat', 'panduan', 'lengkap',
    'tips', 'langkah', 'mudah', 'anda', 'bisa', 'akan', 'adalah', 'ini', 'itu', 'atau', 'saja', 'juga', 'oleh',
    'dalam', 'per', 'usaha', 'bisnis', 'hukum', 'legal', 'bagaimana', 'mengapa', 'apa', 'sudah', 'belum', 'dapat',
    'agar', 'bagi', 'supaya', 'dalam', 'pada', 'dari', 'dengan', 'untuk', 'sebuah', 'beberapa', 'seluruh', 'setiap',
  ]);

  function deriveKeyword(title: string) {
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    if (words.length >= 2) return `${words[0]} ${words[1]}`;
    if (words.length === 1) return words[0];
    return title.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(' ') || title;
  }

  function extractDocumentMetadata(text: string) {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return { title: '', description: '', keyword: '' };

    let title = lines[0].replace(/^#+\s*/, '').trim();
    if (title.length > 60) title = title.slice(0, 60);

    let description = '';
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (
        line.length > 20 &&
        !line.startsWith('#') &&
        !line.startsWith('![') &&
        !line.startsWith('Baca juga:') &&
        !line.startsWith('Internal Link:')
      ) {
        description = line;
        break;
      }
    }
    if (description.length > 160) {
      description = description.slice(0, 157).trim() + '...';
    }

    const keyword = deriveKeyword(title);
    return { title, description, keyword };
  }

  function reconstructPdfText(content: { items: any[] }) {
    const items = content.items
      .filter((item) => 'str' in item && item.str.trim().length > 0)
      .map((item) => ({
        text: item.str as string,
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        hasEOL: 'hasEOL' in item ? Boolean(item.hasEOL) : false,
      }));

    if (items.length === 0) return '';

    items.sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 5) return yDiff;
      return a.x - b.x;
    });

    const lines: string[][] = [];
    let currentLine: string[] = [];
    let currentY: number | null = null;

    for (const item of items) {
      if (currentY === null || Math.abs(item.y - currentY) > 5) {
        if (currentLine.length > 0) lines.push(currentLine);
        currentLine = [];
        currentY = item.y;
      }
      currentLine.push(item.text);
    }
    if (currentLine.length > 0) lines.push(currentLine);

    return lines
      .map((line) => line.join(' ').replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');
  }

  const extractTextFromFile = async (file: File): Promise<string> => {
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'txt' || extension === 'md' || extension === 'html' || extension === 'htm') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Gagal membaca file teks.'));
        reader.readAsText(file);
      });
    }

    if (extension === 'docx') {
      const [{ default: mammoth }] = await Promise.all([
        import('mammoth'),
      ]);
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    }

    if (extension === 'pdf') {
      const [pdfjs, workerUrl] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += reconstructPdfText(content) + '\n';
      }
      return text
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }

    throw new Error('Format file tidak didukung. Gunakan .txt, .md, .docx, atau .pdf');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError('');
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) {
        throw new Error('File kosong atau tidak bisa diekstrak menjadi teks.');
      }
      const { title, description, keyword } = extractDocumentMetadata(text);
      setArticle(text);
      if (title) setMetaTitle(title);
      if (description) setMetaDesc(description);
      if (keyword) setKeyword(keyword);
      setToastMsg(`Berhasil memuat "${file.name}"`);
      setTimeout(() => setToastMsg(''), 4000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal mengunggah file.';
      setError(message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const runQualityCheck = async () => {
    if (!article.trim() || !metaTitle.trim()) {
      setError('Lengkapi judul dan isi artikel terlebih dahulu.');
      return;
    }

    setError('');
    setIsChecking(true);
    setIsAiEvaluating(false);
    setReport(null);
    setActiveTab('qa');

    window.setTimeout(async () => {
      try {
        const ruleReport = runSopChecks({ article, keyword, metaTitle, metaDesc });

        if (apiKey.trim()) {
          setIsAiEvaluating(true);
          const aiResults = await evaluateWithAI(
            { article, keyword, metaTitle, metaDesc },
            apiKey,
          );
          setIsAiEvaluating(false);
          const combined = calculateSopScore([...ruleReport.items, ...aiResults], ruleReport.wordCount);
          setReport(combined);
        } else {
          setReport(ruleReport);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Gagal memproses artikel.';
        setError(message);
      } finally {
        setIsChecking(false);
        setIsAiEvaluating(false);
      }
    }, 280);
  };

  const handleAutoCorrect = async (item: CheckResult) => {
    if (item.status === 'deferred') {
      setToastMsg('Pengecekan regulasi belum tersedia — bagian ini tidak diubah.');
      setTimeout(() => setToastMsg(''), 4000);
      return;
    }

    setCorrectingId(item.id);
    try {
      const revised = await autoReviseItem({ article, keyword, metaTitle, metaDesc }, item, apiKey);

      setArticle(revised.article);
      setMetaTitle(revised.metaTitle);
      setMetaDesc(revised.metaDesc);

      const nextReport = runSopChecks({
        article: revised.article,
        keyword,
        metaTitle: revised.metaTitle,
        metaDesc: revised.metaDesc,
      });
      setReport(nextReport);

      setToastMsg(revised.message);
      setTimeout(() => setToastMsg(''), 5000);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Gagal memperbaiki otomatis.';
      alert(message);
    } finally {
      setCorrectingId(null);
    }
  };

  const renderHighlightedPreview = () => {
    if (!article) return { __html: '' };

    let htmlText = article
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (report?.items) {
      const failedItems = report.items.filter(
        (item) => item.status === 'failed' && item.problematic_text,
      );
      failedItems.forEach((item) => {
        const escapedProblem = item.problematic_text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        const safeReason = item.reason.replace(/"/g, '&quot;');

        if (escapedProblem.trim().length > 0) {
          htmlText = htmlText
            .split(escapedProblem)
            .join(
              `<mark class="highlight-mark" data-reason="Perlu diperbaiki: ${safeReason}">${escapedProblem}</mark>`,
            );
        }
      });
    }

    htmlText = htmlText
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-5 mb-2">$1</h3>')
      .replace(
        /^## (.*$)/gim,
        '<h2 class="text-xl font-semibold mt-6 mb-2 border-b border-ink-100 pb-2">$1</h2>',
      )
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-semibold mt-2 mb-4 text-ink-900">$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/\[(.*?)]\((.*?)\)/gim, '<a href="$2">$1</a>')
      .replace(/\n/g, '<br/>');

    return { __html: htmlText };
  };

  const statusIcon = (item: CheckResult) => {
    if (item.status === 'deferred') {
      return <MinusCircle className="w-5 h-5 text-ink-700/40" />;
    }
    if (item.passed) {
      return <CheckCircle className="w-5 h-5 text-emerald-600" />;
    }
    return <XCircle className="w-5 h-5 text-seal-600" />;
  };

  const statusPlainLabel = (label: string) => {
    if (label === 'HIJAU') return 'Lulus';
    if (label === 'KUNING') return 'Perlu revisi';
    return 'Belum layak';
  };

  return (
    <div className="min-h-screen font-sans text-ink-900">
      <header className="sticky top-0 z-20 border-b border-ink-100/80 bg-white/90 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-5 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-ink-900 p-2.5 rounded-lg shrink-0">
              <Scale className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-xl sm:text-2xl font-semibold text-ink-900 tracking-tight truncate">
                Pemeriksa Artikel
              </p>
              <p className="text-xs sm:text-sm text-ink-700/70 truncate">
                Pemeriksaan mutu konten hukum sesuai SOP internal
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-ink-700/80 text-sm">
            <ShieldCheck className="w-4 h-4 text-seal-600" />
            <span>Berpedoman pada checklist QA SOP</span>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-5 sm:px-6 py-8 sm:py-10">
        <section className="mb-8 animate-fade-up">
          <h1 className="font-display text-3xl sm:text-[2.15rem] font-semibold text-ink-900 leading-tight max-w-2xl">
            Pastikan artikel hukum Anda mudah dipahami dan siap diterbitkan
          </h1>
          <p className="mt-3 text-ink-700/80 max-w-2xl leading-relaxed">
            Isi kata kunci dan naskah, lalu klik periksa. Sistem akan menandai bagian yang belum
            sesuai standar penulisan — tanpa istilah teknis yang membingungkan.
          </p>

          <ol className="mt-5 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-6 text-sm text-ink-800">
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-900 text-white text-xs font-bold">
                1
              </span>
              Isi kata kunci &amp; meta
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-900 text-white text-xs font-bold">
                2
              </span>
              Tulis atau tempel artikel
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-900 text-white text-xs font-bold">
                3
              </span>
              Periksa &amp; perbaiki
            </li>
          </ol>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 items-start">
          <section className="panel p-5 sm:p-6 lg:h-[42rem] flex flex-col overflow-hidden animate-fade-up" style={{ animationDelay: '60ms' }}>
            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <h2 className="font-display text-xl font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-seal-600" />
                  Naskah artikel
                </h2>
                <p className="text-sm text-ink-700/70 mt-1">
                  Gunakan format Markdown sederhana (judul, subjudul, tautan).
                </p>
              </div>
              <button type="button" onClick={loadMockArticle} className="btn-secondary shrink-0">
                <BookOpen className="w-4 h-4 mr-1.5" />
                Contoh
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".txt,.md,.docx,.pdf"
                className="hidden"
                aria-label="Unggah dokumen"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="btn-secondary shrink-0"
              >
                {isUploading ? (
                  <>
                    <Loader className="w-4 h-4 mr-1.5 animate-spin" />
                    Memuat…
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-1.5" />
                    Unggah
                  </>
                )}
              </button>
            </div>

            <div className="flex-1 flex flex-col gap-5 overflow-hidden">
              <div>
                <label className="field-label" htmlFor="keyword">
                  Kata kunci utama
                </label>
                <input
                  id="keyword"
                  type="text"
                  className="field-input"
                  placeholder="Contoh: mendaftarkan merek"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <p className="field-hint">
                  Topik utama pencarian yang harus muncul di judul artikel.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="field-label flex justify-between gap-2" htmlFor="metaTitle">
                    <span>Judul <span className="text-seal-600">*</span></span>
                    <span
                      className={`text-xs font-semibold tabular-nums ${metaTitle.length > 60 ? 'text-seal-600' : 'text-ink-700/50'}`}
                    >
                      {metaTitle.length}/60
                    </span>
                  </label>
                  <input
                    id="metaTitle"
                    type="text"
                    className="field-input text-sm"
                    placeholder="Maksimal 60 karakter"
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                  />
                  <p className="field-hint">Judul yang tampil di hasil pencarian.</p>
                </div>
                <div>
                  <label className="field-label flex justify-between gap-2" htmlFor="metaDesc">
                    <span>Deskripsi</span>
                    <span
                      className={`text-xs font-semibold tabular-nums ${metaDesc.length > 160 ? 'text-seal-600' : 'text-ink-700/50'}`}
                    >
                      {metaDesc.length}/160
                    </span>
                  </label>
                  <input
                    id="metaDesc"
                    type="text"
                    className="field-input text-sm"
                    placeholder="Maksimal 160 karakter"
                    value={metaDesc}
                    onChange={(e) => setMetaDesc(e.target.value)}
                  />
                  <p className="field-hint">Cuplikan singkat yang menarik pembaca.</p>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="apiKey">API Key Gemini (opsional)</label>
                <input
                  id="apiKey"
                  type="password"
                  className="field-input text-sm"
                  placeholder="Isi untuk mengaktifkan evaluasi AI"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <p className="field-hint">
                  AI akan menilai nada bahasa, koherensi, akurasi klaim, dan kualitas CTA.
                </p>
              </div>

              <div className="lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
                <label className="field-label" htmlFor="article">
                  Isi artikel <span className="text-seal-600">*</span>
                </label>
                <div className="border border-ink-100 rounded-lg overflow-hidden focus-within:border-ink-700 focus-within:ring-2 focus-within:ring-ink-700/15 transition bg-white lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
                  <div className="bg-ink-50 border-b border-ink-100 px-2 py-1.5 flex gap-0.5">
                    <button
                      type="button"
                      onClick={() => applyFormat('# ', '')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Judul"
                    >
                      <Heading1 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat('## ', '')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Subjudul"
                    >
                      <Heading2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat('### ', '')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Sub-poin"
                    >
                      <Heading3 className="w-4 h-4" />
                    </button>
                    <div className="w-px h-5 bg-ink-200 mx-1 my-auto" />
                    <button
                      type="button"
                      onClick={() => applyFormat('**', '**')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Tebal"
                    >
                      <Bold className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat('*', '*')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Miring"
                    >
                      <Italic className="w-4 h-4" />
                    </button>
                    <div className="w-px h-5 bg-ink-200 mx-1 my-auto" />
                    <button
                      type="button"
                      onClick={() => applyFormat('- ', '')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Daftar"
                    >
                      <List className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat('1. ', '')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Daftar bernomor"
                    >
                      <ListOrdered className="w-4 h-4" />
                    </button>
                    <div className="w-px h-5 bg-ink-200 mx-1 my-auto" />
                    <button
                      type="button"
                      onClick={() => applyFormat('[Teks tautan](', ')')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Tautan"
                    >
                      <LinkIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat('![Teks alt](', ')')}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Gambar"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>
                    <div className="w-px h-5 bg-ink-200 mx-1 my-auto" />
                    <button
                      type="button"
                      onClick={stripMarkdown}
                      className="p-2 hover:bg-white rounded-md text-ink-800/80 hover:text-ink-900 transition"
                      title="Hapus format"
                    >
                      <Eraser className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    id="article"
                    ref={textareaRef}
                    className="w-full p-4 h-72 sm:h-80 lg:h-auto lg:flex-1 lg:min-h-0 outline-none text-sm leading-relaxed resize-none bg-white font-sans"
                    placeholder={
                      'Contoh:\n# Judul artikel\nKalimat pembuka singkat...\n\n## 1. Langkah pertama\nPenjelasan prosedur...'
                    }
                    value={article}
                    onChange={(e) => setArticle(e.target.value)}
                  />
                </div>
                <p className="field-hint">
                  Target panjang SOP: {TARGET_WORD_MIN.toLocaleString('id-ID')}–
                  {TARGET_WORD_MAX.toLocaleString('id-ID')} kata.
                </p>
              </div>

              {error && (
                <div
                  className="bg-seal-50 text-seal-700 p-3.5 rounded-lg text-sm flex items-start border border-seal-100"
                  role="alert"
                >
                  <AlertTriangle className="w-5 h-5 mr-2.5 shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={runQualityCheck}
                disabled={isChecking || correctingId !== null}
                className="btn-primary"
              >
                {isChecking ? (
                  <>
                    <Loader className="w-5 h-5 mr-2 animate-spin" />
                    {isAiEvaluating ? 'AI sedang meninjau…' : 'Sedang memeriksa…'}
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2" /> Periksa kualitas artikel
                  </>
                )}
              </button>
            </div>
          </section>

          <section
            className="panel min-h-[32rem] lg:h-[42rem] flex flex-col overflow-hidden animate-fade-up"
            style={{ animationDelay: '120ms' }}
          >
            {!report && !isChecking && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 sm:p-10">
                <div className="bg-ink-50 p-4 rounded-xl mb-5">
                  <CircleHelp className="w-10 h-10 text-ink-700/50" />
                </div>
                <h3 className="font-display text-xl font-semibold text-ink-900">
                  Hasil pemeriksaan akan muncul di sini
                </h3>
                <p className="text-sm mt-2 max-w-sm text-ink-700/70 leading-relaxed">
                  Setelah diperiksa, Anda akan melihat status kelayakan, daftar poin SOP, dan
                  pratinjau bagian yang perlu diperbaiki.
                </p>
              </div>
            )}

            {isChecking && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
                <div className="relative w-16 h-16 mb-5">
                  <div className="absolute inset-0 border-[3px] border-ink-100 rounded-full" />
                  <div className="absolute inset-0 border-[3px] border-ink-900 rounded-full border-t-transparent animate-spin" />
                </div>
                <h3 className="font-display text-xl font-semibold text-ink-900">
                  Memeriksa naskah…
                </h3>
                <p className="text-sm text-ink-700/70 mt-2 max-w-xs">
                  Membandingkan artikel dengan checklist SOP penulisan konten hukum.
                </p>
              </div>
            )}

            {report && !isChecking && (
              <div className="flex flex-col h-full">
                <div className="flex border-b border-ink-100 shrink-0 bg-ink-50/60">
                  <button
                    type="button"
                    onClick={() => setActiveTab('qa')}
                    className={`flex-1 py-3.5 text-sm font-semibold flex items-center justify-center border-b-2 transition ${
                      activeTab === 'qa'
                        ? 'border-ink-900 text-ink-900 bg-white'
                        : 'border-transparent text-ink-700/60 hover:text-ink-900'
                    }`}
                  >
                    <ListChecks className="w-4 h-4 mr-2" /> Hasil pemeriksaan
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className={`flex-1 py-3.5 text-sm font-semibold flex items-center justify-center border-b-2 transition ${
                      activeTab === 'preview'
                        ? 'border-ink-900 text-ink-900 bg-white'
                        : 'border-transparent text-ink-700/60 hover:text-ink-900'
                    }`}
                  >
                    <Eye className="w-4 h-4 mr-2" /> Pratinjau
                  </button>
                </div>

                <div className="flex-grow overflow-y-auto p-5 sm:p-6 custom-scrollbar">
                  {activeTab === 'preview' && (
                    <div className="pb-6 animate-fade-up">
                      <div className="mb-5 p-3.5 bg-ink-900 text-white rounded-lg flex items-start text-sm">
                        <AlertTriangle className="w-5 h-5 mr-3 shrink-0 text-amber-300 mt-0.5" />
                        <p className="leading-relaxed">
                          Bagian yang ditandai perlu diperbaiki agar sesuai SOP. Arahkan kursor ke
                          teks berwarna untuk melihat alasannya.
                        </p>
                      </div>
                      <div
                        className="preview-content bg-ink-50 p-5 sm:p-6 rounded-lg border border-ink-100"
                        dangerouslySetInnerHTML={renderHighlightedPreview()}
                      />
                    </div>
                  )}

                  {activeTab === 'qa' && (
                    <div className="pb-6 animate-fade-up">
                      <div
                        className={`p-5 rounded-xl border mb-5 flex items-center justify-between gap-4 ${report.status.color}`}
                      >
                        <div>
                          <p className="text-xs uppercase tracking-wider font-semibold opacity-70 mb-1">
                            Status kelayakan
                          </p>
                          <h2 className="font-display text-2xl font-semibold">
                            {statusPlainLabel(report.status.label)}
                          </h2>
                          <p className="text-sm font-medium mt-1">{report.status.desc}</p>
                          <p className="text-xs mt-2 opacity-75 leading-relaxed max-w-sm">
                            {STATUS_GUIDE[report.status.label]}
                          </p>
                          <p className="text-xs mt-2 opacity-70">
                            Poin belum lulus: {report.failedCount} · Perkiraan kata:{' '}
                            {report.wordCount.toLocaleString('id-ID')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-semibold opacity-70 mb-1">Skor</p>
                          <div className="font-display text-4xl font-semibold tabular-nums">
                            {report.score}
                            <span className="text-lg opacity-50">/{report.scoredTotal}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-sm font-semibold text-ink-900 mb-3">
                        Checklist SOP ({report.items.length} poin)
                      </p>

                      <div className="space-y-2.5">
                        {report.items.map((item) => (
                          <div
                            key={item.id}
                            className={`p-4 rounded-lg border ${
                              item.status === 'deferred'
                                ? 'bg-ink-50/50 border-dashed border-ink-100'
                                : item.passed
                                  ? 'bg-white border-ink-100'
                                  : 'bg-seal-50/70 border-seal-100'
                            }`}
                          >
                            <div className="flex gap-3 items-start">
                              <div className="shrink-0 mt-0.5">{statusIcon(item)}</div>
                              <div className="flex-grow min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4
                                    className={`text-sm font-semibold leading-snug ${
                                      item.status === 'deferred'
                                        ? 'text-ink-700/70'
                                        : item.passed
                                          ? 'text-ink-900'
                                          : 'text-seal-700'
                                    }`}
                                  >
                                    {item.id}. {item.question}
                                  </h4>
                                  {item.status === 'deferred' && (
                                    <span className="text-[10px] uppercase tracking-wide font-bold bg-ink-100 text-ink-700/70 px-2 py-0.5 rounded">
                                      Nanti
                                    </span>
                                  )}
                                  {item.source === 'ai' && (
                                    <span className="text-[10px] uppercase tracking-wide font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">
                                      AI
                                    </span>
                                  )}
                                </div>
                                <p
                                  className={`text-sm mt-1 leading-relaxed ${
                                    item.status === 'deferred'
                                      ? 'text-ink-700/55'
                                      : item.passed
                                        ? 'text-ink-700/75'
                                        : 'text-seal-700/90'
                                  }`}
                                >
                                  {item.reason}
                                </p>

                                {item.status === 'failed' && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleAutoCorrect(item)}
                                      disabled={correctingId !== null}
                                      className={
                                        correctingId === item.id
                                          ? 'btn-fix opacity-70 cursor-wait'
                                          : 'btn-fix'
                                      }
                                    >
                                      {correctingId === item.id ? (
                                        <>
                                          <Loader className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                          Memperbaiki…
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                          Perbaiki otomatis
                                        </>
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setActiveTab('preview')}
                                      className="btn-ghost"
                                    >
                                      <Eye className="w-3.5 h-3.5 mr-1.5" /> Lihat di pratinjau
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {toastMsg && (
        <div className="fixed bottom-5 right-5 left-5 sm:left-auto sm:max-w-md bg-ink-900 text-white px-4 py-3 rounded-lg shadow-panel flex items-start z-50 animate-fade-up border border-ink-800">
          <Check className="w-5 h-5 mr-3 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed">{toastMsg}</p>
        </div>
      )}
    </div>
  );
}

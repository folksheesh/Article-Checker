import type { RuleId } from './types';

export const SOP_QUESTIONS: Record<RuleId, string> = {
  1: 'Apakah judul jelas, tegas, padat, menarik, dan tidak terlalu umum?',
  2: 'Apakah keyword utama sudah ada di judul?',
  3: 'Apakah kalimat pembuka (lead) terdiri atas 2 kalimat atau 12 kata?',
  4: 'Apakah intro (WHY) berhasil memaparkan urgensi masalah?',
  5: 'Apakah bagian tubuh (HOW) memuat prosedur dengan jelas?',
  6: 'Apakah bagian pendukung (WHAT) dilengkapi data, fakta, atau pandangan ahli?',
  7: 'Apakah struktur hirarki heading (H2/H3) sudah rapi?',
  8: 'Apakah tiap paragraf maksimal hanya berisi 3 kalimat?',
  9: 'Apakah gaya bahasa mudah dipahami oleh pembaca pemula?',
  10: 'Apakah CTA sudah diletakkan di bagian akhir dan relevan?',
  11: 'Apakah artikel bersih dari kesalahan ketik (typo) maupun kesalahan fakta?',
  12: 'Apakah referensi hukum yang digunakan merupakan aturan terkini yang masih berlaku?',
  13: 'Apakah internal link minimal 2 dan suggested posts minimal 3 sudah terpasang?',
  14: 'Apakah meta title dan meta description sudah diisi dengan benar?',
  15: 'Apakah alt text pada gambar sudah dibuat secara deskriptif?',
  16: 'Apakah keyword utama memiliki densitas dan distribusi yang seimbang?',
  17: 'Apakah panjang kalimat tetap ringan dan mudah dibaca (maksimal 25 kata)?',
  18: 'Apakah setiap heading memuat kata kunci atau indikator topik yang jelas?',
  19: 'Apakah artikel bebas dari kata lemah yang mengurangi kekuatan argumen?',
  20: 'Apakah panjang artikel sesuai target SOP (1000-1500 kata)?',
  51: 'Apakah nada bahasa profesional dan sesuai konteks legal?',
  52: 'Apakah alur antar paragraf koheren dan mudah diikuti?',
  53: 'Apakah klaim hukum dalam artikel akurat dan tidak menyesatkan?',
  54: 'Apakah CTA terasa persuasif dan relevan dengan topik?',
  55: 'Apakah pembukaan dan penutup artikel kuat serta memberikan kesan profesional?',
};

export const MAX_TITLE_CHARS = 60;
export const MAX_META_TITLE_CHARS = 60;
export const MAX_META_DESC_CHARS = 160;
export const MAX_SENTENCES_PER_PARAGRAPH = 3;
export const LEAD_TARGET_SENTENCES = 2;
export const LEAD_TARGET_WORDS = 12;
export const LEAD_WORD_TOLERANCE = 1;
export const MIN_INTERNAL_LINKS = 2;
export const MIN_SUGGESTED_POSTS = 3;
export const TARGET_WORD_MIN = 1000;
export const TARGET_WORD_MAX = 1500;

export const URGENCY_KEYWORDS = [
  'penting',
  'wajib',
  'risiko',
  'marak',
  'segera',
  'urgensi',
  'bahaya',
  'menghancurkan',
  'sebelum terlambat',
  'harus',
  'terlambat',
  'ancaman',
  'kerugian',
  'dibajak',
  'penolakan',
];

export const HOW_KEYWORDS = [
  'cara',
  'langkah',
  'syarat',
  'prosedur',
  'tahap',
  'langkah-langkah',
  'berikut',
];

export const WHAT_KEYWORDS = [
  'menurut',
  'data',
  'persen',
  'ahli',
  'undang-undang',
  'uu ',
  'peraturan',
  'bukti',
  'riset',
  'studi',
  'kutipan',
];

export const CTA_KEYWORDS = [
  'konsultasi',
  'konsultasikan',
  'hubungi',
  'daftar',
  'mendaftar',
  'klik',
  'tim legal',
  'butuh bantuan',
  'hubungi kami',
  'sekarang juga',
  'hari ini',
];

export const WEAK_CTA_EXACT = [
  'hubungi kami.',
  'hubungi kami',
  'klik di sini.',
  'klik di sini',
];

export const GENERIC_ALT = [
  'image',
  'gambar',
  'foto',
  'img',
  'photo',
  'ilustrasi',
];

export const WEAK_TITLE_WORDS = [
  'pembahasan',
  'mengenai',
  'tentang',
  'sekilas',
  'gambaran',
  'ulasan',
  'konsep',
  'teori',
  'definisi',
  'penjelasan',
  'apa itu',
  'perihal',
  'seputar',
];

export const STRONG_TITLE_WORDS = [
  'cara',
  'langkah',
  'tips',
  'panduan',
  'strategi',
  'manfaat',
  'risiko',
  'dampak',
  'akibat',
  'beda',
  'perbedaan',
  'alasan',
  'syarat',
  'prosedur',
  'hindari',
  'cegah',
  'lindungi',
  'melindungi',
  'daftar',
  'mendaftar',
  'melakukan',
  'menghindari',
  'menyelesaikan',
];

export const MIN_KEYWORD_DENSITY = 0.5;
export const MAX_KEYWORD_DENSITY = 2.5;
export const MAX_SENTENCE_WORDS = 25;
export const MAX_PARAGRAPH_WORDS = 60;

export const WEAK_WORDS = [
  'mungkin',
  'sepertinya',
  'agak',
  'kurang lebih',
  'dll',
  'dan lain-lain',
  'dahulu',
  'saja',
  'hanya',
  'cuma',
  'bisa jadi',
  'kayaknya',
  'seharusnya',
  ' mestinya',
];

export const POWER_WORDS = [
  'wajib',
  'penting',
  'hindari',
  'lindungi',
  'cegah',
  'aman',
  'risiko',
  'kerugian',
  'sanksi',
  'denda',
  'berlaku',
  'mengikat',
  'kuat',
  'tegas',
  'serius',
];

export const REGULATION_PATTERNS = [
  /\b(?:UU|Undang-Undang)\s*No\.?\s*\d{1,4}\s*(?:Tahun)?\s*\d{4}\b/gi,
  /\bPP\s*No\.?\s*\d{1,4}\s*(?:Tahun)?\s*\d{4}\b/gi,
  /\bPerpres\s*No\.?\s*\d{1,4}\s*(?:Tahun)?\s*\d{4}\b/gi,
  /\bPermen\s*\w+\s*No\.?\s*\d{1,4}\s*(?:Tahun)?\s*\d{4}\b/gi,
];

export const FORBIDDEN_REGULATIONS = ['pp 5/2021', 'pp no. 5/2021', 'peraturan pemerintah 5/2021'];

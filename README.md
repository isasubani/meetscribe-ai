# MeetScribe AI 🎙️⚡

> **Smart Realtime Meeting Transcript & AI Copilot**  
> Ekstensi browser Manifest V3 yang merekam, merapikan, dan menganalisis transkrip percakapan meeting secara realtime dari **Microsoft Teams**, **Google Meet**, dan **Zoom Web**.

---

## 🌟 Fitur Utama

### 1. 📝 Clean Transcript Engine
- **Auto Turn-On Captions (Otomatis Nyalakan CC)**: Begitu tombol `⚡ Connect` ditekan, ekstensi otomatis mencari dan menyalakan CC bawaan Google Meet, Teams, atau Zoom.
- **Deteksi Judul Meeting Otomatis**: Mendeteksi nama agenda / meeting dari DOM atau tab header untuk penamaan file ekspor yang presisi.
- **Speaker Talk-Time Analytics**: Visual bar multi-warna yang menghitung porsi waktu/kata bicara tiap peserta secara realtime (misal: *Hakim: 52%*, *Yohannes: 38%*).
- **Highlight / Pin Poin Penting (`📌 Pin`)**: Tandai ucapan keputusan atau kesepakatan penting dalam satu klik, lengkap dengan tombol filter khusus pinned.
- **Slide Snapshot (`📸 Slide`)**: Tangkapan layar presentasi instan yang langsung disisipkan ke alur menit transkrip.
- **Ekspor Format Markdown (`.md`)**: Menghasilkan file `.md` terstruktur rapi lengkap dengan tabel statistik pembicara, ringkasan pin/highlight, dan transkrip berurutan.
- **Anti-Duplikasi & Streaming Overlap**: Algoritma *suffix-to-prefix word matching* mencegah teks berulang saat speaker sedang berbicara.
- **Per-Element Lifecycle Tracking**: Menggunakan `WeakMap` untuk melacak elemen card caption di DOM.
- **Contiguous Speaker Grouping**: Menggabungkan kalimat berurutan dari pembicara yang sama ($< 30$ detik) dalam satu bubble rapi.

### 2. 🤖 AI Meeting Copilot (OpenAI-Compatible)
- **Konteks Realtime Otomatis**: Seluruh transkrip meeting yang telah dikelompokkan otomatis diinjeksikan sebagai konteks sistem prompt.
- **Quick Prompts**:
  - `✨ Ringkasan`: Ringkasan eksekutif poin penting pembahasan.
  - `✅ Action Items`: Deteksi to-do list, tugas, dan penanggung jawab (PIC).
  - `🎯 Keputusan`: Rangkuman kesepakatan final yang disetujui peserta.
  - `⚠️ Blocker`: Identifikasi risiko, kendala, atau isu yang sempat diutarakan.
- **Flexible Provider Support**:
  - **OpenAI** (`gpt-4o-mini`, `gpt-4o`)
  - **Groq** (`llama-3.3-70b-versatile`, inferensi ultra-cepat)
  - **Ollama** (`qwen2.5:latest`, `llama3.2`, berjalan 100% lokal & offline)
  - **OpenRouter** / **DeepSeek** (`deepseek-chat`)

### 3. 🌐 Dukungan Multi-Platform
- **Microsoft Teams**: `teams.microsoft.com`, `teams.live.com`, `teams.cloud.microsoft`.
- **Google Meet**: `meet.google.com`.
- **Zoom Web Client**: `*.zoom.us`.
- **Deteksi Otomatis & Kontrol Manual**: Tombol `⚡ Connect` / `⏹ Disconnect` untuk memastikan kontrol penuh kapan ekstensi mulai dan berhenti merekam.

---

## 📁 Struktur Direktori

```
meeting-transcript-extension/
├── manifest.json         # Konfigurasi Manifest V3, permissions, content scripts
├── content.js            # Engine ekstraksi DOM & event bridge multi-platform
├── popup.html            # Antarmuka Glassmorphism Dark Theme (Tabs: Transkrip, AI, Settings)
├── popup.js              # State manager, speaker grouping, per-speaker hash, OpenAI fetcher
├── icons/                # Icon resmi MeetScribe AI (16px, 32px, 48px, 128px)
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
├── HOW-TO-INSTALL.md     # Panduan langkah demi langkah cara pasang dan pakai
└── README.md             # Dokumentasi teknis & arsitektur project
```

---

## 🚀 Cara Instalasi Cepat

1. Buka browser Chromium favorit Anda (**Brave**, **Google Chrome**, atau **Microsoft Edge**).
2. Akses `brave://extensions` (atau `chrome://extensions`).
3. Nyalakan switch **Developer mode** di pojok kanan atas.
4. Klik **Load unpacked** dan pilih folder project ini:
   ```
   /Users/isasubani/Documents/meeting-transcript-extension
   ```
5. Pin icon **MeetScribe AI** di toolbar browser.
6. Baca panduan lengkap penggunaan di file [HOW-TO-INSTALL.md](./HOW-TO-INSTALL.md).

---

## 🛠️ Arsitektur Teknis

```
[ Active Meeting Tab ] (Teams / Meet / Zoom)
       │
       ▼ (Captions / CC DOM Nodes)
[ content.js ]
   ├── WeakMap Element Tracker (UID per card)
   ├── Suffix/Prefix Word Reconciler (mergeStreamText)
   ├── CustomEvent Bridge (meetscribe-message & meeting-speech-event)
   └── 500ms Debounced Storage Sync
       │
       ▼ (chrome.storage.local)
[ popup.js ]
   ├── Dynamic Platform Detector
   ├── Contiguous Turn Aggregator (groupLogsBySpeaker)
   ├── Speaker Palette Hashing (SHA-like color assignment)
   └── OpenAI API Requester (Streaming / Chat Completions)
```

---

## 🔒 Privasi & Keamanan

- **100% Client-Side**: Ekstensi tidak mengirim data rekaman meeting ke server pihak ketiga mana pun milik pembuat ekstensi.
- **Penyimpanan Lokal**: Transkrip meeting disimpan di dalam `chrome.storage.local` browser Anda sendiri.
- **Kredensial Aman**: API Key AI tersimpan secara lokal dan hanya dikirim langsung ke penyedia AI yang Anda konfigurasikan sendiri di menu Settings.

---

## 📄 Lisensi
MIT License © 2026 Isa Subani.

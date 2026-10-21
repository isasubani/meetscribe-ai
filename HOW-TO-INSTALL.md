# Panduan Instalasi & Penggunaan: Meeting AI & Transcript Recorder

Ekstensi browser (Manifest V3) untuk merekam transkrip meeting realtime dari **Microsoft Teams**, **Google Meet**, dan **Zoom Web** dengan asisten AI kompatibel OpenAI.

---

## 1. Cara Instal di Brave / Chrome / Edge

1. Buka browser (Brave, Google Chrome, atau Microsoft Edge).
2. Ketik alamat berikut di address bar lalu tekan Enter:
   - **Brave**: `brave://extensions`
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
3. Aktifkan **Developer mode** di pojok kanan atas halaman.
4. Klik tombol **Load unpacked** di pojok kiri atas.
5. Pilih folder ekstensi ini:
   ```
   /Users/isasubani/Documents/meeting-transcript-extension
   ```
6. Ekstensi bernama **Meeting AI & Transcript Recorder** akan muncul di daftar ekstensi.
7. Klik icon puzzle di toolbar browser $\rightarrow$ klik icon **Pin** agar icon ekstensi selalu muncul di toolbar.

---

## 2. Cara Menggunakan Saat Meeting

### Langkah Wajib:
1. Masuk ke ruang meeting Anda di browser (**Microsoft Teams**, **Google Meet**, atau **Zoom Web**).
2. **Nyalakan fitur Captions / CC bawaan platform**:
   - **Teams**: Klik menu titik tiga `...` (More) $\rightarrow$ **Language and speech** $\rightarrow$ **Turn on live captions**.
   - **Google Meet**: Klik tombol icon **CC** di bar kontrol bawah.
   - **Zoom Web**: Klik tombol **Show Captions** di bar kontrol meeting.
3. Klik icon ekstensi **Meeting AI** di toolbar browser.
4. Pastikan platform meeting terdeteksi (ditandai icon platform dan nama meeting).
5. Klik tombol **⚡ Connect**.
6. Badge status akan berubah menjadi **● Recording** (hijau berkedip). Teks transkrip otomatis masuk dan tersusun rapi per pembicara.

> **Catatan Penting**: Jika baru pertama kali memasang atau me-reload ekstensi, **refresh tab meeting** (Cmd + R) satu kali terlebih dahulu agar script perekam dapat terhubung.

---

## 3. Fitur Utama

### 📝 Tab 1: Transkrip Realtime & Analytics
- **Auto Turn-On CC**: Saat klik **⚡ Connect**, ekstensi akan otomatis mencoba menyalakan tombol Captions di Meet, Teams, atau Zoom.
- **Deteksi Judul Otomatis**: Judul meeting terbaca otomatis dan dijadikan nama file ekspor.
- **📊 Speaker Talk-Time**: Bar persentase warna-warni yang memperlihatkan dominasi bicara tiap peserta meeting.
- **📌 Pin / Highlight**: Klik tombol **☆ Pin** pada bubble mana pun untuk menandai keputusan penting, gunakan filter **📌 Pin** di toolbar untuk menyaringnya.
- **📸 Slide Snapshot**: Klik tombol **📸 Slide** untuk mengambil tangkapan layar materi presentasi yang sedang di-share dan menempelkannya di urutan transkrip.
- **💾 Ekspor Format `.md` (Markdown)**: Menghasilkan file markdown siap pakai untuk Notion / Obsidian / GitHub lengkap dengan tabel analitik dan highlight.
- **📋 Copy Markdown**: Salin seluruh struktur dokumen meeting dalam format markdown ke clipboard.

### 🤖 Tab 2: Ask AI (Asisten Meeting Cerdas)
Menjawab pertanyaan seputar percakapan meeting secara instan dengan menyertakan transkrip sebagai konteks:
- **Tombol Cepat**:
  - `✨ Ringkasan`: Ringkasan eksekutif poin penting meeting.
  - `✅ Action Items`: Daftar to-do list, task, dan penanggung jawab (PIC).
  - `🎯 Keputusan`: Kesepakatan atau poin final yang disepakati.
  - `⚠️ Blocker`: Risiko, kendala, atau isu yang sempat diangkat.
- **Chat Bebas**: Ketik pertanyaan apapun mengenai isi pembicaraan meeting.

### ⚙️ Tab 3: Konfigurasi AI (OpenAI-Compatible)
Dapat disambungkan ke berbagai penyedia model AI. Cukup klik salah satu tombol preset:
- **OpenAI**: Base URL `https://api.openai.com/v1`, Model `gpt-4o-mini`.
- **Groq** *(Sangat cepat & hemat)*: Base URL `https://api.groq.com/openai/v1`, Model `llama-3.3-70b-versatile`.
- **Ollama** *(Offline & Gratis)*: Base URL `http://localhost:11434/v1`, Model `qwen2.5:latest` atau `llama3.2`.
- **OpenRouter**: Base URL `https://openrouter.ai/api/v1`, Model `deepseek/deepseek-chat`.

Isi API Key milik Anda lalu klik **Simpan Konfigurasi**. API Key tersimpan aman di storage lokal browser.

---

## 4. Cara Update Kode (Jika Ada Perubahan)
1. Setelah mengubah kode file di dalam folder:
2. Buka `brave://extensions`.
3. Cari kartu **Meeting AI & Transcript Recorder**.
4. Klik icon **Reload (panah putar)** pada kartu tersebut.

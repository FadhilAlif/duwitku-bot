# 🤖 Duwitku WhatsApp Bot

Bot WhatsApp cerdas untuk mencatat keuangan pribadi dengan AI-powered categorization. Dibangun dengan [WAHA (WhatsApp HTTP API)](https://waha.devlike.pro/), Hono.js, Supabase, dan Google Gemini AI.
## ✨ Fitur

- 📝 **Pencatatan Otomatis**: Catat pengeluaran dan pemasukan via WhatsApp
- 🤖 **AI Kategorisasi**: Gemini AI secara otomatis mengkategorikan transaksi
- 💬 **Natural Language**: Ketik seperti chat biasa, bot mengerti
- 📊 **Multi-Entry**: Catat banyak transaksi sekaligus
- 📈 **Laporan Harian & Bulanan**: Lihat ringkasan keuangan dengan detail per kategori
- 🔄 **Real-time Sync**: Langsung tersinkronisasi ke database Supabase
- ⚡ **Performance Optimized**: Timeout handling, retry mechanism, dan webhook auto-registration
- 🐳 **Docker Ready**: Deploy dengan satu perintah

## 📋 Prerequisite

- Docker & Docker Compose
- Node.js 22+ (untuk development lokal)
- Akun Supabase
- Google Gemini API Key
- Nomor WhatsApp

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone <repository-url>
cd duwitku-bot
```

### 2. Setup Environment Variables

```bash
cp .env.example .env
```

Edit file `.env` dan isi dengan credential Anda:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
WAHA_API_URL=http://waha:3000
WHATSAPP_API_KEY=your-secure-api-key
GEMINI_API_KEY=your-gemini-api-key
```

**⚠️ Important:** Bot akan validasi semua environment variables saat startup. Jika ada yang kurang, bot akan exit dengan error message yang jelas.

### 3. Setup Docker Compose

```bash
cp docker-compose.example.yml docker-compose.yml
```

Edit `docker-compose.yml` dan sesuaikan:
- **WAHA_DASHBOARD_PASSWORD** - Ganti `change-this-password` dengan password kuat
- **WHATSAPP_SWAGGER_PASSWORD** - Ganti dengan password kuat
- **WHATSAPP_API_KEY** - Akan otomatis dibaca dari `.env`
- Port (jika diperlukan)

> ⚠️ **Note**: Password WAHA sengaja di hardcode di `docker-compose.yml` karena WAHA tidak support env variable untuk credentials. Pastikan ganti password default sebelum deploy production!

### 4. Jalankan dengan Docker

```bash
# Build dan jalankan
docker-compose up --build -d

# Atau gunakan script rebuild
chmod +x rebuild.sh
./rebuild.sh
```

### 5. Setup WhatsApp Session

1. Buka WAHA Dashboard: `http://localhost:3001`
2. Login dengan username/password yang Anda set
3. Buat session baru dengan nama `default`
4. Scan QR Code dengan WhatsApp Anda

### 6. Webhook Auto-Configuration ✨

Bot sekarang **otomatis mendaftarkan webhook** saat startup! Tidak perlu konfigurasi manual.

Bot akan:
- Otomatis register webhook ke WAHA pada startup
- Retry hingga 5x jika gagal (dengan delay 3 detik)
- Log detail status registrasi

**Verifikasi webhook berhasil:**
```bash
# Cek logs bot
docker-compose logs -f bot

# Cari pesan:
# ✅ Webhook registered successfully
```

**Troubleshooting:**
Jika webhook gagal register otomatis, bisa manual via WAHA Dashboard:
- Buka: `http://localhost:3001`
- Set webhook URL: `http://bot:5000/webhook`
- Events: `message`

## 📱 Cara Menggunakan Bot

### Menu Utama
Kirim pesan apa saja ke bot untuk menampilkan menu:
```
1️⃣ Cara Mencatat di Duwitku
2️⃣ Laporan Keuangan Hari Ini
3️⃣ Laporan Keuangan Bulan Ini
4️⃣ Download Aplikasi Duwitku
5️⃣ Lapor Kendala
```

### Catat Pengeluaran
```
Mie Ayam 15000
Bensin 50000
Kopi 12k
```

### Catat Pemasukan
```
duwitku Gajian 5000000
duwitku Freelance 1.5jt
```

### Catat Multiple Transaksi
```
Makan siang 25000
Es teh 5000
Parkir 2000
```

### Lihat Laporan Keuangan
```
2   # Laporan hari ini
3   # Laporan bulan ini
```

Laporan akan menampilkan:
- Total pemasukan dan pengeluaran
- Saldo (balance)
- Breakdown per kategori
- Daftar transaksi terakhir

## 🏗️ Arsitektur

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  WhatsApp   │ ───▶ │  WAHA API    │ ───▶ │  Duwitku    │
│   User      │      │  (Port 3001) │      │  Bot        │
└─────────────┘      └──────────────┘      │ (Port 5000) │
                            │               └──────┬──────┘
                            │                      │
                            └──── Webhook ─────────┘
                                                   │
                     ┌─────────────────────────────┼────────────────┐
                     ▼                             ▼                ▼
              ┌─────────────┐            ┌─────────────┐  ┌─────────────┐
              │  Supabase   │            │  Gemini AI  │  │  Category   │
              │  Database   │            │  (Auto Cat) │  │  Prediction │
              └─────────────┘            └─────────────┘  └─────────────┘
```

## 🗂️ Struktur Database (Supabase)

### Table: `profiles`
```sql
- id (uuid, primary key)
- phone_number (text, unique)
- created_at (timestamp)
```

### Table: `transactions`
```sql
- id (bigint, primary key)
- user_id (uuid, foreign key → profiles.id)
- category_id (bigint, foreign key → categories.id)
- wallet_id (bigint, foreign key → wallets.id, nullable)
- amount (numeric)
- type (text: 'income' | 'expense')
- description (text)
- transaction_date (timestamp)
- source_type (text: 'chat_prompt')
- created_at (timestamp)
```

### Table: `categories`
```sql
- id (bigint, primary key)
- name (text)
- type (text: 'income' | 'expense')
- user_id (uuid, nullable)
- is_default (boolean)
```

### Table: `wallets`
```sql
- id (bigint, primary key)
- name (text)
- user_id (uuid, foreign key)
- balance (numeric)
- created_at (timestamp)
```

## 🛠️ Development

### Menjalankan Lokal (Tanpa Docker)

```bash
# Install dependencies
npm install

# Set environment variables
export SUPABASE_URL="..."
export SUPABASE_SERVICE_KEY="..."
export WAHA_API_URL="http://localhost:3001"
export WHATSAPP_API_KEY="..."
export GEMINI_API_KEY="..."

# Jalankan bot
npm start
```

### Melihat Logs

```bash
# Semua services
docker-compose logs -f

# Hanya bot
docker-compose logs -f bot

# Hanya WAHA
docker-compose logs -f waha
```

### Restart Services

```bash
# Restart semua
docker-compose restart

# Restart bot saja
docker-compose restart bot
```

## 🌐 API Endpoints

Bot menyediakan beberapa endpoints:

### Health Check
```bash
GET http://localhost:5000/health
```
Response:
```json
{
  "status": "OK",
  "timestamp": "2024-12-11T10:30:00.000Z",
  "service": "duwitku-bot"
}
```

### Webhook Endpoint
```bash
POST http://localhost:5000/webhook
```
Endpoint ini digunakan oleh WAHA untuk mengirim message events. Otomatis terdaftar saat bot startup.

### Root Endpoint
```bash
GET http://localhost:5000/
```
Response:
```json
{
  "message": "Duwitku Bot is running",
  "version": "2.1.0"
}
```

## 🔧 Configuration

### Performance & Reliability

Bot dioptimasi dengan beberapa mekanisme untuk reliability:

1. **AI Timeout Protection** (10s)
   - Prevent hanging pada AI calls
   - Automatic fallback ke kategori default
   - Error handling & logging

2. **Webhook Auto-Registration**
   - Retry hingga 5x dengan delay 3s
   - Resilient terhadap startup race condition
   - Detailed logging untuk debugging

3. **Environment Validation**
   - Validasi semua required env vars saat startup
   - Clear error messages untuk missing configs
   - Fail-fast untuk mencegah runtime errors

4. **Error Logging**
   - Detailed logs untuk user lookup
   - Transaction error tracking
   - AI response debugging

### Konfigurasi di `index.js`

Semua konfigurasi tersentralisasi dalam objek `CONFIG`:

```javascript
const CONFIG = {
  port: parseInt(process.env.PORT) || 5000,
  wahaUrl: process.env.WAHA_API_URL || 'http://waha:3000',
  
  // Default category IDs (fallback when AI fails)
  defaultCategoryIncome: 28,
  defaultCategoryExpense: 29,
  
  // Performance settings
  aiTimeoutMs: 10000,              // Timeout untuk AI calls
  webhookRetryAttempts: 5,         // Retry webhook registration
  webhookRetryDelayMs: 3000,       // Delay antar retry
};
```

### Konfigurasi AI Model

Bot menggunakan `gemini-2.5-flash` untuk kategorisasi. Untuk mengubah model:

```javascript
const result = await ai.models.generateContent({
  model: 'gemini-2.5-flash',  // Ubah sesuai kebutuhan
  // ...
});
```

## 🐛 Troubleshooting

### Bot tidak merespons
1. Cek logs: `docker-compose logs -f bot`
2. Pastikan webhook sudah dikonfigurasi di WAHA
3. Cek koneksi network antar container
4. Bot akan otomatis retry webhook registration 5x saat startup

### Webhook registration gagal
1. Pastikan container `bot` sudah running sebelum `waha`
2. Cek docker-compose.yml: `waha` harus `depends_on: bot`
3. Lihat logs untuk error detail: `docker-compose logs -f bot waha`

### User tidak ditemukan (getUserId returns null)
1. Pastikan nomor telepon tersimpan di tabel `profiles`
2. Format nomor: `62XXXXXXXXXX` (tanpa +, spasi, atau dash)
3. Cek logs untuk melihat nomor yang dicari vs nomor di database
4. Test manual query di Supabase:
   ```sql
   SELECT * FROM profiles WHERE phone_number = '628XXXXXXXXX';
   ```

### Transaksi tidak tersimpan
1. Cek apakah kategori dengan ID tersebut exists
2. Cek apakah wallet dengan ID/nama tersebut exists
3. Lihat error di logs untuk detail SQL error
4. Validasi foreign key constraints di Supabase

### AI kategorisasi lambat/timeout
1. Default timeout: 10 detik (konfigurasi di `CONFIG.aiTimeoutMs`)
2. Jika sering timeout, naikkan nilai timeout
3. Pastikan API key Gemini valid dan tidak rate-limited
4. Bot akan fallback ke kategori default jika AI gagal

## 🚀 Deployment Tips

### Production Checklist
- [ ] Ganti semua password default di `docker-compose.yml`
- [ ] Set `WHATSAPP_API_KEY` yang kuat (min 16 karakter)
- [ ] Gunakan HTTPS jika deploy ke VPS (reverse proxy: nginx/caddy)
- [ ] Setup backup reguler untuk Supabase database
- [ ] Monitor logs: `docker-compose logs -f bot --tail=100`
- [ ] Setup restart policy: `restart: always` (sudah default)

### VPS Deployment
```bash
# Clone & setup
git clone <repo-url> && cd duwitku-bot
cp .env.example .env
nano .env  # Edit credentials

# Setup docker-compose
cp docker-compose.example.yml docker-compose.yml
nano docker-compose.yml  # Ganti password

# Deploy
docker-compose up -d

# Monitor
docker-compose logs -f
```

### Resource Requirements
- **RAM**: Minimum 512MB (recommended 1GB)
- **Storage**: ~500MB untuk images + session data
- **CPU**: 1 core (shared OK)
- **Network**: Stable connection untuk WhatsApp & API calls

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 Support

- **Email**: fadhil.alifp@gmail.com
- **WhatsApp**: +6285727304551
- **GitHub Issues**: [Create an issue](https://github.com/FadhilAlif/duwitku-bot/issues)

---

Built with ❤️ by [Fadhil Alif](https://github.com/FadhilAlif)

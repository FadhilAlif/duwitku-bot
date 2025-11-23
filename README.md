# 🤖 Duwitku WhatsApp Bot

Bot WhatsApp cerdas untuk mencatat keuangan pribadi dengan AI-powered categorization. Dibangun dengan [WAHA (WhatsApp HTTP API)](https://waha.devlike.pro/), Hono.js, Supabase, dan Google Gemini AI.

## ✨ Fitur

- 📝 **Pencatatan Otomatis**: Catat pengeluaran dan pemasukan via WhatsApp
- 🤖 **AI Kategorisasi**: Gemini AI secara otomatis mengkategorikan transaksi
- 💬 **Natural Language**: Ketik seperti chat biasa, bot mengerti
- 📊 **Multi-Entry**: Catat banyak transaksi sekaligus
- 🔄 **Real-time Sync**: Langsung tersinkronisasi ke database Supabase
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

### 6. Konfigurasi Webhook

Di WAHA Dashboard, set webhook:
- **URL**: `http://bot:5000/webhook`
- **Events**: `message`

Atau uncomment baris webhook di `docker-compose.yml` dan restart:

```bash
docker-compose restart waha
```

## 📱 Cara Menggunakan Bot

### Menu Utama
Kirim pesan apa saja ke bot untuk menampilkan menu:
```
1️⃣ Cara Mencatat di Duwitku
2️⃣ Laporan Keuangan Hari Ini (Coming Soon)
3️⃣ Laporan Keuangan Bulan Ini (Coming Soon)
4️⃣ Download Aplikasi Duwitku (Coming Soon)
5️⃣ Lapor Kendala (Coming Soon)
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

## 🏗️ Arsitektur

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  WhatsApp   │ ───▶ │  WAHA API    │ ───▶ │  Duwitku    │
│   User      │      │  (Port 3001) │      │  Bot        │
└─────────────┘      └──────────────┘      │ (Port 5000) │
                                            └──────┬──────┘
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
- user_id (uuid, foreign key)
- category_id (bigint, foreign key)
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

## 🔧 Configuration

### Konfigurasi Category ID

Edit di `index.js`:
```javascript
const CATEGORY_ID_INCOME = 28;  // ID kategori default income
const CATEGORY_ID_EXPENSE = 29; // ID kategori default expense
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

### WhatsApp terputus
1. Buka WAHA Dashboard
2. Restart session atau scan ulang QR Code

### Database error
1. Cek credential Supabase di `.env`
2. Pastikan table sudah dibuat dengan benar
3. Cek RLS (Row Level Security) policies

### AI Categorization gagal
1. Cek Gemini API Key
2. Cek quota API di Google AI Studio
3. Bot akan fallback ke kategori default jika AI gagal

## 🔒 Security Notes

**JANGAN** commit file berikut ke Git:
- `.env` - Credential rahasia
- `docker-compose.yml` - Berisi password
- `waha-session/` - Session WhatsApp

File-file ini sudah ada di `.gitignore`.

## 📄 License

MIT License - Silakan gunakan untuk project pribadi atau komersial.

## 🤝 Contributing

Pull requests are welcome! Untuk perubahan besar, silakan buka issue terlebih dahulu.

## 📞 Support

Jika ada kendala, silakan buat issue di repository ini.

---

**Built with ❤️ for personal finance tracking**

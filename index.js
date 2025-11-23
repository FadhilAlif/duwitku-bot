require('dotenv').config();
const { serve } = require('@hono/node-server');
const { Hono } = require('hono');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

const app = new Hono();

// --- KONFIGURASI ---
const PORT = 5000;
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://waha:3000';
const WAHA_API_KEY = process.env.WHATSAPP_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const CATEGORY_ID_INCOME = 28; 
const CATEGORY_ID_EXPENSE = 29;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// --- PESAN STATIS ---
const MSG_MAIN_MENU = `Halo Mas/Mbak! 👋
Saya *Duwitku BOT*🤖, asisten keuangan pribadi kamu 😊

Pilih opsi yang kamu butuhkan dengan mengetik angka:

1️⃣ Cara Mencatat di Duwitku
2️⃣ Laporan Keuangan Hari Ini (Coming Soon)
3️⃣ Laporan Keuangan Bulan Ini (Coming Soon)
4️⃣ Download Aplikasi Duwitku (Coming Soon)
5️⃣ Lapor Kendala (Coming Soon)

✨ *Tips:*
- Ketik angkanya saja. Contoh: *1* untuk "Cara Mencatat".`;

const MSG_HELP = `1️⃣ *Cara Mencatat di Duwitku*

📉 *Untuk Catat Pengeluaran (Expenses):*
Ketik: [Nama] [Harga]
Contoh:
*Mie Ayam Bantul 15000*

📈 *Untuk Catat Pemasukan (Income):*
Ketik: duwitku [Nama] [Jumlah]
Contoh:
*duwitku Gajian 5000000*

📋 *Catat Banyak Sekaligus:*
Gunakan Enter untuk pemisah baris:
Bakso 5000
Es teh 3000`;

// --- HELPER: UTILS ---
function getWIBDate() {
  const date = new Date();
  date.setHours(date.getHours() + 7);
  return date.toISOString();
}

function formatRupiah(num) {
  return num.toLocaleString('id-ID');
}

function parseAmount(str) {
  if (!str) return 0;
  let val = str.toLowerCase().replace(/rp|\.|,/g, '');
  if (val.includes('k') || val.includes('rb')) return parseFloat(val) * 1000;
  if (val.includes('jt') || val.includes('juta')) return parseFloat(val) * 1000000;
  return parseFloat(val);
}

// --- HELPER: WAHA ACTIONS ---
async function startTyping(chatId) {
  try {
    await fetch(`${WAHA_API_URL}/api/startTyping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
      body: JSON.stringify({ session: 'default', chatId }),
    });
  } catch (err) { /* silent */ }
}

async function stopTyping(chatId) {
  try {
    await fetch(`${WAHA_API_URL}/api/stopTyping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
      body: JSON.stringify({ session: 'default', chatId }),
    });
  } catch (err) { /* silent */ }
}

async function sendWhatsapp(chatId, text) {
  console.log(`📤 Mengirim pesan ke ${chatId}...`);
  try {
    await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
      body: JSON.stringify({ session: 'default', chatId, text }),
    });
  } catch (err) { console.error('Send WA Error:', err.message); }
}

// --- HELPER: DATABASE ---
async function getUserIdByPhone(phoneRaw) {
  const phoneNumber = phoneRaw.split('@')[0];
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone_number', phoneNumber)
    .single();
  if (error || !data) return null;
  return data.id;
}

// --- SMART CATEGORY AI (STABLE) ---
async function predictCategory(userId, description, amount, type) {
  console.log(`🤖 AI Predicting: "${description}" (${type})...`);

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('type', type)
    .or(`is_default.eq.true,user_id.eq.${userId}`);

  const aiCategories = categories?.filter(c => c.name !== 'Duwitku Bot') || [];

  if (aiCategories.length === 0) return null;

  const categoryListString = aiCategories.map(c => `${c.id}:${c.name}`).join(', ');

  const prompt = `
    You are a financial categorization engine. 
    Input: "${description}" (Amount: ${amount}, Type: ${type}).
    Available Categories (ID:Name): ${categoryListString}.
    Task: Select the single most appropriate Category ID.
    Return ONLY JSON: {"categoryId": <number>}
  `;
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash', 
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { categoryId: { type: 'INTEGER' } },
          required: ['categoryId']
        }
      }
    });

    const resultJSON = JSON.parse(result.text);
    const predictedId = resultJSON.categoryId;
    
    const exists = aiCategories.find(c => c.id === predictedId);
    if (exists) {
      console.log(`✅ AI Match: "${exists.name}" (ID: ${exists.id})`);
      return { id: exists.id, name: exists.name };
    }
    return null;

  } catch (e) {
    // Logika Penanganan Error (Rate Limit)
    if (e.message?.includes('429') || e.status === 429) {
      console.warn(`⚠️ AI Rate Limit (${MODEL_NAME}). Skip AI, pakai Default.`);
      return null; // Langsung return null agar transaksi tetap tersimpan (Fallback)
    }
    
    // Coba Fallback ke Model 2.0 jika 1.5 gagal/not found
    if (e.message?.includes('404') || e.status === 404) {
       console.warn(`⚠️ Model ${MODEL_NAME} not found, mencoba gemini-2.0-flash-exp...`);
       try {
         // ... (Kode retry ke model lain bisa disini, tapi demi kecepatan kita skip dulu)
       } catch (err2) {}
    }

    console.error(`❌ AI Error: ${e.message}`);
    return null;
  }
}

// --- WEBHOOK HANDLER ---
app.post('/webhook', async (c) => {
  try {
    const payload = await c.req.json();
    if (payload.event !== 'message' || payload.payload.fromMe) return c.text('OK');

    const message = payload.payload.body || '';
    const sender = payload.payload.from;
    const chatId = payload.payload.chatId || payload.payload.from;

    console.log(`\n--- 📩 Pesan Baru dari ${sender} ---`);
    
    const userId = await getUserIdByPhone(sender);
    if (!userId) {
        console.log('User tidak terdaftar');
        return c.text('User not found');
    }

    await startTyping(chatId);

    const cleanMsg = message.trim();

    if (cleanMsg === '1') {
      await stopTyping(chatId);
      await sendWhatsapp(chatId, MSG_HELP);
      return c.text('OK');
    } else if (['2', '3', '4', '5'].includes(cleanMsg)) {
      await stopTyping(chatId);
      await sendWhatsapp(chatId, '🚧 Fitur ini sedang dalam pengembangan (Coming Soon)!');
      return c.text('OK');
    }

    const lines = message.split('\n');
    const transactionsToInsert = [];
    const regex = /^(.*?)[\s]+(\d+(?:[.,]\d+)*(?:k|rb|jt|juta)?)$/i;
    const wibTimestamp = getWIBDate();

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine) continue;

      let type = 'expense';
      let content = cleanLine;

      if (cleanLine.toLowerCase().startsWith('duwitku ')) {
        type = 'income';
        content = cleanLine.substring(8).trim(); 
      }

      const match = content.match(regex);
      if (match) {
        const description = match[1].trim();
        const amount = parseAmount(match[2]);

        if (amount > 0) {
          let finalCategoryId = type === 'income' ? CATEGORY_ID_INCOME : CATEGORY_ID_EXPENSE;
          let categoryName = 'Duwitku Bot';

          // Panggil AI
          const prediction = await predictCategory(userId, description, amount, type);
          
          if (prediction) {
            finalCategoryId = prediction.id;
            categoryName = prediction.name;
          }

          transactionsToInsert.push({
            user_id: userId,
            category_id: finalCategoryId,
            amount: amount,
            type: type,
            description: description,
            transaction_date: wibTimestamp,
            source_type: 'chat_prompt',
            _debug_category_name: categoryName
          });
        }
      }
    }

    if (transactionsToInsert.length > 0) {
      const cleanData = transactionsToInsert.map(({ _debug_category_name, ...keep }) => keep);
      
      const { error } = await supabase.from('transactions').insert(cleanData);
      await stopTyping(chatId);

      if (error) {
        console.error('❌ GAGAL INSERT DB:', error);
        await sendWhatsapp(chatId, `⚠️ Gagal menyimpan: ${error.message}`);
      } else {
        let reply = `✅ *Tersimpan (${transactionsToInsert.length})*\n`;
        transactionsToInsert.forEach(t => {
          const icon = t.type === 'income' ? '📈' : '📉';
          reply += `${icon} *${t.description}*: ${formatRupiah(t.amount)} _(${t._debug_category_name})_\n`;
        });
        await sendWhatsapp(chatId, reply);
      }
    } else {
      await stopTyping(chatId);
      await sendWhatsapp(chatId, MSG_MAIN_MENU);
    }

    return c.text('OK');

  } catch (e) {
    console.error('💥 CRITICAL ERROR:', e);
    await stopTyping(c.req.payload?.chatId || '');
    return c.text('Error', 500);
  }
});

console.log(`🤖 Bot Duwitku AI (Stable 1.5) running on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
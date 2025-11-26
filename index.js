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

// Performance: Timeout untuk AI calls (prevent hanging)
const AI_TIMEOUT_MS = 10000; // 10 seconds

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
Ketik: [Nama] [Harga] [Wallet]
Contoh:
*Mie Ayam Bantul 15000 BCA*
*Kopi 12000 GoPay*

📈 *Untuk Catat Pemasukan (Income):*
Ketik: duwitku [Nama] [Jumlah] [Wallet]
Contoh:
*duwitku Gajian 5000000 Mandiri*

📋 *Catat Banyak Sekaligus:*
Gunakan Enter untuk pemisah baris:
Bakso 5000 Cash
Es teh 3000 GoPay

💡 *Tips:*
- Wallet optional, jika tidak diisi akan otomatis terdeteksi oleh AI`;

// --- HELPER: UTILS ---
function getTransactionDate() {
  // Konsisten dengan Flutter: DateTime.now().toUtc().toIso8601String()
  // Tidak perlu manual adjustment WIB, langsung gunakan UTC
  return new Date().toISOString();
}

// Timeout wrapper untuk AI calls
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('AI Timeout')), timeoutMs)
    )
  ]);
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

async function getDefaultWalletId(userId) {
  try {
    // Cari wallet default user (cash biasanya)
    const { data: wallets } = await supabase
      .from('wallets')
      .select('id, name, type')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);

    if (wallets && wallets.length > 0) {
      console.log(`💳 Default Wallet: ${wallets[0].name} (${wallets[0].type})`);
      return wallets[0].id;
    }

    // Jika tidak ada wallet, create default cash wallet
    console.log('⚠️ No wallet found, creating default cash wallet...');
    const { data: newWallet, error } = await supabase
      .from('wallets')
      .insert({
        user_id: userId,
        name: 'Cash',
        type: 'cash',
        balance: 0,
        currency: 'IDR'
      })
      .select()
      .single();

    if (error || !newWallet) {
      console.error('❌ Failed to create default wallet:', error);
      return null;
    }

    console.log(`✅ Created default wallet: ${newWallet.name}`);
    return newWallet.id;
  } catch (e) {
    console.error('❌ getDefaultWalletId Error:', e.message);
    return null;
  }
}

async function getUserWallets(userId) {
  try {
    const { data: wallets } = await supabase
      .from('wallets')
      .select('id, name, type')
      .eq('user_id', userId);

    return wallets || [];
  } catch (e) {
    console.error('❌ getUserWallets Error:', e.message);
    return [];
  }
}

// --- SMART WALLET AI ---
async function predictWallet(description, amount, type, userWallets) {
  console.log(`💳 AI Predicting Wallet for: "${description}" (${type})...`);

  if (!userWallets || userWallets.length === 0) {
    console.log('⚠️ No wallets available for prediction');
    return null;
  }

  const walletListString = userWallets
    .map(w => `${w.id}:${w.name} (${w.type})`)
    .join(', ');

  const prompt = `
    You are a payment method detection engine.
    Input: "${description}" (Amount: ${amount}, Type: ${type}).
    Available Wallets (ID:Name (Type)): ${walletListString}.
    Task: Infer which wallet/payment method was likely used for this transaction based on:
    - Keywords in description (e.g., "Mandiri", "GoPay", "Cash", "Debit", "Credit")
    - Transaction context (online shopping might use e-wallet or credit card)
    - Amount (small amounts often cash, large amounts might be bank transfer)
    
    If uncertain, select the most generic wallet (usually "Cash" or the first available).
    Return ONLY JSON: {"walletId": "<wallet_id as string>"}
  `;

  try {
    const result = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { walletId: { type: 'STRING' } },
            required: ['walletId']
          }
        }
      }),
      AI_TIMEOUT_MS
    );

    const resultJSON = JSON.parse(result.text);
    const predictedId = resultJSON.walletId;
    
    const exists = userWallets.find(w => w.id === predictedId);
    if (exists) {
      console.log(`✅ AI Wallet Match: "${exists.name}" (${exists.type})`);
      return { id: exists.id, name: exists.name, type: exists.type };
    }
    
    console.log('⚠️ AI predicted invalid wallet, will use default');
    return null;

  } catch (e) {
    if (e.message?.includes('429') || e.status === 429) {
      console.warn('⚠️ AI Rate Limit (Wallet). Using default.');
      return null;
    }
    if (e.message === 'AI Timeout') {
      console.warn('⏱️ AI Wallet Timeout. Using default.');
      return null;
    }
    
    console.error(`❌ AI Wallet Error: ${e.message}`);
    return null;
  }
}

// --- SMART CATEGORY AI (STABLE) ---
async function predictCategory(description, amount, type, aiCategories) {
  console.log(`🤖 AI Predicting: "${description}" (${type})...`);

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
    const result = await withTimeout(
      ai.models.generateContent({
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
      }),
      AI_TIMEOUT_MS
    );

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
      console.warn('⚠️ AI Rate Limit (Category). Skip AI, pakai Default.');
      return null; // Langsung return null agar transaksi tetap tersimpan (Fallback)
    }
    
    if (e.message === 'AI Timeout') {
      console.warn('⏱️ AI Category Timeout. Using default.');
      return null;
    }
    
    // Coba Fallback ke Model 2.0 jika 2.5 gagal/not found
    if (e.message?.includes('404') || e.status === 404) {
       console.warn('⚠️ Model gemini-2.5-flash not found, using fallback...');
       try {
         // ... (Kode retry ke model lain bisa disini, tapi demi kecepatan kita skip dulu)
       } catch (err2) {}
    }

    console.error(`❌ AI Category Error: ${e.message}`);
    return null;
  }
}

// --- WEBHOOK HANDLER ---
app.post('/webhook', async (c) => {
  const startTime = Date.now();
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
    // Updated regex to capture optional wallet at the end: [Description] [Amount] [Wallet?]
    const regex = /^(.*?)[\s]+(\d+(?:[.,]\d+)*(?:k|rb|jt|juta)?)(?:[\s]+([a-zA-Z0-9\s]+))?$/i;
    const transactionTimestamp = getTransactionDate();

    // 🚀 PERFORMANCE: Fetch ALL data ONCE untuk semua transaksi (parallel)
    const [userWallets, defaultWalletId, categoriesIncome, categoriesExpense] = await Promise.all([
      getUserWallets(userId),
      getDefaultWalletId(userId),
      supabase.from('categories').select('id, name').eq('type', 'income').or(`is_default.eq.true,user_id.eq.${userId}`).then(res => res.data?.filter(c => c.name !== 'Duwitku Bot') || []),
      supabase.from('categories').select('id, name').eq('type', 'expense').or(`is_default.eq.true,user_id.eq.${userId}`).then(res => res.data?.filter(c => c.name !== 'Duwitku Bot') || [])
    ]);
    
    if (!defaultWalletId) {
      await stopTyping(chatId);
      await sendWhatsapp(chatId, '⚠️ Tidak dapat menemukan wallet. Silakan buat wallet terlebih dahulu di aplikasi Duwitku.');
      return c.text('No wallet found');
    }

    // Cache default wallet name untuk performa
    const defaultWallet = userWallets.find(w => w.id === defaultWalletId);
    const defaultWalletName = defaultWallet?.name || 'Default';

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
        const walletInput = match[3]?.trim(); // Wallet dari user input (optional)

        if (amount > 0) {
          let finalCategoryId = type === 'income' ? CATEGORY_ID_INCOME : CATEGORY_ID_EXPENSE;
          let categoryName = 'Duwitku Bot';
          let finalWalletId = defaultWalletId;
          let walletName = defaultWalletName;
          let walletSource = 'default';

          // Select appropriate categories based on transaction type
          const relevantCategories = type === 'income' ? categoriesIncome : categoriesExpense;

          // 🚀 PERFORMANCE: Parallel AI calls (Category + Wallet)
          const aiPredictions = await Promise.allSettled([
            relevantCategories.length > 0 ? predictCategory(description, amount, type, relevantCategories) : Promise.resolve(null),
            walletInput ? Promise.resolve(null) : predictWallet(description, amount, type, userWallets)
          ]);

          // Process Category AI result
          const categoryPrediction = aiPredictions[0].status === 'fulfilled' ? aiPredictions[0].value : null;
          if (categoryPrediction) {
            finalCategoryId = categoryPrediction.id;
            categoryName = categoryPrediction.name;
          }

          // Process Wallet selection
          if (walletInput) {
            // Priority 1: Manual wallet input
            const manualWallet = userWallets.find(w => 
              w.name.toLowerCase() === walletInput.toLowerCase() ||
              w.name.toLowerCase().includes(walletInput.toLowerCase())
            );
            
            if (manualWallet) {
              finalWalletId = manualWallet.id;
              walletName = manualWallet.name;
              walletSource = 'manual';
              console.log(`💳 Manual Wallet: "${walletName}" selected by user`);
            } else {
              console.log(`⚠️ Wallet "${walletInput}" not found, using default`);
            }
          } else {
            // Priority 2: AI Prediction
            const walletPrediction = aiPredictions[1].status === 'fulfilled' ? aiPredictions[1].value : null;
            if (walletPrediction) {
              finalWalletId = walletPrediction.id;
              walletName = walletPrediction.name;
              walletSource = 'ai';
            }
          }

          transactionsToInsert.push({
            user_id: userId,
            category_id: finalCategoryId,
            wallet_id: finalWalletId,
            amount: amount,
            type: type,
            description: description,
            transaction_date: transactionTimestamp,
            source_type: 'chat_prompt',
            _debug_category_name: categoryName,
            _debug_wallet_name: walletName,
            _debug_wallet_source: walletSource
          });
        }
      }
    }

    if (transactionsToInsert.length > 0) {
      const cleanData = transactionsToInsert.map(({ _debug_category_name, _debug_wallet_name, _debug_wallet_source, ...keep }) => keep);
      
      // STEP 1: Calculate wallet balance changes (group by wallet_id)
      const walletChanges = {};
      transactionsToInsert.forEach(t => {
        const change = t.type === 'income' ? t.amount : -t.amount;
        walletChanges[t.wallet_id] = (walletChanges[t.wallet_id] || 0) + change;
      });

      // STEP 2: Update all affected wallet balances
      const walletUpdatePromises = Object.entries(walletChanges).map(async ([walletId, change]) => {
        try {
          // Fetch current balance
          const { data: wallet, error: fetchError } = await supabase
            .from('wallets')
            .select('initial_balance')
            .eq('id', walletId)
            .single();

          if (fetchError || !wallet) {
            console.error(`❌ Failed to fetch wallet ${walletId}:`, fetchError);
            return false;
          }

          const currentBalance = parseFloat(wallet.initial_balance) || 0;
          const newBalance = currentBalance + change;

          // Update balance
          const { error: updateError } = await supabase
            .from('wallets')
            .update({ initial_balance: newBalance })
            .eq('id', walletId);

          if (updateError) {
            console.error(`❌ Failed to update wallet ${walletId}:`, updateError);
            return false;
          }

          console.log(`Wallet ${walletId}: ${currentBalance} → ${newBalance} (${change >= 0 ? '+' : ''}${change})`);
          return true;
        } catch (e) {
          console.error(`❌ Error updating wallet ${walletId}:`, e.message);
          return false;
        }
      });

      // PERFORMANCE: Parallel wallet updates + transaction insert + stop typing
      const [walletResults, dbResult] = await Promise.allSettled([
        Promise.all(walletUpdatePromises),
        supabase.from('transactions').insert(cleanData).then(res => {
          stopTyping(chatId);
          return res;
        })
      ]);

      // Check wallet update results
      const walletUpdateSuccess = walletResults.status === 'fulfilled' && walletResults.value.every(r => r === true);
      
      if (!walletUpdateSuccess) {
        console.warn('⚠️ Some wallet updates failed, but transactions were still inserted');
      }

      const error = dbResult.status === 'fulfilled' ? dbResult.value.error : dbResult.reason;

      if (error) {
        console.error('❌ GAGAL INSERT DB:', error);
        await sendWhatsapp(chatId, `⚠️ Gagal menyimpan: ${error.message || error}`);
      } else {
        let reply = `✅ *Transaksi tersimpan (${transactionsToInsert.length})*\n`;
        transactionsToInsert.forEach(t => {
          const icon = t.type === 'income' ? '📈' : '📉';
          const walletIcon = t._debug_wallet_source === 'manual' ? '✏️' : '🤖';
          reply += `${icon} *${t.description}*: Rp ${formatRupiah(t.amount)}\n`;
          reply += `${t._debug_category_name} • ${t._debug_wallet_name}\n ${walletIcon}`;
        });
        await sendWhatsapp(chatId, reply);
      }
    } else {
      await stopTyping(chatId);
      await sendWhatsapp(chatId, MSG_MAIN_MENU);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`⏱️ Execution time: ${duration} ms`);

    return c.text('OK');

  } catch (e) {
    console.error('💥 CRITICAL ERROR:', e);
    await stopTyping(c.req.payload?.chatId || '');
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`⏱️ Execution time (error): ${duration} ms`);
    return c.text('Error', 500);
  }
});

console.log(`🤖 Bot Duwitku AI (Optimized v2.0) running on port ${PORT}`);
console.log(`⚡ Performance: Parallel AI calls, Smart caching, ${AI_TIMEOUT_MS}ms timeout`);
serve({ fetch: app.fetch, port: PORT });
require('dotenv').config();
const { serve } = require('@hono/node-server');
const { Hono } = require('hono');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  port: parseInt(process.env.PORT) || 5000,
  wahaUrl: process.env.WAHA_API_URL || 'http://waha:3000',
  wahaApiKey: process.env.WHATSAPP_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  
  // Default category IDs (fallback when AI fails)
  defaultCategoryIncome: 28,
  defaultCategoryExpense: 29,
  
  // Performance settings
  aiTimeoutMs: 10000,
  webhookRetryAttempts: 5,
  webhookRetryDelayMs: 3000,
};

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'WHATSAPP_API_KEY', 'GEMINI_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// =============================================================================
// INITIALIZE SERVICES
// =============================================================================

const app = new Hono();
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const ai = new GoogleGenAI({ apiKey: CONFIG.geminiApiKey });

// Reusable headers for WAHA API calls
const WAHA_HEADERS = {
  'Content-Type': 'application/json',
  'X-Api-Key': CONFIG.wahaApiKey,
};

// =============================================================================
// STATIC MESSAGES
// =============================================================================

const MESSAGES = {
  mainMenu: `Halo Mas/Mbak! 👋
Saya *Duwitku BOT*🤖, asisten keuangan pribadi kamu 😊

Pilih opsi yang kamu butuhkan dengan mengetik angka:

1️⃣ Cara Mencatat di Duwitku
2️⃣ Laporan Keuangan Hari Ini
3️⃣ Laporan Keuangan Bulan Ini
4️⃣ Download Aplikasi Duwitku
5️⃣ Lapor Kendala

✨ *Tips:*
- Ketik angkanya saja. Contoh: *1* untuk "Cara Mencatat".`,

  help: `1️⃣ *Cara Mencatat di Duwitku*

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
- Wallet optional, jika tidak diisi akan otomatis terdeteksi oleh AI`,

  download: `📱 *Download Aplikasi Duwitku*

Duwitku adalah aplikasi pencatatan keuangan pribadi yang simpel dan cerdas dengan fitur AI categorization.

📥 *Download Android APK (v2.0.0):*
https://github.com/FadhilAlif/duwitku/releases/download/v2.0.0/Duwitku-v2.apk

📂 *Repository GitHub:*
https://github.com/FadhilAlif/duwitku

💡 *Tips:* Pastikan izinkan instalasi dari sumber tidak dikenal di pengaturan HP kamu.`,

  reportIssue: `🛠️ *Lapor Kendala*

Mengalami masalah atau punya saran untuk Duwitku? Hubungi developer kami:

📧 *Email:*
fadhil.alifp@gmail.com

📱 *WhatsApp:*
+6285727304551

💡 *Tips saat melapor:*
• Jelaskan masalah dengan detail
• Sertakan screenshot jika memungkinkan
• Sebutkan versi aplikasi yang digunakan

Kami akan merespons secepat mungkin! 🙏`,
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format number to Indonesian Rupiah format
 */
const formatRupiah = (num) => num.toLocaleString('id-ID');

/**
 * Parse amount string to number (supports k, rb, jt, juta)
 */
const parseAmount = (str) => {
  if (!str) return 0;
  const val = str.toLowerCase().replace(/rp|\.|,/g, '');
  if (val.includes('k') || val.includes('rb')) return parseFloat(val) * 1000;
  if (val.includes('jt') || val.includes('juta')) return parseFloat(val) * 1000000;
  return parseFloat(val) || 0;
};

/**
 * Get current timestamp in ISO format
 */
const getTransactionDate = () => new Date().toISOString();

/**
 * Wrap promise with timeout
 */
const withTimeout = (promise, timeoutMs, errorMessage = 'Operation timed out') => {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
};

/**
 * Sleep utility for retry logic
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check if sender is a valid personal chat
 */
const isPersonalChat = (sender) => {
  return sender.endsWith('@c.us') || sender.endsWith('@s.whatsapp.net');
};

/**
 * Extract phone number from WhatsApp ID
 */
const extractPhoneNumber = (sender) => sender.split('@')[0];

// =============================================================================
// WAHA API FUNCTIONS
// =============================================================================

/**
 * Register webhook with WAHA (with retry logic)
 */
async function registerWebhook() {
  const webhookUrl = `http://bot:${CONFIG.port}/webhook`;
  
  for (let attempt = 1; attempt <= CONFIG.webhookRetryAttempts; attempt++) {
    try {
      console.log(`🔄 Registering webhook (attempt ${attempt}/${CONFIG.webhookRetryAttempts})...`);
      
      // Check if WAHA is ready
      const healthCheck = await fetch(`${CONFIG.wahaUrl}/api/sessions/default`, {
        headers: WAHA_HEADERS,
      });
      
      if (!healthCheck.ok) {
        throw new Error(`WAHA not ready: ${healthCheck.status}`);
      }

      // Update session webhook configuration
      const response = await fetch(`${CONFIG.wahaUrl}/api/sessions/default`, {
        method: 'PUT',
        headers: WAHA_HEADERS,
        body: JSON.stringify({
          config: {
            webhooks: [{
              url: webhookUrl,
              events: ['message'],
            }],
          },
        }),
      });

      if (response.ok) {
        console.log(`✅ Webhook registered: ${webhookUrl}`);
        return true;
      }
      
      throw new Error(`Failed to register webhook: ${response.status}`);
    } catch (error) {
      console.warn(`⚠️ Webhook registration attempt ${attempt} failed:`, error.message);
      
      if (attempt < CONFIG.webhookRetryAttempts) {
        console.log(`⏳ Retrying in ${CONFIG.webhookRetryDelayMs / 1000}s...`);
        await sleep(CONFIG.webhookRetryDelayMs);
      }
    }
  }
  
  console.error('❌ Failed to register webhook after all attempts');
  console.log('💡 Please configure webhook manually in WAHA dashboard');
  return false;
}

/**
 * Send typing indicator
 */
const startTyping = async (chatId) => {
  try {
    await fetch(`${CONFIG.wahaUrl}/api/startTyping`, {
      method: 'POST',
      headers: WAHA_HEADERS,
      body: JSON.stringify({ session: 'default', chatId }),
    });
  } catch { /* Silent fail */ }
};

/**
 * Stop typing indicator
 */
const stopTyping = async (chatId) => {
  try {
    await fetch(`${CONFIG.wahaUrl}/api/stopTyping`, {
      method: 'POST',
      headers: WAHA_HEADERS,
      body: JSON.stringify({ session: 'default', chatId }),
    });
  } catch { /* Silent fail */ }
};

/**
 * Download media from URL and return as buffer
 */
const downloadMedia = async (url) => {
  try {
    const response = await fetch(url, { headers: WAHA_HEADERS });
    if (!response.ok) throw new Error(`Failed to download media: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('❌ Download media error:', error.message);
    throw error;
  }
};

/**
 * Send WhatsApp message
 */
const sendMessage = async (chatId, text) => {
  try {
    await fetch(`${CONFIG.wahaUrl}/api/sendText`, {
      method: 'POST',
      headers: WAHA_HEADERS,
      body: JSON.stringify({ session: 'default', chatId, text }),
    });
    console.log(`📤 Message sent to ${chatId}`);
  } catch (error) {
    console.error('❌ Send message error:', error.message);
  }
};

// =============================================================================
// DATABASE FUNCTIONS
// =============================================================================

/**
 * Get user ID by phone number
 */
const getUserByPhone = async (phoneNumber) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, phone_number')
    .eq('phone_number', phoneNumber)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') { // Not "no rows returned"
      console.warn(`⚠️ Database error: ${error.message}`);
    }
    return null;
  }
  
  return data;
};

/**
 * Get user's wallets
 */
const getUserWallets = async (userId) => {
  const { data } = await supabase
    .from('wallets')
    .select('id, name, type')
    .eq('user_id', userId);
  
  return data || [];
};

/**
 * Get default wallet ID for user
 */
const getDefaultWalletId = async (userId) => {
  const { data: wallets } = await supabase
    .from('wallets')
    .select('id, name, type')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (wallets?.length > 0) {
    console.log(`💳 Default Wallet: ${wallets[0].name} (${wallets[0].type})`);
    return wallets[0];
  }

  // Create default cash wallet if none exists
  console.log('⚠️ No wallet found, creating default...');
  const { data: newWallet, error } = await supabase
    .from('wallets')
    .insert({
      user_id: userId,
      name: 'Cash',
      type: 'cash',
      balance: 0,
      currency: 'IDR',
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Failed to create wallet:', error);
    return null;
  }

  console.log(`✅ Created default wallet: ${newWallet.name}`);
  return newWallet;
};

/**
 * Get user's categories
 */
const getUserCategories = async (userId, type) => {
  const { data } = await supabase
    .from('categories')
    .select('id, name')
    .eq('type', type)
    .or(`is_default.eq.true,user_id.eq.${userId}`);

  return data?.filter(c => c.name !== 'Duwitku Bot') || [];
};

/**
 * Get transactions for report
 */
const getTransactions = async (userId, startDate, endDate) => {
  const { data, error } = await supabase
    .from('transactions')
    .select(`
      id, amount, type, description, transaction_date,
      categories:category_id (name),
      wallets:wallet_id (name)
    `)
    .eq('user_id', userId)
    .gte('transaction_date', startDate)
    .lte('transaction_date', endDate)
    .order('transaction_date', { ascending: false });

  if (error) {
    console.error('❌ Get transactions error:', error);
    return [];
  }

  return data || [];
};

/**
 * Insert transactions and update wallet balances
 */
const saveTransactions = async (transactions) => {
  // Calculate wallet balance changes
  const walletChanges = {};
  transactions.forEach(t => {
    const change = t.type === 'income' ? t.amount : -t.amount;
    walletChanges[t.wallet_id] = (walletChanges[t.wallet_id] || 0) + change;
  });

  // Update wallet balances
  const updatePromises = Object.entries(walletChanges).map(async ([walletId, change]) => {
    const { data: wallet } = await supabase
      .from('wallets')
      .select('initial_balance')
      .eq('id', walletId)
      .single();

    if (!wallet) return false;

    const newBalance = (parseFloat(wallet.initial_balance) || 0) + change;
    const { error } = await supabase
      .from('wallets')
      .update({ initial_balance: newBalance })
      .eq('id', walletId);

    if (!error) {
      console.log(`Wallet ${walletId}: ${wallet.initial_balance} → ${newBalance}`);
    }
    return !error;
  });

  // Clean debug fields before insert
  const cleanData = transactions.map(({ _categoryName, _walletName, ...keep }) => keep);

  // Execute in parallel
  const [walletResults, { error: insertError }] = await Promise.all([
    Promise.all(updatePromises),
    supabase.from('transactions').insert(cleanData),
  ]);

  return {
    success: !insertError,
    walletUpdates: walletResults.filter(Boolean).length,
    error: insertError,
  };
};

// =============================================================================
// AI FUNCTIONS
// =============================================================================

/**
 * Predict category using AI
 */
const predictCategory = async (description, amount, type, categories) => {
  if (!categories.length) return null;

  const categoryList = categories.map(c => `${c.id}:${c.name}`).join(', ');
  const prompt = `You are a financial categorization engine.
Input: "${description}" (Amount: ${amount}, Type: ${type}).
Available Categories (ID:Name): ${categoryList}.
Task: Select the most appropriate Category ID.
Return ONLY JSON: {"categoryId": <number>}`;

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
            required: ['categoryId'],
          },
        },
      }),
      CONFIG.aiTimeoutMs,
      'AI Timeout'
    );

    const { categoryId } = JSON.parse(result.text);
    const match = categories.find(c => c.id === categoryId);
    
    if (match) {
      console.log(`✅ AI Category: "${match.name}" (ID: ${match.id})`);
      return match;
    }
    return null;
  } catch (error) {
    if (error.message?.includes('429')) {
      console.warn('⚠️ AI Rate Limit (Category)');
    } else if (error.message !== 'AI Timeout') {
      console.error(`❌ AI Category Error: ${error.message}`);
    }
    return null;
  }
};

/**
 * Predict wallet using AI
 */
const predictWallet = async (description, amount, type, wallets) => {
  if (!wallets?.length) return null;

  const walletList = wallets.map(w => `${w.id}:${w.name} (${w.type})`).join(', ');
  const prompt = `You are a payment method detection engine.
Input: "${description}" (Amount: ${amount}, Type: ${type}).
Available Wallets (ID:Name (Type)): ${walletList}.
Task: Infer which wallet was likely used based on keywords and context.
If uncertain, select "Cash" or the first available.
Return ONLY JSON: {"walletId": "<wallet_id>"}`;

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
            required: ['walletId'],
          },
        },
      }),
      CONFIG.aiTimeoutMs,
      'AI Timeout'
    );

    const { walletId } = JSON.parse(result.text);
    const match = wallets.find(w => w.id === walletId);
    
    if (match) {
      console.log(`✅ AI Wallet: "${match.name}" (${match.type})`);
      return match;
    }
    return null;
  } catch (error) {
    if (error.message?.includes('429')) {
      console.warn('⚠️ AI Rate Limit (Wallet)');
    } else if (error.message !== 'AI Timeout') {
      console.error(`❌ AI Wallet Error: ${error.message}`);
    }
    return null;
  }
};

/**
 * Process Image Transaction (Scan Receipt)
 */
const processImageTransaction = async (imageBuffer, caption, type = 'application/jpeg') => {
  const prompt = `Analyze this image. It is a financial receipt or transaction proof.
Extract the transaction details as a LIST of items.
For each item found:
- description: item name
- amount: price (number only)
- type: "expense" (default) or "income" (if it's a transfer proof/income)

Return ONLY a JSON array: [{ "description": "...", "amount": 10000, "type": "expense" }]`;

  try {
    const result = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: type, data: imageBuffer.toString('base64') } }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        },
      }),
      CONFIG.aiTimeoutMs,
      'AI Image Analysis Timeout'
    );

    const transactions = JSON.parse(result.text);
    return Array.isArray(transactions) ? transactions : [];
  } catch (error) {
    console.error(`❌ AI Image Error: ${error.message}`);
    return [];
  }
};

/**
 * Process Audio Transaction (Voice Input)
 */
const processAudioTransaction = async (audioBuffer, type = 'audio/ogg') => {
  const prompt = `Listen to this audio. The user is dictating financial transactions in Indonesian.
Extract the transactions mentioned.

IMPORTANT - Number Handling:
- Convert "k" or "rb" to thousands (e.g., "15k" -> 15000).
- Convert "ribu" to 000 (e.g., "50 ribu" -> 50000).
- Convert "juta" or "jt" to 000000 (e.g., "2 juta" -> 2000000).
- Handle spoken numbers (e.g., "dua puluh lima ribu" -> 25000).

Return ONLY a JSON array: [{ "description": "...", "amount": 10000, "type": "expense"/"income" }]`;

  try {
    const result = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: type, data: audioBuffer.toString('base64') } }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        },
      }),
      CONFIG.aiTimeoutMs,
      'AI Audio Analysis Timeout'
    );

    const transactions = JSON.parse(result.text);
    return Array.isArray(transactions) ? transactions : [];
  } catch (error) {
    console.error(`❌ AI Audio Error: ${error.message}`);
    return [];
  }
};

// =============================================================================
// REPORT FUNCTIONS
// =============================================================================

/**
 * Get daily report data
 */
const getDailyReport = async (userId) => {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();
  return getTransactions(userId, startOfDay, endOfDay);
};

/**
 * Get monthly report data
 */
const getMonthlyReport = async (userId) => {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
  return getTransactions(userId, startOfMonth, endOfMonth);
};

/**
 * Format report message
 */
const formatReport = (transactions, period) => {
  if (!transactions?.length) {
    return `📊 *Laporan Keuangan ${period}*\n\n` +
           `Belum ada transaksi.\n\n` +
           `💡 Mulai catat dengan: *Makan siang 25000*`;
  }

  let totalIncome = 0;
  let totalExpense = 0;
  const expenseByCategory = {};
  const incomeByCategory = {};

  transactions.forEach(t => {
    const amount = parseFloat(t.amount) || 0;
    const category = t.categories?.name || 'Lainnya';

    if (t.type === 'income') {
      totalIncome += amount;
      incomeByCategory[category] = (incomeByCategory[category] || 0) + amount;
    } else {
      totalExpense += amount;
      expenseByCategory[category] = (expenseByCategory[category] || 0) + amount;
    }
  });

  const balance = totalIncome - totalExpense;
  let msg = `📊 *Laporan Keuangan ${period}*\n\n`;
  msg += `📈 *Pemasukan:* Rp ${formatRupiah(totalIncome)}\n`;
  msg += `📉 *Pengeluaran:* Rp ${formatRupiah(totalExpense)}\n`;
  msg += `${balance >= 0 ? '💰' : '⚠️'} *Saldo:* Rp ${formatRupiah(balance)}\n`;
  msg += `📝 *Total Transaksi:* ${transactions.length}\n\n`;

  // Expense breakdown
  if (Object.keys(expenseByCategory).length) {
    msg += `💸 *Pengeluaran per Kategori:*\n`;
    Object.entries(expenseByCategory)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, amt]) => {
        const pct = ((amt / totalExpense) * 100).toFixed(1);
        msg += `• ${cat}: Rp ${formatRupiah(amt)} (${pct}%)\n`;
      });
    msg += '\n';
  }

  // Income breakdown
  if (Object.keys(incomeByCategory).length) {
    msg += `💵 *Pemasukan per Kategori:*\n`;
    Object.entries(incomeByCategory)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, amt]) => {
        msg += `• ${cat}: Rp ${formatRupiah(amt)}\n`;
      });
    msg += '\n';
  }

  // Recent transactions
  const recentCount = Math.min(transactions.length, 10);
  msg += `📋 *${recentCount} Transaksi Terakhir:*\n`;
  transactions.slice(0, 10).forEach(t => {
    const icon = t.type === 'income' ? '📈' : '📉';
    const wallet = t.wallets?.name || 'Unknown';
    msg += `${icon} ${t.description}: Rp ${formatRupiah(parseFloat(t.amount))} (${wallet})\n`;
  });

  if (transactions.length > 10) {
    msg += `\n_...dan ${transactions.length - 10} transaksi lainnya_`;
  }

  return msg;
};

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

const TRANSACTION_REGEX = /^(.*?)[\s]+(\d+(?:[.,]\d+)*(?:k|rb|jt|juta)?)(?:[\s]+([a-zA-Z0-9\s]+))?$/i;

/**
 * Handle menu commands
 */
const handleMenuCommand = async (command, userId, chatId) => {
  switch (command) {
    case '1':
      await sendMessage(chatId, MESSAGES.help);
      return true;

    case '2': {
      console.log('📊 Generating daily report...');
      const transactions = await getDailyReport(userId);
      const dateStr = new Date().toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
      await sendMessage(chatId, formatReport(transactions, `Hari Ini (${dateStr})`));
      console.log(`✅ Daily report sent (${transactions.length} transactions)`);
      return true;
    }

    case '3': {
      console.log('📊 Generating monthly report...');
      const transactions = await getMonthlyReport(userId);
      const monthStr = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
      await sendMessage(chatId, formatReport(transactions, `Bulan ${monthStr}`));
      console.log(`✅ Monthly report sent (${transactions.length} transactions)`);
      return true;
    }

    case '4':
      await sendMessage(chatId, MESSAGES.download);
      return true;

    case '5':
      await sendMessage(chatId, MESSAGES.reportIssue);
      return true;

    default:
      return false;
  }
};

/**
 * Parse and process transactions from message
 */
const processTransactions = async (message, userId, userWallets, defaultWallet, categories) => {
  const lines = message.split('\n');
  const transactions = [];
  const timestamp = getTransactionDate();

  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    // Determine transaction type
    const isIncome = cleanLine.toLowerCase().startsWith('duwitku ');
    const content = isIncome ? cleanLine.substring(8).trim() : cleanLine;
    const type = isIncome ? 'income' : 'expense';

    const match = content.match(TRANSACTION_REGEX);
    if (!match) continue;

    const description = match[1].trim();
    const amount = parseAmount(match[2]);
    const walletInput = match[3]?.trim();

    if (amount <= 0) continue;

    // Get relevant categories
    const relevantCategories = categories[type] || [];

    // Parallel AI predictions
    const [categoryResult, walletResult] = await Promise.allSettled([
      predictCategory(description, amount, type, relevantCategories),
      walletInput ? null : predictWallet(description, amount, type, userWallets),
    ]);

    // Determine category
    const category = categoryResult.status === 'fulfilled' && categoryResult.value
      ? categoryResult.value
      : { id: type === 'income' ? CONFIG.defaultCategoryIncome : CONFIG.defaultCategoryExpense, name: 'Duwitku Bot' };

    // Determine wallet
    let wallet = defaultWallet;
    let walletName = defaultWallet.name;

    if (walletInput) {
      const manualWallet = userWallets.find(w =>
        w.name.toLowerCase() === walletInput.toLowerCase() ||
        w.name.toLowerCase().includes(walletInput.toLowerCase())
      );
      if (manualWallet) {
        wallet = manualWallet;
        walletName = manualWallet.name;
        console.log(`💳 Manual Wallet: "${walletName}"`);
      }
    } else if (walletResult.status === 'fulfilled' && walletResult.value) {
      wallet = walletResult.value;
      walletName = wallet.name;
    }

    transactions.push({
      user_id: userId,
      category_id: category.id,
      wallet_id: wallet.id,
      amount,
      type,
      description,
      transaction_date: timestamp,
      source_type: 'chat_prompt',
      _categoryName: category.name,
      _walletName: walletName,
    });
  }

  return transactions;
};

/**
 * Normalize and enrich transactions with categories and wallets
 */
const enrichTransactions = async (rawTransactions, userId, userWallets, defaultWallet, categories) => {
  const transactions = [];
  const timestamp = getTransactionDate();

  for (const raw of rawTransactions) {
    const amount = parseFloat(raw.amount);
    if (!amount || amount <= 0) continue;

    const description = raw.description || 'Unknown';
    const type = raw.type === 'income' ? 'income' : 'expense';
    
    // Get relevant categories
    const relevantCategories = categories[type] || [];

    // Parallel AI predictions for Category and Wallet (if not specified in raw, usually not)
    // Note: raw transactions from Image/Audio usually don't have wallet info unless explicitly stated but Gemini might miss it.
    // For now we re-run prediction or just use default. Let's re-run predictions for accuracy.
    
    const [categoryResult, walletResult] = await Promise.allSettled([
      predictCategory(description, amount, type, relevantCategories),
      predictWallet(description, amount, type, userWallets),
    ]);

    // Determine category
    const category = categoryResult.status === 'fulfilled' && categoryResult.value
      ? categoryResult.value
      : { id: type === 'income' ? CONFIG.defaultCategoryIncome : CONFIG.defaultCategoryExpense, name: 'Duwitku Bot' };

    // Determine wallet
    let wallet = defaultWallet;
    let walletName = defaultWallet.name;

    if (walletResult.status === 'fulfilled' && walletResult.value) {
      wallet = walletResult.value;
      walletName = wallet.name;
    }

    transactions.push({
      user_id: userId,
      category_id: category.id,
      wallet_id: wallet.id,
      amount,
      type,
      description,
      transaction_date: timestamp,
      source_type: 'chat_prompt',
      _categoryName: category.name,
      _walletName: walletName,
    });
  }
  return transactions;
};

// =============================================================================
// WEBHOOK HANDLER
// =============================================================================

app.post('/webhook', async (c) => {
  const startTime = Date.now();
  let chatId = '';

  try {
    const payload = await c.req.json();
    
    // Validate webhook event
    if (payload.event !== 'message' || payload.payload?.fromMe) {
      return c.text('OK');
    }

    const message = payload.payload.body || '';
    const hasMedia = payload.payload.hasMedia; // Valid property in WAHA
    const media = payload.payload.media;
    let sender = payload.payload.from;
    chatId = payload.payload.chatId || sender;

    console.log(`\n--- 📩 New message from ${sender} ---`);

    // WORKAROUND: WAHA NOWEB bug - extract real number from _data.key.remoteJidAlt
    if (sender.endsWith('@lid')) {
      const realNumber = payload.payload._data?.key?.remoteJidAlt;
      if (realNumber && !realNumber.endsWith('@lid')) {
        console.log(`⚠️ WAHA NOWEB Bug detected!`);
        console.log(`📝 Original sender (LID): ${sender}`);
        console.log(`📝 Real number found: ${realNumber}`);
        sender = realNumber;
        chatId = realNumber;
      } else {
        // Real WhatsApp Channel - skip it
        console.log('⚠️ Skipped: Real WhatsApp Channel (@lid)');
        return c.text('OK');
      }
    }

    // Filter group chats
    if (sender.endsWith('@g.us')) {
      console.log('⚠️ Skipped: Group chat (@g.us)');
      return c.text('OK');
    }

    if (!isPersonalChat(sender)) {
      console.log(`⚠️ Unknown format: ${sender}`);
      return c.text('OK');
    }

    // Lookup user
    const phoneNumber = extractPhoneNumber(sender);
    console.log(`🔍 Looking up user: ${phoneNumber}`);

    const user = await getUserByPhone(phoneNumber);
    if (!user) {
      console.log('❌ User not registered');
      return c.text('User not found');
    }

    console.log(`✅ User found: ${user.id}`);
    await startTyping(chatId);

    const cleanMsg = message.trim();

    // Handle menu commands
    if (await handleMenuCommand(cleanMsg, user.id, chatId)) {
      await stopTyping(chatId);
      console.log(`⏱️ Execution time: ${Date.now() - startTime}ms`);
      return c.text('OK');
    }

    // Fetch user data in parallel
    const [userWallets, defaultWallet, incomeCategories, expenseCategories] = await Promise.all([
      getUserWallets(user.id),
      getDefaultWalletId(user.id),
      getUserCategories(user.id, 'income'),
      getUserCategories(user.id, 'expense'),
    ]);

    if (!defaultWallet) {
      await stopTyping(chatId);
      await sendMessage(chatId, '⚠️ Tidak dapat menemukan wallet. Silakan buat wallet di aplikasi Duwitku.');
      return c.text('No wallet');
    }

    // Process transactions
    // Process transactions
    let transactions = [];

    if (hasMedia && media) {
        console.log(`📷 Media detected: ${media.mimetype}`);
        const buffer = await downloadMedia(media.url);
        
        let rawTransactions = [];
        if (media.mimetype.startsWith('image/')) {
            await sendMessage(chatId, '🔍 Menganalisa gambar struk...');
            rawTransactions = await processImageTransaction(buffer, message, media.mimetype);
        } else if (media.mimetype.startsWith('audio/') || media.mimetype.startsWith('video/ogg')) { // Voice notes often video/ogg in WA
            await sendMessage(chatId, '🎤 Mendengarkan pesan suara...');
            rawTransactions = await processAudioTransaction(buffer, media.mimetype);
        }

        if (rawTransactions.length > 0) {
            transactions = await enrichTransactions(rawTransactions, user.id, userWallets, defaultWallet, { income: incomeCategories, expense: expenseCategories });
        }
    } else {
        // Text message processing
        transactions = await processTransactions(
            message,
            user.id,
            userWallets,
            defaultWallet,
            { income: incomeCategories, expense: expenseCategories }
        );
    }

    if (transactions.length > 0) {
      const result = await saveTransactions(transactions);
      await stopTyping(chatId);

      if (result.success) {
        let reply = `✅ *Transaksi tersimpan (${transactions.length})*\n`;
        transactions.forEach(t => {
          const icon = t.type === 'income' ? '📈' : '📉';
          reply += `${icon} *${t.description}*: Rp ${formatRupiah(t.amount)}\n`;
          reply += `${t._categoryName} • ${t._walletName}\n`;
        });
        await sendMessage(chatId, reply);
      } else {
        await sendMessage(chatId, `⚠️ Gagal menyimpan: ${result.error?.message || 'Unknown error'}`);
      }
    } else {
      await stopTyping(chatId);
      await sendMessage(chatId, MESSAGES.mainMenu);
    }

    console.log(`⏱️ Execution time: ${Date.now() - startTime}ms`);
    return c.text('OK');

  } catch (error) {
    console.error('💥 CRITICAL ERROR:', error);
    await stopTyping(chatId);
    console.log(`⏱️ Execution time (error): ${Date.now() - startTime}ms`);
    return c.text('Error', 500);
  }
});

// Health check endpoint
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// =============================================================================
// SERVER STARTUP
// =============================================================================

const startServer = async () => {
  console.log('🤖 Duwitku Bot v2.1 starting...');
  console.log(`⚡ Performance: AI timeout ${CONFIG.aiTimeoutMs}ms`);
  
  // Start HTTP server
  serve({ fetch: app.fetch, port: CONFIG.port });
  console.log(`🚀 Server running on port ${CONFIG.port}`);
  
  // Register webhook with delay to allow WAHA to fully start
  setTimeout(async () => {
    await registerWebhook();
  }, 5000);
};

startServer();
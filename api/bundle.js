import crypto from 'crypto';

export default async function handler(req, res) {
  // Handle webhook dari Duitku
  if (req.method === 'POST' && req.query.webhook === '1') return handleWebhook(req, res);
  // Generate kode akses unik (dipanggil admin)
  if (req.method === 'POST' && req.query.action === 'generate') return generateCodes(req, res);
  // Redeem kode akses (dipanggil user)
  if (req.method === 'POST' && req.query.action === 'redeem') return redeemCode(req, res);
  // Buat invoice bundle
  if (req.method === 'POST') return createBundleInvoice(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── 1. BUAT INVOICE BUNDLE ────────────────────────────────
async function createBundleInvoice(req, res) {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const supabaseUrl  = process.env.SUPABASE_URL         || '';
  const supabaseKey  = process.env.SUPABASE_ANON_KEY    || '';
  const appUrl       = process.env.APP_URL || 'https://parentingai.vercel.app';

  const { packageId, email, name } = req.body || {};
  if (!packageId || !email) return res.status(400).json({ error: 'packageId dan email wajib' });

  const PACKAGES = {
    ebook:    { name: 'ParentingAI Ebook PDF',                 amount: 49000,  months: 0 },
    starter:  { name: 'ParentingAI Bundle Starter (Ebook + 1 Bulan App)', amount: 79000,  months: 1 },
    plus:     { name: 'ParentingAI Bundle Plus (Ebook + 3 Bulan App)',    amount: 149000, months: 3 },
  };

  const pkg = PACKAGES[packageId];
  if (!pkg) return res.status(400).json({ error: 'packageId tidak valid' });

  const orderId   = `BUNDLE-${packageId.toUpperCase()}-${Date.now()}`;
  const timestamp = Date.now().toString();

  const signature = crypto.createHash('sha256')
    .update(`${merchantCode}${timestamp}${apiKey}`)
    .digest('hex');

  const payload = {
    paymentAmount:    pkg.amount,
    merchantOrderId:  orderId,
    productDetails:   pkg.name,
    additionalParam:  JSON.stringify({ packageId, months: pkg.months, email }),
    merchantUserInfo: email,
    customerVaName:   (name || email.split('@')[0]).substring(0, 20),
    email,
    itemDetails: [{
      name:     pkg.name,
      price:    pkg.amount,
      quantity: 1,
    }],
    customerDetail: {
      firstName: name || email.split('@')[0],
      lastName:  '',
      email,
      phoneNumber: '08000000000',
    },
    callbackUrl:  `${appUrl}/api/bundle?webhook=1`,
    returnUrl:    `${appUrl}/beli?status=success&order=${orderId}`,
    expiryPeriod: 1440,
  };

  try {
    const response = await fetch('https://api-prod.duitku.com/api/merchant/createInvoice', {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'x-duitku-merchantcode': merchantCode,
        'x-duitku-signature':    signature,
        'x-duitku-timestamp':    timestamp,
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) {
      return res.status(500).json({ error: 'Duitku error: ' + raw.substring(0, 100) });
    }

    if (!data.paymentUrl) {
      return res.status(400).json({ error: data.statusMessage || 'Gagal buat invoice' });
    }

    // Simpan ke bundle_orders
    await fetch(`${supabaseUrl}/rest/v1/bundle_orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        order_id:   orderId,
        email:      email,
        package_id: packageId,
        amount:     pkg.amount,
        months:     pkg.months,
        status:     'pending',
      }),
    });

    return res.status(200).json({ paymentUrl: data.paymentUrl, orderId });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── 2. WEBHOOK — setelah pembayaran berhasil ──────────────
async function handleWebhook(req, res) {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const supabaseUrl  = process.env.SUPABASE_URL         || '';
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

  const { merchantOrderId, amount, additionalParam, resultCode, reference, signature: sig } = req.body || {};

  const expected = crypto.createHash('md5')
    .update(`${merchantCode}${amount}${merchantOrderId}${apiKey}`)
    .digest('hex');
  if (sig !== expected) return res.status(400).send('FAIL');

  if (resultCode !== '00') {
    await patchOrder(supabaseUrl, supabaseKey, merchantOrderId, 'failed');
    return res.status(200).send('SUCCESS');
  }

  let packageId = '', months = 0, email = '';
  try {
    const info  = JSON.parse(additionalParam || '{}');
    packageId   = info.packageId || '';
    months      = info.months    || 0;
    email       = info.email     || '';
  } catch(e) {}

  // Update order status
  await patchOrder(supabaseUrl, supabaseKey, merchantOrderId, 'success', reference);

  // Generate kode akses unik
  const accessCode = generateCode();

  // Simpan kode ke bundle_codes
  await fetch(`${supabaseUrl}/rest/v1/bundle_codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      code:       accessCode,
      order_id:   merchantOrderId,
      email:      email,
      package_id: packageId,
      months:     months,
      used:       false,
    }),
  });

  // Kirim kode via email (pakai Supabase Edge Function jika ada)
  // Untuk sementara kode bisa dilihat di admin dashboard
  console.log(`Bundle payment success: ${merchantOrderId} | code: ${accessCode} | email: ${email}`);

  return res.status(200).send('SUCCESS');
}

// ── 3. REDEEM KODE ────────────────────────────────────────
async function redeemCode(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL      || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

  const { code, userId } = req.body || {};
  if (!code || !userId) return res.status(400).json({ error: 'code dan userId wajib' });

  // Cek kode
  const r = await fetch(`${supabaseUrl}/rest/v1/bundle_codes?code=eq.${code.toUpperCase()}&select=*`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
  });
  const codes = await r.json();

  if (!codes.length)      return res.status(404).json({ error: 'Kode tidak ditemukan' });
  if (codes[0].used)      return res.status(400).json({ error: 'Kode sudah pernah digunakan' });

  const { months, package_id: pkgId } = codes[0];

  // Tandai kode sudah dipakai
  await fetch(`${supabaseUrl}/rest/v1/bundle_codes?code=eq.${code.toUpperCase()}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ used: true, used_by: userId, used_at: new Date().toISOString() }),
  });

  // Aktifkan premium jika ada bulan akses
  if (months > 0) {
    const now    = new Date();
    const expiry = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000);

    // Cek apakah sudah ada subscription
    const sr = await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=*`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    });
    const existing = await sr.json();

    // Jika sudah premium aktif, tambah waktu dari end date sekarang
    let startDate = now;
    if (existing.length && existing[0].status === 'active' && new Date(existing[0].current_period_end) > now) {
      startDate = new Date(existing[0].current_period_end);
    }
    const newExpiry = new Date(startDate.getTime() + months * 30 * 24 * 60 * 60 * 1000);

    await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        status: 'active',
        plan: 'bundle',
        price_idr: pkgId === 'starter' ? 79000 : 149000,
        current_period_start: now.toISOString(),
        current_period_end:   newExpiry.toISOString(),
        updated_at: now.toISOString(),
      }),
    });
  }

  return res.status(200).json({
    success: true,
    months,
    package_id: pkgId,
    hasApp: months > 0,
    message: months > 0
      ? `Kode berhasil! Akses premium ${months} bulan telah diaktifkan.`
      : 'Kode ebook berhasil diverifikasi.',
  });
}

// ── 4. GENERATE KODE MANUAL (admin) ──────────────────────
async function generateCodes(req, res) {
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  const { password, packageId, count = 1 } = req.body || {};
  if (password !== adminPass) return res.status(401).json({ error: 'Unauthorized' });

  const MONTHS = { ebook: 0, starter: 1, plus: 3 };
  const months = MONTHS[packageId] ?? 1;
  const codes  = [];

  for (let i = 0; i < Math.min(count, 50); i++) {
    codes.push({
      code:       generateCode(),
      order_id:   `MANUAL-ADMIN-${Date.now()}-${i}`,
      email:      'manual@admin',
      package_id: packageId,
      months,
      used:       false,
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL      || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

  await fetch(`${supabaseUrl}/rest/v1/bundle_codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(codes),
  });

  return res.status(200).json({ success: true, codes: codes.map(c => c.code) });
}

// ── UTILS ─────────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // hindari 0/O, 1/I
  let code = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code; // format: XXXX-XXXX-XXXX
}

async function patchOrder(url, key, orderId, status, txId = '') {
  await fetch(`${url}/rest/v1/bundle_orders?order_id=eq.${orderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ status, transaction_id: txId }),
  });
}

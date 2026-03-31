import crypto from 'crypto';

export default async function handler(req, res) {
  // Scalev GET saat validasi webhook — harus balas 200
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'ParentingAI' });
  if (req.method !== 'POST') return res.status(200).send('OK');

  const supabaseUrl    = process.env.SUPABASE_URL          || '';
  const supabaseKey    = process.env.SUPABASE_SERVICE_KEY  || process.env.SUPABASE_ANON_KEY || '';
  const signingSecret  = process.env.SCALEV_SIGNING_SECRET || '';
  const fonteToken     = process.env.FONNTE_TOKEN          || '';
  const appUrl         = process.env.APP_URL || 'https://parentingai.vercel.app';

  // ── 1. VERIFIKASI SIGNATURE SCALEV ─────────────────────
  if (signingSecret) {
    const receivedSig = req.headers['x-scalev-hmac-sha256'] || '';
    const expectedSig = crypto
      .createHmac('sha256', signingSecret)
      .update(JSON.stringify(req.body))
      .digest('base64');
    if (receivedSig !== expectedSig) {
      console.error('Scalev: signature tidak cocok');
      return res.status(401).send('Unauthorized');
    }
  }

  // ── 2. HANYA PROSES PAYMENT PAID ───────────────────────
  const { event, data } = req.body || {};
  console.log('Scalev event:', event, '| order:', data?.order_id, '| payment:', data?.payment_status);

  if (event !== 'order.payment_status_changed' || data?.payment_status !== 'paid') {
    return res.status(200).send('OK');
  }

  const scalevOrderId = data?.order_id || '';
  const email         = data?.destination_address?.email || '';
  const buyerName     = data?.destination_address?.name  || 'Bunda/Ayah';
  // Fonnte: nomor WA dari field phone Scalev
  // Scalev menyimpan phone dalam format 628xxx atau 08xxx
  const rawPhone      = data?.destination_address?.phone || '';

  if (!scalevOrderId) return res.status(200).send('OK');

  // ── 3. IDEMPOTENCY ─────────────────────────────────────
  const existRes = await fetch(
    `${supabaseUrl}/rest/v1/access_codes?scalev_order_id=eq.${scalevOrderId}&select=id,code`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const existing = await existRes.json();
  if (existing.length) {
    console.warn('Sudah diproses, kode:', existing[0].code);
    // Kirim ulang WA jika belum terkirim
    if (fonteToken && rawPhone) {
      await sendWA(fonteToken, rawPhone, existing[0].code, buyerName, appUrl);
    }
    return res.status(200).send('OK');
  }

  // ── 4. GENERATE KODE AKSES ─────────────────────────────
  const code = generateCode();

  const saveRes = await fetch(`${supabaseUrl}/rest/v1/access_codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      code,
      scalev_order_id: scalevOrderId,
      email,
      buyer_name: buyerName,
      phone: rawPhone,
      months: 1,
      amount: 99000,
      used: false,
    }),
  });

  if (!saveRes.ok) {
    console.error('Gagal simpan kode:', await saveRes.text());
    return res.status(500).send('FAIL');
  }

  console.log(`✅ Kode dibuat: ${code} | order: ${scalevOrderId} | phone: ${rawPhone}`);

  // ── 5. KIRIM WA VIA FONNTE ─────────────────────────────
  if (fonteToken && rawPhone) {
    await sendWA(fonteToken, rawPhone, code, buyerName, appUrl);
  } else {
    console.warn('Fonnte token atau phone tidak ada — WA tidak terkirim');
  }

  return res.status(200).send('OK');
}

// ── KIRIM WA FONNTE ────────────────────────────────────────
async function sendWA(token, phone, code, name, appUrl) {
  // Normalisasi nomor: 08xxx → 628xxx
  let target = phone.replace(/\D/g, ''); // hapus non-digit
  if (target.startsWith('0')) target = '62' + target.slice(1);
  if (!target.startsWith('62')) target = '62' + target;

  const firstName = (name || 'Bunda/Ayah').split(' ')[0];

  const message =
`Halo *${firstName}*! 👋

Terima kasih sudah membeli *ParentingAI Premium* 🌱

Berikut kode akses 1 bulan Anda:

╔══════════════════╗
   *${code}*
╚══════════════════╝

*Cara aktivasi:*
1. Buka aplikasi: ${appUrl}
2. Login atau daftar akun baru
3. Klik menu *Settings* ⚙️
4. Klik *"Punya Kode Akses?"*
5. Masukkan kode di atas → klik Aktifkan

✅ Akses premium 1 bulan langsung aktif!

_Simpan pesan ini baik-baik ya._
_Kode hanya bisa digunakan 1x._

Pertanyaan? Balas pesan ini 😊`;

  try {
    const form = new URLSearchParams();
    form.append('target', target);
    form.append('message', message);
    form.append('countryCode', '62');
    form.append('typing', 'true');
    form.append('delay', '1');

    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { 'Authorization': token },
      body: form,
    });

    const result = await res.json();
    if (result.status) {
      console.log(`✅ WA terkirim ke ${target}`);
    } else {
      console.error(`❌ WA gagal ke ${target}:`, result.reason || result);
    }
    return result;
  } catch(e) {
    console.error('Fonnte error:', e.message);
  }
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

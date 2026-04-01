export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL         || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

  const { code, userId } = req.body || {};
  if (!code || !userId) return res.status(400).json({ error: 'code dan userId wajib' });

  const cleanCode = code.trim().toUpperCase();

  // ── 1. CEK KODE ────────────────────────────────────────
  const r = await fetch(
    `${supabaseUrl}/rest/v1/access_codes?code=eq.${cleanCode}&select=*`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const codes = await r.json();

  if (!codes.length) return res.status(404).json({ error: 'Kode tidak ditemukan. Pastikan penulisan benar.' });
  if (codes[0].used)  return res.status(400).json({ error: 'Kode ini sudah pernah digunakan.' });

  const months = codes[0].months || 1;

  // ── 2. TANDAI KODE DIPAKAI ─────────────────────────────
  await fetch(`${supabaseUrl}/rest/v1/access_codes?code=eq.${cleanCode}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      used:    true,
      used_by: userId,
      used_at: new Date().toISOString(),
    }),
  });

  // ── 3. AKTIFKAN PREMIUM ────────────────────────────────
  // Cek apakah sudah ada subscription aktif — jika ada, tambah dari end date
  const sr = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=status,current_period_end`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const subs = await sr.json();

  const now = new Date();
  let startDate = now;
  if (subs.length && subs[0].status === 'active' && new Date(subs[0].current_period_end) > now) {
    // Sudah premium — perpanjang dari tanggal akhir yang ada
    startDate = new Date(subs[0].current_period_end);
  }
  const expiry = new Date(startDate.getTime() + months * 30 * 24 * 60 * 60 * 1000);

  await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      status:               'active',
      plan:                 'scalev',
      price_idr:            99000,
      current_period_start: now.toISOString(),
      current_period_end:   expiry.toISOString(),
      updated_at:           now.toISOString(),
    }),
  });

  // Log ke payment_log
  await fetch(`${supabaseUrl}/rest/v1/payment_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      user_id:  userId,
      order_id: codes[0].scalev_order_id || `REDEEM-${cleanCode}`,
      amount:   codes[0].amount || 99000,
      status:   'success',
      payload:  { method: 'scalev_code', code: cleanCode, months },
    }),
  });

  console.log(`✅ Kode ${cleanCode} dipakai oleh user ${userId}, premium aktif ${months} bulan`);

  return res.status(200).json({
    success: true,
    months,
    expiry: expiry.toISOString(),
    message: `Akses premium ${months} bulan berhasil diaktifkan! Selamat! 🎉`,
  });
}

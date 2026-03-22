// api/payment.js — Duitku Payment Gateway
// Docs: https://docs.duitku.com/api/id/

import crypto from 'crypto';

const DUITKU_BASE_URL = 'https://api-sandbox.duitku.com/api/merchant'; // sandbox
// Production: 'https://api-prod.duitku.com/api/merchant'

export default async function handler(req, res) {

  // ── WEBHOOK dari Duitku (konfirmasi pembayaran) ──
  if (req.method === 'POST' && req.query.webhook === '1') {
    return handleWebhook(req, res);
  }

  // ── Buat invoice baru ──
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';

  if (!merchantCode || !apiKey) {
    return res.status(500).json({ error: 'Duitku belum dikonfigurasi di server' });
  }

  const { orderId, amount, productDetails, email, userId } = req.body;

  if (!orderId || !amount || !email) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }

  try {
    const expiryPeriod = 1440; // 24 jam dalam menit
    const timestamp    = Date.now();

    // Signature: MD5(merchantCode + orderId + amount + apiKey)
    const signature = crypto
      .createHash('md5')
      .update(`${merchantCode}${orderId}${amount}${apiKey}`)
      .digest('hex');

    const appUrl = process.env.APP_URL || 'https://parentingai.vercel.app';

    const payload = {
      merchantCode,
      paymentAmount:   amount,
      merchantOrderId: orderId,
      productDetails:  productDetails || 'ParentingAI Premium 1 Bulan',
      email,
      additionalParam: userId || '',
      paymentMethod:   'VC',   // VC = semua metode yang aktif
      merchantUserInfo: email,
      customerVaName:   email.split('@')[0],
      callbackUrl:     `${appUrl}/api/payment?webhook=1`,
      returnUrl:       `${appUrl}/?payment=success&order=${orderId}`,
      signature,
      expiryPeriod,
    };

    const response = await fetch(`${DUITKU_BASE_URL}/createinvoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-duitku-signature': signature,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || data.statusCode !== '00') {
      return res.status(400).json({
        error: data.statusMessage || 'Gagal membuat invoice Duitku',
        detail: data
      });
    }

    return res.status(200).json({
      paymentUrl:      data.paymentUrl,
      reference:       data.reference,
      merchantOrderId: orderId,
    });

  } catch (error) {
    console.error('Duitku error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ── Handler Webhook dari Duitku ──
async function handleWebhook(req, res) {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const supabaseUrl  = process.env.SUPABASE_URL         || '';
  const supabaseKey  = process.env.SUPABASE_ANON_KEY    || '';

  const {
    merchantCode: mc,
    amount,
    merchantOrderId,
    productDetail,
    additionalParam: userId,
    paymentCode,
    resultCode,
    merchantUserId,
    reference,
    signature: receivedSig,
  } = req.body;

  // Verifikasi signature
  const expectedSig = crypto
    .createHash('md5')
    .update(`${merchantCode}${amount}${merchantOrderId}${apiKey}`)
    .digest('hex');

  if (receivedSig !== expectedSig) {
    console.error('Duitku webhook: invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // resultCode '00' = success, '01' = pending, lainnya = failed
  const status = resultCode === '00' ? 'success'
               : resultCode === '01' ? 'pending'
               : 'failed';

  try {
    // Update payment_log di Supabase
    const supaRes = await fetch(
      `${supabaseUrl}/rest/v1/payment_log?order_id=eq.${merchantOrderId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          status,
          transaction_id: reference,
          payload: req.body,
        }),
      }
    );

    // Jika sukses, aktifkan subscription
    if (status === 'success' && userId) {
      const now    = new Date();
      const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 hari

      await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          status:                 'active',
          plan:                   'monthly',
          price_idr:              parseInt(amount),
          current_period_start:   now.toISOString(),
          current_period_end:     expiry.toISOString(),
          updated_at:             now.toISOString(),
        }),
      });

      console.log(`✅ Premium activated for user ${userId} until ${expiry.toISOString()}`);
    }

    return res.status(200).send('SUCCESS');
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: error.message });
  }
}

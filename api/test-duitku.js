import crypto from 'crypto';

export default async function handler(req, res) {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const timestamp    = Date.now().toString();

  // Signature v1 (body): MD5(merchantCode + timestamp + apiKey)
  const sig1 = crypto.createHash('md5')
    .update(`${merchantCode}${timestamp}${apiKey}`)
    .digest('hex');

  const results = {};

  // TEST 1: API baru dengan header auth
  try {
    const r = await fetch('https://api-prod.duitku.com/api/merchant/createInvoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-duitku-merchantcode': merchantCode,
        'x-duitku-signature': sig1,
        'x-duitku-timestamp': timestamp,
      },
      body: JSON.stringify({
        paymentAmount: 10000,
        merchantOrderId: `TEST-${Date.now()}`,
        productDetails: 'Test',
        customerVaName: 'Test',
        email: 'test@test.com',
        callbackUrl: 'https://parentingai.vercel.app/api/payment?webhook=1',
        returnUrl: 'https://parentingai.vercel.app/',
        expiryPeriod: 10,
      }),
    });
    const txt = await r.text();
    results['api-prod + header'] = { status: r.status, body: txt.substring(0, 150) };
  } catch(e) { results['api-prod + header'] = { error: e.message }; }

  // TEST 2: API lama passport dengan body auth
  try {
    const sig2 = crypto.createHash('md5')
      .update(merchantCode + '10000' + `TEST2-${Date.now()}` + apiKey)
      .digest('hex');
    const r = await fetch('https://passport.duitku.com/webapi/api/merchant/createInvoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode,
        paymentAmount: 10000,
        merchantOrderId: `TEST2-${Date.now()}`,
        productDetails: 'Test',
        customerVaName: 'Test',
        email: 'test@test.com',
        callbackUrl: 'https://parentingai.vercel.app/api/payment?webhook=1',
        returnUrl: 'https://parentingai.vercel.app/',
        expiryPeriod: 10,
        signature: sig2,
      }),
    });
    const txt = await r.text();
    results['passport + body'] = { status: r.status, body: txt.substring(0, 150) };
  } catch(e) { results['passport + body'] = { error: e.message }; }

  // TEST 3: API baru dengan body (bukan header)
  try {
    const r = await fetch('https://api-prod.duitku.com/api/merchant/createInvoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode,
        paymentAmount: 10000,
        merchantOrderId: `TEST3-${Date.now()}`,
        productDetails: 'Test',
        customerVaName: 'Test',
        email: 'test@test.com',
        callbackUrl: 'https://parentingai.vercel.app/api/payment?webhook=1',
        returnUrl: 'https://parentingai.vercel.app/',
        expiryPeriod: 10,
        signature: sig1,
      }),
    });
    const txt = await r.text();
    results['api-prod + body'] = { status: r.status, body: txt.substring(0, 150) };
  } catch(e) { results['api-prod + body'] = { error: e.message }; }

  return res.status(200).json({
    merchantCode,
    apiKeyLength: apiKey.length,
    results
  });
}

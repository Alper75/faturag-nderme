const Fatura = require('./Fatura');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env;
  const { uuid, type = 'html' } = req.body; // type: 'html' veya 'pdf'

  if (!uuid) {
    return res.status(400).json({ success: false, error: 'UUID zorunludur' });
  }

  const fatura = new Fatura();

  try {
    if (TEST_MODE === 'true') {
      fatura.enableTestMode();
      await fatura.setTestCredentials();
    } else {
      await fatura.setCredentials(GIB_USERNAME, GIB_PASSWORD);
    }

    await fatura.login();

    // HTML olarak al
    const result = await fatura.getHTML(uuid, false); // false = onaylanmadı (taslak)
    
    await fatura.logout();

    if (type === 'pdf') {
      // PDF için dönüştürme servisi kullanabilirsiniz
      // Şimdilik HTML dönelim
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(result.data || result);
    }

    // HTML olarak döndür
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(result.data || result);

  } catch (error) {
    try { await fatura.logout(); } catch (_) {}
    
    return res.status(500).json({
      success: false,
      error: 'Fatura görüntüleme hatası',
      message: error.message
    });
  }
};
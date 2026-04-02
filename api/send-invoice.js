/**
 * send-invoice.js — E-Arşiv Fatura API
 * 
 * XML yapısı referansı (gerçek faturadan):
 * - TaxTotal: KDV (0015) + diğer vergiler (0011 KV.Stopaj, 0003 GV.Stopaj)
 * - WithholdingTaxTotal: KDV Tevkifatı (6xx kodları, örn. 625 = Ticari Reklam)
 * - LegalMonetaryTotal.PayableAmount = TaxInclusiveAmount - WithholdingTaxTotal - Stopaj(V0011/V0003)
 */
const Fatura = require('./Fatura');

// ─── Sabitler ─────────────────────────────────────────────────────────────────

const INVOICE_TYPES = {
  'SATIS': 'SATIS',
  'TEVKIFAT': 'TEVKIFAT',
  'IADE': 'IADE',
  'ISTISNA': 'ISTISNA',
  'OZELMATRAH': 'OZELMATRAH',
  'IHRACKAYITLI': 'IHRACKAYITLI'
};

const UNIT_TYPES = {
  'C62': 'C62', 'DAY': 'DAY', 'HUR': 'HUR', 'KGM': 'KGM',
  'LTR': 'LTR', 'MTR': 'MTR', 'MTK': 'MTK', 'MTQ': 'MTQ',
  'ADET': 'C62', 'PAKET': 'PA', 'KUTU': 'BX',
  'KG': 'KGM', 'LT': 'LTR', 'TON': 'TNE',
  'SAAT': 'HUR', 'GUN': 'DAY', 'AY': 'MON', 'YIL': 'ANN'
};

const CURRENCIES = { 'TRY': 'TRY', 'USD': 'USD', 'EUR': 'EUR', 'GBP': 'GBP' };

/**
 * KDV Tevkifat kodları → tevkifat oranı (KDV'nin yüzdesi olarak)
 * Örn: 625 → %30 demek, KDV'nin %30'u tevkif edilir
 * XML'de: withholdingAmount = kdvTutari * (tevkifatOrani / 100)
 */
const WITHHOLDING_RATES = {
  '601': 70, '602': 50, '603': 70, '604': 50, '605': 50,
  '606': 50, '607': 50, '608': 70, '609': 50, '610': 20,
  '611': 20, '612': 40, '613': 40, '614': 50, '615': 50,
  '616': 90, '617': 20, '618': 20, '619': 20, '620': 20,
  '621': 20, '622': 20, '623': 20, '624': 50, '625': 30,  // Ticari Reklam: %30
  '626': 20, '627': 20, '801': 70, '802': 50, '803': 70
};

/**
 * Tevkifat kodu → açıklama (GİB kodları)
 */
const WITHHOLDING_NAMES = {
  '601': 'Yapım İşleri ile Bu İşlerle Birlikte İfa Edilen Mühendislik-Mimarlık ve Etüt-Proje Hizmetleri [KDVGUT-(I/C-2.1.3.2.1)]',
  '602': 'Etüt, Plan-Proje, Danışmanlık, Denetim ve Benzeri Hizmetler [KDVGUT-(I/C-2.1.3.2.2)]',
  '603': 'Makine, Teçhizat, Demirbaş ve Taşıtlara Ait Tadil, Bakım ve Onarım Hizmetleri [KDVGUT-(I/C-2.1.3.2.3)]',
  '604': 'Yemek Servis ve Organizasyon Hizmetleri [KDVGUT-(I/C-2.1.3.2.4)]',
  '605': 'İşgücü Temin Hizmetleri [KDVGUT-(I/C-2.1.3.2.5)]',
  '606': 'Yapı Denetim Hizmetleri [KDVGUT-(I/C-2.1.3.2.6)]',
  '607': 'Fason Olarak Yaptırılan Tekstil ve Konfeksiyon İşleri [KDVGUT-(I/C-2.1.3.2.7)]',
  '608': 'Turistik Mağazalara Verilen Müşteri Bulma / Götürme Hizmetleri [KDVGUT-(I/C-2.1.3.2.8)]',
  '609': 'Spor Kulüplerinin Yayın, Reklam ve İsim Hakkı Gelirlerine Konu İşlemler [KDVGUT-(I/C-2.1.3.2.9)]',
  '610': 'Temizlik Hizmetleri [KDVGUT-(I/C-2.1.3.2.10)]',
  '611': 'Çevre ve Bahçe Bakım Hizmetleri [KDVGUT-(I/C-2.1.3.2.11)]',
  '612': 'Servis Taşımacılığı [KDVGUT-(I/C-2.1.3.2.12)]',
  '613': 'Her Türlü Baskı ve Basım Hizmetleri [KDVGUT-(I/C-2.1.3.2.13)]',
  '614': 'Külçe Metal Teslimleri [KDVGUT-(I/C-2.1.3.3.1)]',
  '615': 'Bakır, Çinko, Demir-Çelik Ürünlerinin Teslimi [KDVGUT-(I/C-2.1.3.3.2)]',
  '616': 'Hurda ve Atık Teslimi [KDVGUT-(I/C-2.1.3.3.3)]',
  '617': 'Metal, Plastik, Lastik, Kauçuk, Kâğıt ve Cam Hurda Teslimi [KDVGUT-(I/C-2.1.3.3.3)]',
  '618': 'Pamuk, Tiftik, Yün ve Yapağı Teslimi [KDVGUT-(I/C-2.1.3.3.4)]',
  '619': 'Ağaç ve Orman Ürünleri Teslimi [KDVGUT-(I/C-2.1.3.3.5)]',
  '620': 'Yük Taşımacılığı Hizmetleri [KDVGUT-(I/C-2.1.3.2.14)]',
  '621': 'Ticari Reklam Hizmetleri (Kısmi) [KDVGUT-(I/C-2.1.3.2.15)] Kısmi',
  '622': 'Güvenlik Hizmetleri [KDVGUT-(I/C-2.1.3.2.16)]',
  '623': 'Fuar ve Sergi Organizasyon Hizmetleri [KDVGUT-(I/C-2.1.3.2.17)]',
  '624': 'Depolama Hizmetleri [KDVGUT-(I/C-2.1.3.2.18)]',
  '625': 'Ticari Reklam Hizmetleri [KDVGUT-(I/C-2.1.3.2.15)]',
  '626': 'Tekstil ve Konfeksiyon Ürünlerinin Teslimi [KDVGUT-(I/C-2.1.3.3.6)]',
  '627': 'Diğer Hizmetler [KDVGUT-(I/C-2.1.3.2.22)]',
  '801': 'Ticari Reklam Hizmetleri (Stopaj Dahil) [KDVGUT-(I/C-2.1.3.2.15)]',
  '802': 'Yapım İşleri (Stopaj Dahil) [KDVGUT-(I/C-2.1.3.2.1)]',
  '803': 'Makine Onarım (Stopaj Dahil)'
};

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function formatDate(d) {
  if (!d) {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  }
  // Gelen format: YYYY-MM-DD → DD/MM/YYYY
  const [year, month, day] = d.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(t) {
  return t || new Date().toTimeString().slice(0, 8);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Ana fatura veri oluşturma ─────────────────────────────────────────────────

function buildInvoiceData(body) {
  console.log('=== buildInvoiceData başladı ===');

  // ── Ürün satırları ──────────────────────────────────────────────────────────
  const malHizmetTable = body.products.map((p, index) => {
    const miktar        = parseFloat(p.quantity)  || 0;
    const birimFiyat    = parseFloat(p.unitPrice)  || 0;
    const kdvOrani      = parseFloat(p.vatRate)    || 0;
    const iskontoOrani  = parseFloat(p.discountRate) || 0;

    const malHizmetTutari = round2(miktar * birimFiyat);
    const iskontoTutari   = round2(malHizmetTutari * (iskontoOrani / 100));
    const netTutar        = round2(malHizmetTutari - iskontoTutari);   // KDV matrahı
    const kdvTutari       = round2(netTutar * (kdvOrani / 100));

    // KDV Tevkifatı (WithholdingTaxTotal → satır bazlı)
    const tevkifatKodu = p.withholdingCode || '';
    let tevkifatOrani  = 0;
    let tevkifatTutari = 0;

    if (tevkifatKodu && WITHHOLDING_RATES[tevkifatKodu]) {
      tevkifatOrani  = WITHHOLDING_RATES[tevkifatKodu];
      tevkifatTutari = round2(kdvTutari * (tevkifatOrani / 100));
    }

    return {
      siraNo: index + 1,
      malHizmet: p.name,
      miktar,
      birim: UNIT_TYPES[p.unitType] || 'C62',
      birimFiyat,
      malHizmetTutari,
      iskontoArttm: 'Iskonto',
      iskontoOrani,
      iskontoTutari,
      iskontoNedeni: '',
      fiyat: netTutar,          // net (KDV hariç) tutar = LineExtensionAmount
      kdvOrani,
      kdvTutari,
      tevkifatKodu,
      _tevkifatOrani:  tevkifatOrani,
      _tevkifatTutari: tevkifatTutari,
      gtip: '',
      ozelMatrahNedeni: 0,
      ozelMatrahTutari: 0,
      tevkifatKodu_v9015: tevkifatKodu ? parseInt(tevkifatKodu) : 0
    };
  });

  // ── Genel toplamlar ─────────────────────────────────────────────────────────
  const matrah        = round2(malHizmetTable.reduce((s, p) => s + p.fiyat, 0));
  const toplamIskonto = round2(malHizmetTable.reduce((s, p) => s + p.iskontoTutari, 0));
  const hesaplananKDV = round2(malHizmetTable.reduce((s, p) => s + p.kdvTutari, 0));

  // KDV Tevkifatı toplamı (WithholdingTaxTotal)
  const hesaplananV9015 = round2(
    malHizmetTable
      .filter(p => p.tevkifatKodu)
      .reduce((s, p) => s + p._tevkifatTutari, 0)
  );

  // Stopaj (KV/GV) hesaplama — TaxTotal'a eklenir, V0011/V0003
  let hesaplananV0011 = 0;
  let stopajList = [];

  if (body.taxes && body.taxes.length > 0) {
    body.taxes.forEach(tax => {
      const stopajTutar = round2(matrah * (parseFloat(tax.rate) / 100));
      if (tax.type === 'V0011') {
        hesaplananV0011 += stopajTutar;
        stopajList.push({
          kod: '0011',
          ad: 'KV. STOPAJI',
          oran: parseFloat(tax.rate),
          tutar: stopajTutar
        });
      } else if (tax.type === 'V0003') {
        hesaplananV0011 += stopajTutar; // GV stopajı da PayableAmount'tan düşülür
        stopajList.push({
          kod: '0003',
          ad: 'GV. STOPAJI',
          oran: parseFloat(tax.rate),
          tutar: stopajTutar
        });
      }
    });
    hesaplananV0011 = round2(hesaplananV0011);
  }

  const vergilerDahilToplam = round2(matrah + hesaplananKDV);
  // Ödenecek = Vergiler dahil - KDV Tevkifatı - Stopaj
  const odenecekTutar = round2(vergilerDahilToplam - hesaplananV9015 - hesaplananV0011);

  // ── vergiTable: GİB sistemine gönderilecek vergi satırları ─────────────────
  // (Mevcut e-fatura kütüphanesi bu alanı destekliyorsa)
  const vergiTable = [];

  // KDV tevkifatı varsa
  if (hesaplananV9015 > 0 && malHizmetTable.some(p => p.tevkifatKodu)) {
    const firstWh = malHizmetTable.find(p => p.tevkifatKodu);
    vergiTable.push({
      vergiKodu: 'V9015',
      vergiAdi: WITHHOLDING_NAMES[firstWh.tevkifatKodu] || 'KDV Tevkifatı',
      vergiTutari: hesaplananV9015,
      tevkifatOrani: firstWh._tevkifatOrani,
      tevkifatKodu: firstWh.tevkifatKodu
    });
  }

  // Stopaj varsa
  stopajList.forEach(s => {
    vergiTable.push({
      vergiKodu: `V${s.kod}`,
      vergiAdi: s.ad,
      vergiTutari: s.tutar,
      stopajOrani: s.oran
    });
  });

  // ── Fatura nesnesi ──────────────────────────────────────────────────────────
  const invoiceData = {
    // Temel
    faturaUuid:    body.uuid || undefined,
    belgeNumarasi: '',
    faturaTarihi:  formatDate(body.date),
    saat:          formatTime(body.time),
    paraBirimi:    CURRENCIES[body.currency] || 'TRY',
    dovzTLkur:     (body.currency && body.currency !== 'TRY') ? (body.currencyRate || '1') : '0',
    faturaTipi:    INVOICE_TYPES[body.invoiceType] || 'SATIS',

    // Alıcı
    vknTckn:       body.buyerTaxId,
    aliciUnvan:    body.buyerTitle    || '',
    aliciAdi:      body.buyerFirstName || '',
    aliciSoyadi:   body.buyerLastName  || '',
    vergiDairesi:  body.buyerTaxOffice || '',
    ulke:          body.country        || 'Türkiye',
    bulvarcaddesokak: body.buyerAddress || '',
    mahalleSemtIlce:  '',
    sehir: '',

    // Ürünler
    malHizmetTable: malHizmetTable.map(p => ({
      malHizmet:        p.malHizmet,
      miktar:           p.miktar,
      birim:            p.birim,
      birimFiyat:       p.birimFiyat,
      kdvOrani:         p.kdvOrani,
      fiyat:            p.fiyat,
      iskontoArttm:     p.iskontoArttm,
      iskontoOrani:     p.iskontoOrani,
      iskontoTutari:    p.iskontoTutari,
      iskontoNedeni:    p.iskontoNedeni,
      malHizmetTutari:  p.malHizmetTutari,
      kdvTutari:        p.kdvTutari,
      tevkifatKodu:     p.tevkifatKodu_v9015 || 0,
      ozelMatrahNedeni: 0,
      ozelMatrahTutari: 0,
      gtip: ''
    })),

    // Vergi tablosu (stopaj için)
    vergiTable,

    // Toplamlar — GİB sistemine gönderilecek
    matrah,
    malhizmetToplamTutari:      matrah,
    toplamIskonto,
    hesaplanankdv:              hesaplananKDV,
    tevkifataTabiIslemTutar:    round2(malHizmetTable.filter(p => p.tevkifatKodu).reduce((s, p) => s + p.fiyat, 0)),
    tevkifataTabiIslemKdv:      round2(malHizmetTable.filter(p => p.tevkifatKodu).reduce((s, p) => s + p.kdvTutari, 0)),
    hesaplananV9015,
    hesaplananV0011,
    vergilerToplami:            hesaplananKDV,
    vergilerDahilToplamTutar:   vergilerDahilToplam,
    toplamMasraflar:            0,
    odenecekTutar,

    // İrsaliye (opsiyonel)
    irsaliyeNumarasi: body.waybillNumber || '',
    irsaliyeTarihi:   body.waybillDate ? formatDate(body.waybillDate) : '',

    // Sipariş (opsiyonel)
    siparisNumarasi: body.orderNumber || '',
    siparisTarihi:   body.orderDate ? formatDate(body.orderDate) : '',

    // Not
    not: body.note || '',

    // GİB'in beklediği diğer alanlar
    iadeTable:    [],
    hangiTip:     '5000/30000'
  };

  console.log('Fatura verisi:', JSON.stringify({
    faturaTipi: invoiceData.faturaTipi,
    matrah,
    hesaplananKDV,
    hesaplananV9015,
    hesaplananV0011,
    odenecekTutar
  }, null, 2));

  return invoiceData;
}

// ─── Vercel Handler ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env;

  if (!GIB_USERNAME || !GIB_PASSWORD) {
    return res.status(500).json({
      success: false,
      error: 'GIB kimlik bilgileri yapılandırılmamış (GIB_USERNAME / GIB_PASSWORD)'
    });
  }

  const body = req.body;
  console.log('İstek geldi:', JSON.stringify(body, null, 2));

  // ── Validasyon ────────────────────────────────────────────────────────────
  if (!body.buyerTaxId) {
    return res.status(400).json({ success: false, error: 'VKN/TCKN zorunludur' });
  }
  if (body.buyerTaxId === '11111111111' || body.buyerTaxId === '11111111110') {
    return res.status(400).json({
      success: false,
      error: 'Test VKN/TCKN kullanılamaz. Gerçek vergi numarası giriniz.'
    });
  }
  if (!body.products || body.products.length === 0) {
    return res.status(400).json({ success: false, error: 'En az bir ürün/hizmet ekleyiniz' });
  }

  // ── İşlem ─────────────────────────────────────────────────────────────────
  const fatura = new Fatura();

  try {
    if (TEST_MODE === 'true') {
      fatura.enableTestMode();
      await fatura.setTestCredentials();
      console.log('TEST MODU aktif');
    } else {
      await fatura.setCredentials(GIB_USERNAME, GIB_PASSWORD);
    }

    await fatura.login();
    console.log('GİB girişi başarılı');

    const invoiceData = buildInvoiceData(body);

    const result = await fatura.createDraft(invoiceData);
    console.log('Taslak oluşturuldu:', JSON.stringify(result?.data || result, null, 2));

    await fatura.logout();

    // Sonucu normalize et
    const resultData = result?.data || result || {};
    const invoiceUUID = resultData.uuid || resultData.faturaUuid || invoiceData.faturaUuid || '';

    return res.status(200).json({
      success: true,
      message: 'Fatura başarıyla oluşturuldu',
      data: {
        invoiceUUID,
        documentNumber: resultData.belgeNumarasi || '',
        taxIdUsed: body.buyerTaxId,
        invoiceType: body.invoiceType,
        totals: {
          matrah: invoiceData.matrah,
          kdv: invoiceData.hesaplananKDV,
          kdvTevkifat: invoiceData.hesaplananV9015,
          stopaj: invoiceData.hesaplananV0011,
          vergilerDahil: invoiceData.vergilerDahilToplamTutar,
          odenecek: invoiceData.odenecekTutar
        },
        rawResult: TEST_MODE === 'true' ? resultData : undefined
      }
    });

  } catch (error) {
    try { await fatura.logout(); } catch (_) { /* ignore */ }

    console.error('HATA:', error);

    // GİB hata mesajlarını parse et
    let errorMessage = error.message || 'Bilinmeyen hata';
    let errorCode = null;

    if (error.response?.data) {
      const gibError = error.response.data;
      errorMessage = gibError.error || gibError.message || errorMessage;
      errorCode = gibError.errorCode;
      console.error('GİB Hatası:', JSON.stringify(gibError, null, 2));
    }

    return res.status(500).json({
      success: false,
      error: 'Fatura oluşturma hatası',
      message: errorMessage,
      errorCode,
      stack: TEST_MODE === 'true' ? error.stack : undefined
    });
  }
};

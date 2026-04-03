/**
 * api/send-invoice.js
 * bilaleren/e-fatura paketi (npm: e-fatura@^2.0.1)
 * https://github.com/bilaleren/e-fatura
 */

const {
  default: EInvoice,
  InvoiceType,
  EInvoiceUnitType,
  EInvoiceCurrencyType,
  EInvoiceApiError,
  EInvoiceApiErrorCode,
  EInvoiceMissingTokenError,
  EInvoiceMissingCredentialsError,
} = require('e-fatura');

// ─── KDV Tevkifat kodları → KDV üzerindeki tevkifat oranı (%) ────────────────
// Örn: 625 → 30 → hesaplanan KDV'nin %30'u tevkif edilir
const WITHHOLDING_RATES = {
  601: 70, 602: 50, 603: 70, 604: 50, 605: 50,
  606: 50, 607: 50, 608: 70, 609: 50, 610: 20,
  611: 20, 612: 40, 613: 40, 614: 50, 615: 50,
  616: 90, 617: 20, 618: 20, 619: 20, 620: 20,
  622: 20, 623: 20, 624: 50, 625: 30,
  626: 20, 627: 20, 801: 70, 802: 50, 803: 70,
};

// EInvoiceUnitType string → enum map
const UNIT_MAP = {
  C62: EInvoiceUnitType.ADET,   ADET: EInvoiceUnitType.ADET,
  HUR: EInvoiceUnitType.SAAT,   SAAT: EInvoiceUnitType.SAAT,
  DAY: EInvoiceUnitType.GUN,    GUN:  EInvoiceUnitType.GUN,
  MON: EInvoiceUnitType.AY,     AY:   EInvoiceUnitType.AY,
  ANN: EInvoiceUnitType.YIL,    YIL:  EInvoiceUnitType.YIL,
  KGM: EInvoiceUnitType.KG,     KG:   EInvoiceUnitType.KG,
  LTR: EInvoiceUnitType.LT,     LT:   EInvoiceUnitType.LT,
  TNE: EInvoiceUnitType.TON,    TON:  EInvoiceUnitType.TON,
  MTR: EInvoiceUnitType.MTR,    MTR:  EInvoiceUnitType.MTR,
  MTK: EInvoiceUnitType.MTK,    MTK:  EInvoiceUnitType.MTK,
  MTQ: EInvoiceUnitType.MTQ,    MTQ:  EInvoiceUnitType.MTQ,
  PA:  EInvoiceUnitType.PAKET,  PAKET: EInvoiceUnitType.PAKET,
  BX:  EInvoiceUnitType.KUTU,   KUTU:  EInvoiceUnitType.KUTU,
};

function r(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// YYYY-MM-DD → DD/MM/YYYY
function toGibDate(d) {
  if (!d) return undefined;
  if (d.includes('/')) return d;
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

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
    return res.status(500).json({ success: false, error: 'GIB_USERNAME / GIB_PASSWORD tanımlı değil' });
  }

  const body = req.body;

  // ── Validasyon ──────────────────────────────────────────────────────────────
  if (!body.buyerTaxId) {
    return res.status(400).json({ success: false, error: 'buyerTaxId zorunludur' });
  }
  if (['11111111111', '11111111110'].includes(body.buyerTaxId)) {
    return res.status(400).json({ success: false, error: 'Test vergi numarası kullanılamaz' });
  }
  if (!body.products || !body.products.length) {
    return res.status(400).json({ success: false, error: 'En az bir ürün ekleyiniz' });
  }

  // ── Satır hesaplamaları ─────────────────────────────────────────────────────
  const lines = body.products.map((p) => {
    const qty    = parseFloat(p.quantity)     || 0;
    const up     = parseFloat(p.unitPrice)    || 0;
    const vr     = parseFloat(p.vatRate)      || 0;
    const dr     = parseFloat(p.discountRate) || 0;
    const whCode = p.withholdingCode ? parseInt(p.withholdingCode) : 0;

    const gross  = r(qty * up);
    const disc   = r(gross * (dr / 100));
    const net    = r(gross - disc);      // price (KDV hariç)
    const vat    = r(net * (vr / 100));
    const whRate = WITHHOLDING_RATES[whCode] || 0;
    const whAmt  = whCode ? r(vat * (whRate / 100)) : 0;

    const product = {
      name:                       p.name,
      quantity:                   qty,
      unitType:                   UNIT_MAP[p.unitType] || EInvoiceUnitType.ADET,
      unitPrice:                  up,
      price:                      net,
      discountOrIncrement:        'İskonto',
      discountOrIncrementRate:    dr,
      discountOrIncrementAmount:  disc,
      discountOrIncrementReason:  '',
      vatRate:                    vr,
      vatAmount:                  vat,
      totalAmount:                r(net + vat),
    };

    // Tevkifat alanları (GİB ek alan olarak okur)
    if (whCode && whRate > 0) {
      product.tevkifatKodu   = whCode;
      product.tevkifatOrani  = whRate;
      product.tevkifatTutari = whAmt;
    }

    return { product, net, vat, whAmt, whCode };
  });

  // ── Genel toplamlar ─────────────────────────────────────────────────────────
  const totalDisc   = r(lines.reduce((s, l) => s + l.product.discountOrIncrementAmount, 0));
  const matrah      = r(lines.reduce((s, l) => s + l.net, 0));
  const totalVAT    = r(lines.reduce((s, l) => s + l.vat, 0));
  const totalWH     = r(lines.reduce((s, l) => s + l.whAmt, 0));
  const grossTotal  = r(lines.reduce((s, l) => s + r(l.product.unitPrice * (l.product.quantity || 1)), 0));

  // Stopaj (KV/GV Stopajı — matrah üzerinden)
  let stopaj = 0;
  if (body.taxes && body.taxes.length) {
    body.taxes.forEach((t) => {
      if (t.type === 'V0011' || t.type === 'V0003') {
        stopaj = r(stopaj + r(matrah * (parseFloat(t.rate) / 100)));
      }
    });
  }

  const includedTaxes = r(matrah + totalVAT);
  const payable       = r(includedTaxes - totalWH - stopaj);

  // ── Payload ─────────────────────────────────────────────────────────────────
  const payload = {
    date:        toGibDate(body.date),
    time:        body.time,
    invoiceType: InvoiceType[body.invoiceType] || InvoiceType.SATIS,
    currency:
      body.currency === 'USD' ? EInvoiceCurrencyType.DOLAR
    : body.currency === 'EUR' ? EInvoiceCurrencyType.EURO
    : body.currency === 'GBP' ? EInvoiceCurrencyType.STERLIN
    : EInvoiceCurrencyType.TURK_LIRASI,

    taxOrIdentityNumber: body.buyerTaxId,
    buyerTitle:          body.buyerTitle     || undefined,
    buyerFirstName:      body.buyerFirstName || undefined,
    buyerLastName:       body.buyerLastName  || undefined,
    taxOffice:           body.buyerTaxOffice || undefined,
    fullAddress:         body.buyerAddress   || undefined,

    products: lines.map((l) => l.product),

    // Zorunlu toplamlar
    base:                    matrah,
    productsTotalPrice:      grossTotal,
    totalDiscountOrIncrement: totalDisc,
    calculatedVAT:           totalVAT,
    totalTaxes:              totalVAT,
    includedTaxesTotalPrice: includedTaxes,
    paymentPrice:            payable,

    note:          body.note          || undefined,
    orderNumber:   body.orderNumber   || undefined,
    orderDate:     toGibDate(body.orderDate),
    waybillNumber: body.waybillNumber || undefined,
    waybillDate:   toGibDate(body.waybillDate),
  };

  // Tevkifat/stopaj ek alanları (kütüphane bunları olduğu gibi GİB'e iletir)
  if (totalWH > 0) {
    payload.tevkifataTabiIslemTutar = r(lines.filter((l) => l.whCode > 0).reduce((s, l) => s + l.net, 0));
    payload.hesaplananV9015         = totalWH;
  }
  if (stopaj > 0) {
    payload.hesaplananV0011 = stopaj;
    payload.taxType = body.taxes.map((t) => `${t.type}-%${t.rate}`).join(',');
  }

  console.log('[send-invoice] özet →', {
    tip: payload.invoiceType, vkn: payload.taxOrIdentityNumber,
    matrah, totalVAT, totalWH, stopaj, payable,
  });

  // ── GİB işlemi ──────────────────────────────────────────────────────────────
  try {
    if (TEST_MODE === 'true') {
      await EInvoice.connect({ anonymous: true });
      console.log('[send-invoice] TEST modu — anonim bağlantı');
    } else {
      await EInvoice.connect({ username: GIB_USERNAME, password: GIB_PASSWORD });
      console.log('[send-invoice] PROD bağlantısı kuruldu');
    }

    const uuid = await EInvoice.createDraftInvoice(payload);
    console.log('[send-invoice] UUID:', uuid);
    await EInvoice.logout();

    return res.status(200).json({
      success: true,
      message: 'Fatura başarıyla oluşturuldu',
      data: {
        invoiceUUID:  uuid,
        taxIdUsed:    body.buyerTaxId,
        invoiceType:  body.invoiceType,
        totals: { matrah, kdv: totalVAT, kdvTevkifat: totalWH, stopaj, vergilerDahil: includedTaxes, odenecek: payable },
      },
    });

  } catch (err) {
    try { await EInvoice.logout(); } catch (_) {}
    console.error('[send-invoice] HATA:', err);

    if (err instanceof EInvoiceApiError) {
      const messages = {
        [EInvoiceApiErrorCode.UNKNOWN_ERROR]:              'GİB bilinmeyen hata döndürdü',
        [EInvoiceApiErrorCode.INVALID_RESPONSE]:           'GİB geçersiz yanıt döndürdü',
        [EInvoiceApiErrorCode.INVALID_ACCESS_TOKEN]:       'GİB erişim token\'ı geçersiz',
        [EInvoiceApiErrorCode.BASIC_INVOICE_NOT_CREATED]:  'Fatura GİB tarafından oluşturulamadı',
      };
      return res.status(400).json({
        success:     false,
        error:       messages[err.errorCode] || err.message,
        errorCode:   err.errorCode,
        rawResponse: TEST_MODE === 'true' ? err.response : undefined,
      });
    }

    if (err instanceof EInvoiceMissingTokenError) {
      return res.status(401).json({ success: false, error: 'GİB token eksik, kimlik bilgilerini kontrol edin' });
    }

    if (err instanceof EInvoiceMissingCredentialsError) {
      return res.status(401).json({ success: false, error: 'GİB kimlik bilgileri eksik/hatalı' });
    }

    return res.status(500).json({
      success:  false,
      error:    'Beklenmeyen hata',
      message:  err.message,
      stack:    TEST_MODE === 'true' ? err.stack : undefined,
    });
  }
};

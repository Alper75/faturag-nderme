/**
 * api/send-invoice.js
 * 
 * DÜZELTME: GİB Portal'in iç API'si vergi kodlarında "V" harfini (Örn: V0011) 
 * ve satırlarda v0011Orani / tevkifatKodu isimlendirmelerini zorunlu tutar.
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

// KDV Tevkifat kodları → tevkifat oranı (KDV'nin yüzdesi)
const WH_RATES = {
  601:70, 602:50, 603:70, 604:50, 605:50,
  606:50, 607:50, 608:70, 609:50, 610:20,
  611:20, 612:40, 613:40, 614:50, 615:50,
  616:90, 617:20, 618:20, 619:20, 620:20,
  622:20, 623:20, 624:50, 625:30,
  626:20, 627:20, 801:70, 802:50, 803:70,
};

const UNIT_MAP = {
  C62: EInvoiceUnitType.ADET,  ADET: EInvoiceUnitType.ADET,
  HUR: EInvoiceUnitType.SAAT,  SAAT: EInvoiceUnitType.SAAT,
  DAY: EInvoiceUnitType.GUN,   GUN:  EInvoiceUnitType.GUN,
  MON: EInvoiceUnitType.AY,    AY:   EInvoiceUnitType.AY,
  ANN: EInvoiceUnitType.YIL,   YIL:  EInvoiceUnitType.YIL,
  KGM: EInvoiceUnitType.KG,    KG:   EInvoiceUnitType.KG,
  LTR: EInvoiceUnitType.LT,    LT:   EInvoiceUnitType.LT,
  TNE: EInvoiceUnitType.TON,   TON:  EInvoiceUnitType.TON,
  MTR: EInvoiceUnitType.MTR,   MTK:  EInvoiceUnitType.MTK,
  MTQ: EInvoiceUnitType.MTQ,   PA:   EInvoiceUnitType.PAKET,
  BX:  EInvoiceUnitType.KUTU,
};

function r(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

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
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env;
  if (!GIB_USERNAME || !GIB_PASSWORD)
    return res.status(500).json({ success: false, error: 'GIB_USERNAME / GIB_PASSWORD tanımlı değil' });

  const body = req.body;

  if (!body.buyerTaxId)
    return res.status(400).json({ success: false, error: 'buyerTaxId zorunludur' });
  if (['11111111111', '11111111110'].includes(body.buyerTaxId))
    return res.status(400).json({ success: false, error: 'Test vergi numarası kullanılamaz' });
  if (!body.products?.length)
    return res.status(400).json({ success: false, error: 'En az bir ürün ekleyiniz' });

  // ── Stopaj Listesi (V0011: Kurumlar, V0003: Gelir) ────────────────────────
  const stopajList = (body.taxes || []).filter(t => t.type === 'V0011' || t.type === 'V0003');

  let totalV0011 = 0;
  let totalV0003 = 0;

  // ── Ürün Satırı Hesaplamaları ve GİB Etiketleri ───────────────────────────
  const lines = body.products.map((p) => {
    const qty    = parseFloat(p.quantity)     || 0;
    const up     = parseFloat(p.unitPrice)    || 0;
    const vr     = parseFloat(p.vatRate)      || 0;
    const dr     = parseFloat(p.discountRate) || 0;
    const whCode = p.withholdingCode ? parseInt(p.withholdingCode) : 0;

    const gross  = r(qty * up);
    const disc   = r(gross * (dr / 100));
    const net    = r(gross - disc);
    const vat    = r(net * (vr / 100));
    const whRate = WH_RATES[whCode] || 0;
    const whAmt  = whCode ? r(vat * (whRate / 100)) : 0;

    const product = {
      name:                      p.name,
      quantity:                  qty,
      unitType:                  UNIT_MAP[p.unitType] || EInvoiceUnitType.ADET,
      unitPrice:                 up,
      price:                     net,
      discountOrIncrement:       'İskonto',
      discountOrIncrementRate:   dr,
      discountOrIncrementAmount: disc,
      discountOrIncrementReason: '',
      vatRate:                   vr,
      vatAmount:                 vat,
      totalAmount:               r(net + vat),
    };

    // 1. KDV Tevkifatı GİB Formatı (ürün bazlı)
    if (whCode && whRate > 0) {
      product.tevkifatKodu   = whCode;
      product.tevkifatOrani  = whRate;
      product.tevkifatTutari = whAmt;
    }

    // 2. Stopaj GİB Formatı (ürün bazlı)
    stopajList.forEach(t => {
      const sRate = parseFloat(t.rate) || 0;
      const sAmt = r(net * (sRate / 100));
      
      if (t.type === 'V0011') {
          product.v0011Orani = sRate;
          product.v0011Tutari = sAmt;
          product.vergi = product.vergi || {};
          product.vergi.v0011Orani = sRate;
          product.vergi.v0011Tutari = sAmt;
          totalV0011 += sAmt;
      } else if (t.type === 'V0003') {
          product.v0003Orani = sRate;
          product.v0003Tutari = sAmt;
          product.vergi = product.vergi || {};
          product.vergi.v0003Orani = sRate;
          product.vergi.v0003Tutari = sAmt;
          totalV0003 += sAmt;
      }
    });

    return { product, net, vat, whAmt, whCode };
  });

  // Yuvarlamalar
  totalV0011 = r(totalV0011);
  totalV0003 = r(totalV0003);

  // ── Genel Toplamlar ───────────────────────────────────────────────────────
  const matrah      = r(lines.reduce((s, l) => s + l.net, 0));
  const totalDisc   = r(lines.reduce((s, l) => s + l.product.discountOrIncrementAmount, 0));
  const totalVAT    = r(lines.reduce((s, l) => s + l.vat, 0));
  const totalWH     = r(lines.reduce((s, l) => s + l.whAmt, 0));
  const grossTotal  = r(lines.reduce((s, l) => s + r(l.product.unitPrice * (l.product.quantity || 1)), 0));
  const whBase      = r(lines.filter(l => l.whCode > 0).reduce((s, l) => s + l.net, 0));
  const whVatTotal  = r(lines.filter(l => l.whCode > 0).reduce((s, l) => s + l.vat, 0));

  const includedTaxes = r(matrah + totalVAT);
  const payable       = r(includedTaxes - totalWH - totalV0011 - totalV0003);

  // Fatura Tipi Otomatik Ayarlama
  let invoiceType = InvoiceType[body.invoiceType] || InvoiceType.SATIS;
  if (totalWH > 0 && invoiceType === InvoiceType.SATIS) {
     invoiceType = InvoiceType.TEVKIFAT;
  }

  // ── JSON Payload (GİB Portal) ─────────────────────────────────────────────
  const payload = {
    date:        toGibDate(body.date),
    time:        body.time,
    invoiceType: invoiceType,
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

  // 3. KDV Tevkifatı Fatura Geneli Alt Toplamları
  if (totalWH > 0) {
    payload.hesaplananV9015         = totalWH;
    payload.tevkifataTabiIslemTutar = whBase;
    payload.tevkifataTabiIslemKdv   = whVatTotal;
  }

  // 4. Stopaj Fatura Geneli Alt Toplamları ve Vergi Tablosu
  const vergiTable = [];
  if (totalV0011 > 0) {
    payload.hesaplananV0011 = totalV0011;
    vergiTable.push({ vergiKodu: 'V0011', vergiTutari: totalV0011 });
  }
  if (totalV0003 > 0) {
    payload.hesaplananV0003 = totalV0003;
    vergiTable.push({ vergiKodu: 'V0003', vergiTutari: totalV0003 });
  }
  
  if (vergiTable.length > 0) {
    payload.vergiTable = vergiTable;
  }

  console.log('[send-invoice] Payload Gönderiliyor:', JSON.stringify({
    tip: payload.invoiceType, vkn: payload.taxOrIdentityNumber,
    matrah, kdv: totalVAT, tevkifat: totalWH, v0011: totalV0011, v0003: totalV0003, payable,
  }));

  // ── GİB İstek ──────────────────────────────────────────────────────────────
  try {
    if (TEST_MODE === 'true') {
      await EInvoice.connect({ anonymous: true });
    } else {
      await EInvoice.connect({ username: GIB_USERNAME, password: GIB_PASSWORD });
    }

    const uuid = await EInvoice.createDraftInvoice(payload);
    console.log('[send-invoice] UUID Başarıyla Alındı:', uuid);
    await EInvoice.logout();

    return res.status(200).json({
      success: true,
      message: 'Fatura başarıyla oluşturuldu',
      data: {
        invoiceUUID: uuid,
        taxIdUsed:   body.buyerTaxId,
        invoiceType: invoiceType,
        totals: { 
            matrah, kdv: totalVAT, kdvTevkifat: totalWH, 
            stopaj: r(totalV0011 + totalV0003), vergilerDahil: includedTaxes, odenecek: payable 
        },
      },
    });

  } catch (err) {
    try { await EInvoice.logout(); } catch (_) {}
    console.error('[send-invoice] HATA:', err);

    if (err instanceof EInvoiceApiError) {
      const msgs = {
        [EInvoiceApiErrorCode.UNKNOWN_ERROR]:             'GİB bilinmeyen hata döndürdü',
        [EInvoiceApiErrorCode.INVALID_RESPONSE]:          'GİB geçersiz yanıt döndürdü',
        [EInvoiceApiErrorCode.INVALID_ACCESS_TOKEN]:      'GİB erişim token\'ı geçersiz',
        [EInvoiceApiErrorCode.BASIC_INVOICE_NOT_CREATED]: 'Fatura GİB tarafından oluşturulamadı',
      };
      return res.status(400).json({
        success: false,
        error: msgs[err.errorCode] || err.message,
        errorCode: err.errorCode,
        rawResponse: TEST_MODE === 'true' ? err.response : undefined,
      });
    }

    return res.status(500).json({
      success: false, error: 'Beklenmeyen Hata',
      message: err.message,
    });
  }
};
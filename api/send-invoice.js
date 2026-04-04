/**
 * api/send-invoice.js
 * bilaleren/e-fatura (npm: e-fatura@^2.0.1)
 *
 * GİB'e gönderilen alanlar (test ile doğrulandı):
 *
 * Fatura geneli (…other spread):
 *   hesaplananV9015         → KDV tevkifat tutarı
 *   hesaplananV0011         → KV/GV stopaj tutarı
 *   tevkifataTabiIslemTutar → Tevkifata tabi net tutar
 *   tevkifataTabiIslemKdv   → Tevkifata tabi KDV
 *   vergiTable              → [{ vergiKodu:'V0011', vergiTutari:3000 }]
 *
 * Ürün bazlı (…other spread — PHP örneğiyle de uyumlu):
 *   tevkifatKodu    → integer (625)
 *   tevkifatOrani   → integer (30)
 *   tevkifatTutari  → number  (1200)
 *   v0011Orani      → number  (15)   ← stopaj oranı
 *   v0011Tutari     → number  (3000) ← stopaj tutarı
 *   vergi           → { v0011Orani:15, v0011Tutari:3000 }  ← eski format uyumluluğu
 *
 * vergilerToplami = SADECE KDV (stopaj dahil değil!)
 * paymentPrice    = vergilerDahil − KDV tevkifatı − stopaj
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

  // ── Stopaj listesi (fatura geneli) ────────────────────────────────────────
  // body.taxes = [{ type: 'V0011', rate: 15, name: 'KV. STOPAJI' }]
  const stopajList = (body.taxes || []).filter(t =>
    t.type === 'V0011' || t.type === 'V0003'
  );
  const stopajToplam = r(
    stopajList.reduce((s, t) => s, 0) // hesaplama aşağıda matrah bilinince yapılacak
  );

  // ── Ürün satırı hesaplamaları ─────────────────────────────────────────────
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

    // ── KDV Tevkifatı (ürün bazlı) ─────────────────────────────────────────
    if (whCode && whRate > 0) {
      product.tevkifatKodu   = whCode;
      product.tevkifatOrani  = whRate;
      product.tevkifatTutari = whAmt;
    }

    // ── Stopaj (ürün bazlı — her satıra eşit dağıtılacak, aşağıda güncellenir)
    // stopaj tutarı matrah toplamı bilinmeden hesaplanamaz, sonradan eklenecek

    return { product, net, vat, whAmt, whCode };
  });

  // ── Genel toplamlar ───────────────────────────────────────────────────────
  const matrah      = r(lines.reduce((s, l) => s + l.net, 0));
  const totalDisc   = r(lines.reduce((s, l) => s + l.product.discountOrIncrementAmount, 0));
  const totalVAT    = r(lines.reduce((s, l) => s + l.vat, 0));
  const totalWH     = r(lines.reduce((s, l) => s + l.whAmt, 0));
  const grossTotal  = r(lines.reduce((s, l) => s + r(l.product.unitPrice * (l.product.quantity || 1)), 0));
  const whBase      = r(lines.filter(l => l.whCode > 0).reduce((s, l) => s + l.net, 0));
  const whVatTotal  = r(lines.filter(l => l.whCode > 0).reduce((s, l) => s + l.vat, 0));

  // Stopaj tutarını şimdi hesapla (matrah hazır)
  let stopajTutar = 0;
  const vergiTable = [];
  stopajList.forEach((t) => {
    const tutar = r(matrah * (parseFloat(t.rate) / 100));
    stopajTutar = r(stopajTutar + tutar);
    vergiTable.push({ vergiKodu: t.type, vergiTutari: tutar });
  });

  // ── Stopajı ürün satırlarına ekle ─────────────────────────────────────────
  if (stopajTutar > 0 && lines.length > 0) {
    // Stopaj tüm ürünlere eşit dağıtılır (son satıra yuvarlama farkı)
    let kalanStopaj = stopajTutar;
    lines.forEach((l, i) => {
      const urunStopaj = i < lines.length - 1
        ? r((l.net / matrah) * stopajTutar)
        : kalanStopaj;
      kalanStopaj = r(kalanStopaj - urunStopaj);

      const stopajOrani = stopajList[0]?.rate || 0;
      // Ürün bazlı stopaj alanları (GİB iki formatı da kabul eder)
      l.product.v0011Orani  = parseFloat(stopajOrani);
      l.product.v0011Tutari = urunStopaj;
      l.product.vergi       = {
        v0011Orani:  parseFloat(stopajOrani),
        v0011Tutari: urunStopaj,
      };
    });
  }

  const includedTaxes = r(matrah + totalVAT);
  const payable       = r(includedTaxes - totalWH - stopajTutar);

  // ── Payload ───────────────────────────────────────────────────────────────
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

    base:                    matrah,
    productsTotalPrice:      grossTotal,
    totalDiscountOrIncrement: totalDisc,
    calculatedVAT:           totalVAT,   // SADECE KDV
    totalTaxes:              totalVAT,   // SADECE KDV
    includedTaxesTotalPrice: includedTaxes,
    paymentPrice:            payable,

    note:          body.note          || undefined,
    orderNumber:   body.orderNumber   || undefined,
    orderDate:     toGibDate(body.orderDate),
    waybillNumber: body.waybillNumber || undefined,
    waybillDate:   toGibDate(body.waybillDate),
  };

  // ── KDV Tevkifatı (fatura geneli) ─────────────────────────────────────────
  if (totalWH > 0) {
    payload.hesaplananV9015         = totalWH;
    payload.tevkifataTabiIslemTutar = whBase;
    payload.tevkifataTabiIslemKdv   = whVatTotal;
  }

  // ── Stopaj (fatura geneli) ────────────────────────────────────────────────
  if (stopajTutar > 0) {
    payload.hesaplananV0011 = stopajTutar;
    payload.vergiTable      = vergiTable;
  }

  console.log('[send-invoice]', JSON.stringify({
    tip: payload.invoiceType, vkn: payload.taxOrIdentityNumber,
    matrah, kdv: totalVAT, tevkifat: totalWH, stopaj: stopajTutar, payable,
  }));

  // ── GİB ───────────────────────────────────────────────────────────────────
  try {
    if (TEST_MODE === 'true') {
      await EInvoice.connect({ anonymous: true });
    } else {
      await EInvoice.connect({ username: GIB_USERNAME, password: GIB_PASSWORD });
    }

    const uuid = await EInvoice.createDraftInvoice(payload);
    console.log('[send-invoice] UUID:', uuid);
    await EInvoice.logout();

    return res.status(200).json({
      success: true,
      message: 'Fatura başarıyla oluşturuldu',
      data: {
        invoiceUUID: uuid,
        taxIdUsed:   body.buyerTaxId,
        invoiceType: body.invoiceType,
        totals: { matrah, kdv: totalVAT, kdvTevkifat: totalWH, stopaj: stopajTutar, vergilerDahil: includedTaxes, odenecek: payable },
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
    if (err instanceof EInvoiceMissingTokenError)
      return res.status(401).json({ success: false, error: 'GİB token eksik' });
    if (err instanceof EInvoiceMissingCredentialsError)
      return res.status(401).json({ success: false, error: 'GİB kimlik bilgileri hatalı' });

    return res.status(500).json({
      success: false, error: 'Beklenmeyen hata',
      message: err.message,
      stack: TEST_MODE === 'true' ? err.stack : undefined,
    });
  }
};

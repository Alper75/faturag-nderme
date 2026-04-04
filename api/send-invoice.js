/**
 * api/send-invoice.js
 * 
 * ÇÖZÜM: GİB'in İVD Login sistemine takılmamak için 'e-fatura' paketinin login
 * özelliğini kullanıyoruz. Ancak paket bizim tevkifat alanlarımızı sildiği için, 
 * araya "Axios Interceptor" ile girerek paketin gönderdiği eksik veriyi, 
 * bizim hazırladığımız %100 doğru JSON verisi ile anlık olarak değiştiriyoruz!
 */

const {
  default: EInvoice,
  InvoiceType,
  EInvoiceUnitType,
  EInvoiceCurrencyType
} = require('e-fatura');
const axios = require('axios');
const crypto = require('crypto');

// ── AXIOS INTERCEPTOR: E-FATURA PAKETİNİ HACKLEME BÖLÜMÜ ──────────────────
if (!global.axiosGibPatched) {
  const originalRequest = axios.Axios.prototype.request;
  axios.Axios.prototype.request = async function(config) {
      try {
          if (config.data && typeof config.data === 'string' && config.data.includes('EARSIV_PORTAL_FATURA_KAYDET')) {
              const params = new URLSearchParams(config.data);
              const jpString = params.get('jp');
              if (jpString) {
                  const jp = JSON.parse(jpString);
                  // Eğer not alanında gizli "MAGIC_" anahtarımızı görürsek, paketin verisini bizimkiyle değiştiriyoruz.
                  if (jp.not && jp.not.startsWith('MAGIC_')) {
                      const customJp = global.customGibPayloads[jp.not];
                      if (customJp) {
                          customJp.faturaUuid = jp.faturaUuid; // Paketin ürettiği UUID'yi koru
                          params.set('jp', JSON.stringify(customJp));
                          config.data = params.toString();
                          delete global.customGibPayloads[jp.not]; // Belleği temizle
                      }
                  }
              }
          }
      } catch (e) {
          console.error("Interceptor Hatası:", e);
      }
      return originalRequest.apply(this, arguments);
  };
  global.axiosGibPatched = true;
  global.customGibPayloads = {};
}
// ──────────────────────────────────────────────────────────────────────────

const WH_RATES = {
  601:70, 602:50, 603:70, 604:50, 605:50,
  606:50, 607:50, 608:70, 609:50, 610:20,
  611:20, 612:40, 613:40, 614:50, 615:50,
  616:90, 617:20, 618:20, 619:20, 620:20,
  622:20, 623:20, 624:50, 625:30,
  626:20, 627:20, 801:70, 802:50, 803:70,
};

const UNIT_MAP = {
  C62: 'C62',  ADET: 'C62',
  HUR: 'HUR',  SAAT: 'HUR',
  DAY: 'DAY',   GUN: 'DAY',
  MON: 'MON',    AY: 'MON',
  ANN: 'ANN',   YIL: 'ANN',
  KGM: 'KGM',    KG: 'KGM',
  LTR: 'LTR',    LT: 'LTR',
  TNE: 'TNE',   TON: 'TNE',
  MTR: 'MTR',   MTK: 'MTK',
  MTQ: 'MTQ',    PA: 'PA',
   BX: 'BX',   KUTU: 'BX'
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
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env;
  if (!GIB_USERNAME || !GIB_PASSWORD)
    return res.status(500).json({ success: false, error: 'GIB_USERNAME / GIB_PASSWORD tanımlı değil' });

  const body = req.body;

  if (!body.buyerTaxId) return res.status(400).json({ success: false, error: 'buyerTaxId zorunludur' });
  if (['11111111111', '11111111110'].includes(body.buyerTaxId)) return res.status(400).json({ success: false, error: 'Test vergi numarası kullanılamaz' });
  if (!body.products?.length) return res.status(400).json({ success: false, error: 'En az bir ürün ekleyiniz' });

  // ── Stopaj Listesi ────────────────────────────────────────────────────────
  const stopajList = (body.taxes || []).filter(t => t.type === 'V0011' || t.type === 'V0003' || t.type === '0011' || t.type === '0003');
  let totalV0011 = 0;
  let totalV0003 = 0;

  // ── Ürün Satırı Hesaplamaları (Saf GİB JSON Formatı) ──────────────────────
  const malHizmetTable = body.products.map((p) => {
    const qty    = parseFloat(p.quantity)     || 0;
    const up     = parseFloat(p.unitPrice)    || 0;
    const vr     = parseFloat(p.vatRate)      || 0;
    const dr     = parseFloat(p.discountRate) || 0;
    const whCode = p.withholdingCode ? parseInt(p.withholdingCode) : 0;

    const gross  = r(qty * up);           // GİB 'Fiyat'
    const disc   = r(gross * (dr / 100)); // İskonto Tutarı
    const net    = r(gross - disc);       // GİB 'Mal Hizmet Tutarı'
    const vat    = r(net * (vr / 100));   // KDV Tutarı
    const whRate = WH_RATES[whCode] || 0;
    const whAmt  = whCode ? r(vat * (whRate / 100)) : 0;

    const row = {
      malHizmet: p.name,
      miktar: qty,
      birim: UNIT_MAP[p.unitType] || 'C62',
      birimFiyat: up,
      fiyat: gross,
      iskontoOrani: dr,
      iskontoTutari: disc,
      iskontoNedeni: '',
      malHizmetTutari: net,
      kdvOrani: vr,
      kdvTutari: vat,
      vergininKdvTutari: "0"
    };

    if (whCode && whRate > 0) {
      row.tevkifatKodu   = whCode;
      row.tevkifatOrani  = whRate;
      row.tevkifatTutari = whAmt;
    }

    stopajList.forEach(t => {
      const sRate = parseFloat(t.rate) || 0;
      const sAmt = r(net * (sRate / 100));
      if (t.type.includes('0011')) {
          row.v0011Orani = sRate;
          row.v0011Tutari = sAmt;
          totalV0011 += sAmt;
      } else if (t.type.includes('0003')) {
          row.v0003Orani = sRate;
          row.v0003Tutari = sAmt;
          totalV0003 += sAmt;
      }
    });

    return { row, net, vat, whAmt, whCode };
  });

  totalV0011 = r(totalV0011);
  totalV0003 = r(totalV0003);

  // ── Genel Toplamlar ───────────────────────────────────────────────────────
  const matrah      = r(malHizmetTable.reduce((s, l) => s + l.net, 0));
  const totalDisc   = r(malHizmetTable.reduce((s, l) => s + l.row.iskontoTutari, 0));
  const totalVAT    = r(malHizmetTable.reduce((s, l) => s + l.vat, 0));
  const totalWH     = r(malHizmetTable.reduce((s, l) => s + l.whAmt, 0));
  const grossTotal  = r(malHizmetTable.reduce((s, l) => s + l.row.fiyat, 0));
  const whBase      = r(malHizmetTable.filter(l => l.whCode > 0).reduce((s, l) => s + l.net, 0));
  const whVatTotal  = r(malHizmetTable.filter(l => l.whCode > 0).reduce((s, l) => s + l.vat, 0));

  const includedTaxes = r(matrah + totalVAT);
  const payable       = r(includedTaxes - totalWH - totalV0011 - totalV0003);

  let finalInvoiceType = InvoiceType[body.invoiceType] || InvoiceType.SATIS;
  if ((totalWH > 0 || totalV0011 > 0 || totalV0003 > 0) && finalInvoiceType === InvoiceType.SATIS) {
     finalInvoiceType = InvoiceType.TEVKIFAT;
  }

  // ── 1. GİZLİ ANAHTAR VE KUSURSUZ JSON OLUŞTURMA ───────────────────────────
  const magicNote = "MAGIC_" + crypto.randomUUID();

  const customJp = {
    faturaUuid: "", // İnterceptör dolduracak
    belgeNumarasi: "",
    faturaTarihi: toGibDate(body.date),
    saat: body.time,
    paraBirimi: body.currency || "TRY",
    dovzTLkur: "0",
    faturaTipi: finalInvoiceType,
    vknTckn: body.buyerTaxId,
    aliciAdi: body.buyerFirstName || "",
    aliciSoyadi: body.buyerLastName || "",
    vergiDairesi: body.buyerTaxOffice || "",
    bulvarcaddesokak: body.buyerAddress || "",
    mahalleSemtIlce: "",
    sehir: " ",
    ulke: body.country || "Türkiye",
    matrah: matrah,
    malHizmetToplamTutari: grossTotal,
    toplamIskonto: totalDisc,
    hesaplanankdv: totalVAT,
    vergilerToplami: totalVAT,
    vergilerDahilToplamTutar: includedTaxes,
    odenecekTutar: payable,
    not: body.note || "", 
    siparisNumarasi: body.orderNumber || "",
    siparisTarihi: toGibDate(body.orderDate) || "",
    irsaliyeNumarasi: body.waybillNumber || "",
    irsaliyeTarihi: toGibDate(body.waybillDate) || "",
    fisNo: "", fisTarihi: "", fisSaati: "", fisTipi: "", zRaporNo: "", okcSeriNo: "",
    malHizmetTable: malHizmetTable.map(l => l.row)
  };

  if (totalWH > 0) {
    customJp.hesaplananV9015 = totalWH;
    customJp.tevkifataTabiIslemTutar = whBase;
    customJp.tevkifataTabiIslemKdv = whVatTotal;
  }

  const vergiTable = [];
  if (totalV0011 > 0) {
      customJp.hesaplananV0011 = totalV0011;
      vergiTable.push({ vergiKodu: "0011", vergiTutari: totalV0011.toString() });
  }
  if (totalV0003 > 0) {
      customJp.hesaplananV0003 = totalV0003;
      vergiTable.push({ vergiKodu: "0003", vergiTutari: totalV0003.toString() });
  }
  if (vergiTable.length > 0) {
      customJp.vergiTable = vergiTable;
  }

  // Interceptor'ın yakalaması için global objeye yerleştiriyoruz
  global.customGibPayloads[magicNote] = customJp;

  // ── 2. E-FATURA PAKETİNİ ÇALIŞTIRMA (Sadece Standart Gönderim Yapacak) ────
  const packagePayload = {
    date:        toGibDate(body.date),
    time:        body.time,
    invoiceType: finalInvoiceType,
    currency:    body.currency === 'USD' ? EInvoiceCurrencyType.DOLAR : EInvoiceCurrencyType.TURK_LIRASI,
    taxOrIdentityNumber: body.buyerTaxId,
    buyerTitle:          body.buyerTitle,
    buyerFirstName:      body.buyerFirstName,
    buyerLastName:       body.buyerLastName,
    taxOffice:           body.buyerTaxOffice,
    fullAddress:         body.buyerAddress,
    products: body.products.map(p => ({
        name: p.name,
        quantity: parseFloat(p.quantity) || 1,
        unitType: UNIT_MAP[p.unitType] || EInvoiceUnitType.ADET,
        unitPrice: parseFloat(p.unitPrice) || 0,
        price: r((parseFloat(p.quantity) || 1) * (parseFloat(p.unitPrice) || 0)),
        vatRate: parseFloat(p.vatRate) || 0,
        vatAmount: r(r((parseFloat(p.quantity) || 1) * (parseFloat(p.unitPrice) || 0)) * ((parseFloat(p.vatRate) || 0)/100)),
        totalAmount: r((parseFloat(p.quantity) || 1) * (parseFloat(p.unitPrice) || 0))
    })),
    base: matrah,
    productsTotalPrice: grossTotal,
    totalDiscountOrIncrement: totalDisc,
    calculatedVAT: totalVAT,
    totalTaxes: totalVAT,
    includedTaxesTotalPrice: includedTaxes,
    paymentPrice: payable,
    note: magicNote // E-Fatura paketinin GİB'e yollayacağı notu Sihirli Anahtarımız yapıyoruz!
  };

  try {
    console.log('[send-invoice] GİB Sistemine Bağlanılıyor (IVD Login)...');

    // Paket ile sorunsuzca giriş yapılıyor
    if (TEST_MODE === 'true') {
      await EInvoice.connect({ anonymous: true });
    } else {
      await EInvoice.connect({ username: GIB_USERNAME, password: GIB_PASSWORD });
    }

    // Paketin createDraftInvoice metodunu tetikliyoruz
    // İstek arka planda atılırken yazdığımız Interceptor onu havada yakalayıp 
    // eksik JSON'u, bizim üstteki customJp'miz ile değiştirerek GİB'e bırakacak.
    const uuid = await EInvoice.createDraftInvoice(packagePayload);

    await EInvoice.logout();

    return res.status(200).json({
      success: true,
      message: 'Fatura başarıyla oluşturuldu',
      data: {
        invoiceUUID: uuid,
        taxIdUsed:   body.buyerTaxId,
        invoiceType: finalInvoiceType,
        totals: { 
            matrah, kdv: totalVAT, kdvTevkifat: totalWH, 
            stopaj: r(totalV0011 + totalV0003), vergilerDahil: includedTaxes, odenecek: payable 
        },
      },
    });

  } catch (err) {
    try { await EInvoice.logout(); } catch (_) {}
    console.error('[send-invoice] HATA:', err);

    return res.status(500).json({
      success: false, 
      error: 'GİB İletim Hatası Veya Fatura Kuralları Geçersiz',
      message: err.message,
    });
  }
};
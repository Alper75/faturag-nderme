/**
 * api/send-invoice.js - Düzeltilmiş Versiyon
 */

const {
  default: EInvoice,
  InvoiceType,
  EInvoiceUnitType,
  EInvoiceCurrencyType
} = require('e-fatura');
const { v4: uuidv4 } = require('uuid');

// KDV Tevkifat kodları → tevkifat oranı (KDV'nin yüzdesi)
const WH_RATES = {
  601:70, 602:50, 603:70, 604:50, 605:50,
  606:50, 607:50, 608:70, 609:50, 610:20,
  611:20, 612:40, 613:40, 614:50, 615:50,
  616:90, 617:20, 618:20, 619:20, 620:20,
  622:20, 623:20, 624:50, 625:30,
  626:20, 627:20, 801:70, 802:50, 803:70,
};

// GİB Doğrudan Birim Kodları
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
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env;
  if (!GIB_USERNAME || !GIB_PASSWORD)
    return res.status(500).json({ success: false, error: 'GIB_USERNAME / GIB_PASSWORD tanımlı değil' });

  const body = req.body;

  if (!body.buyerTaxId) return res.status(400).json({ success: false, error: 'buyerTaxId zorunludur' });
  if (['11111111111', '11111111110'].includes(body.buyerTaxId)) return res.status(400).json({ success: false, error: 'Test vergi numarası kullanılamaz' });
  if (!body.products?.length) return res.status(400).json({ success: false, error: 'En az bir ürün ekleyiniz' });

  // ── Stopaj Listesi ────────────────────────────────────────────────────────
  const stopajList = (body.taxes || []).filter(t => t.type === 'V0011' || t.type === 'V0003');
  
  // Stopaj toplamları
  let totalV0011 = 0;
  let totalV0003 = 0;

  // ── Ürün Satırı Hesaplamaları (Saf GİB JSON Formatı) ──────────────────────
  const malHizmetTable = [];
  
  for (const p of body.products) {
    const qty    = parseFloat(p.quantity)     || 0;
    const up     = parseFloat(p.unitPrice)    || 0;
    const vr     = parseFloat(p.vatRate)      || 0;
    const dr     = parseFloat(p.discountRate) || 0;
    const whCode = p.withholdingCode ? parseInt(p.withholdingCode) : 0;

    const gross  = r(qty * up);           // Fiyat
    const disc   = r(gross * (dr / 100)); // İskonto Tutarı
    const net    = r(gross - disc);       // Mal Hizmet Tutarı
    const vat    = r(net * (vr / 100));   // KDV Tutarı
    const whRate = WH_RATES[whCode] || 0;
    const whAmt  = whCode ? r(vat * (whRate / 100)) : 0;

    // Temel satır yapısı
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

    // KDV Tevkifat (ürün bazlı) - GİB formatı
    if (whCode && whRate > 0) {
      row.tevkifatKodu   = whCode.toString(); // STRING olmalı!
      row.tevkifatOrani  = whRate.toString(); // STRING olmalı!
      row.tevkifatTutari = whAmt;
    }

    // Stopaj (ürün bazlı) - GİB vergi tablosu formatı
    // Her stopaj türü için ayrı vergi satırı
    const vergiTableRow = [];
    
    stopajList.forEach(t => {
      const sRate = parseFloat(t.rate) || 0;
      const sAmt = r(net * (sRate / 100));
      
      if (t.type === 'V0011') {
        // KV Stopaj
        vergiTableRow.push({
          vergiKodu: "0015",  // KV Stopaj kodu
          vergiTutari: sAmt.toFixed(2),
          vergiOrani: sRate.toString()
        });
        totalV0011 += sAmt;
      } else if (t.type === 'V0003') {
        // GV Stopaj
        vergiTableRow.push({
          vergiKodu: "0003",  // GV Stopaj kodu
          vergiTutari: sAmt.toFixed(2),
          vergiOrani: sRate.toString()
        });
        totalV0003 += sAmt;
      }
    });

    // Vergi tablosunu satıra ekle
    if (vergiTableRow.length > 0) {
      row.vergiTable = vergiTableRow;
    }

    malHizmetTable.push({ 
      row, 
      net, 
      vat, 
      whAmt, 
      whCode,
      vergiTableRow 
    });
  }

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

  // Fatura Tipi Otomatik Ayarlama
  let finalInvoiceType = body.invoiceType || "SATIS";
  if (totalWH > 0 && finalInvoiceType === "SATIS") {
     finalInvoiceType = "TEVKIFAT";
  }

  const invoiceUUID = uuidv4();

  // ── SAF GİB JSON PAYLOAD ──────────────────────────────────────────────────
  const jp = {
    faturaUuid: invoiceUUID,
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

  // KDV Tevkifatı Fatura Geneli
  if (totalWH > 0) {
    jp.hesaplananV9015 = totalWH;  // KDV Tevkifat tutarı
    jp.tevkifataTabiIslemTutar = whBase;
    jp.tevkifataTabiIslemKdv = whVatTotal;
  }

  // Stopaj Fatura Geneli - Vergi Tablosu
  const vergiTable = [];
  if (totalV0011 > 0) {
      jp.hesaplananV0011 = totalV0011;
      vergiTable.push({ 
        vergiKodu: "0015",  // KV Stopaj
        vergiTutari: totalV0011.toFixed(2) 
      });
  }
  if (totalV0003 > 0) {
      jp.hesaplananV0003 = totalV0003;
      vergiTable.push({ 
        vergiKodu: "0003",  // GV Stopaj
        vergiTutari: totalV0003.toFixed(2) 
      });
  }
  if (vergiTable.length > 0) {
      jp.vergiTable = vergiTable;
  }

  // Debug: Payload'ı logla
  console.log('[DEBUG] GİB Payload:', JSON.stringify(jp, null, 2));

  // ── GİB'E İLETİM ─────────────────────────────────────────────────────────
  try {
    await EInvoice.connect(TEST_MODE === 'true' ? { anonymous: true } : { username: GIB_USERNAME, password: GIB_PASSWORD });

    let httpClient = null;
    let token = null;

    for (const key in EInvoice) {
        const val = EInvoice[key];
        if (val && typeof val.post === 'function' && val.interceptors) {
            httpClient = val;
        }
        if (typeof val === 'string' && val.length >= 32 && !val.includes(' ')) {
            token = val; 
        }
    }
    
    if (!httpClient) httpClient = EInvoice.client || EInvoice.axios || EInvoice.api;
    if (!token) token = typeof EInvoice.getToken === 'function' ? EInvoice.getToken() : (EInvoice.token || EInvoice._token);

    if (!httpClient || !token) {
        throw new Error("GİB Oturumu yakalanamadı.");
    }

    const baseUrl = TEST_MODE === 'true' 
        ? 'https://earsivportaltest.efatura.gov.tr/earsiv-services/dispatch' 
        : 'https://earsivportal.efatura.gov.tr/earsiv-services/dispatch';

    const params = new URLSearchParams();
    params.append('cmd', 'EARSIV_PORTAL_FATURA_KAYDET');
    params.append('pageName', 'RG_TASLAKLAR');
    params.append('token', token);
    params.append('jp', JSON.stringify(jp));

    console.log('[send-invoice] GİB\'e gönderiliyor...');

    const response = await httpClient.post(baseUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    await EInvoice.logout();

    if (response.data && response.data.data === 'Fatura başarıyla oluşturuldu.') {
        return res.status(200).json({
          success: true,
          message: 'Fatura başarıyla oluşturuldu',
          data: {
            invoiceUUID: invoiceUUID,
            taxIdUsed:   body.buyerTaxId,
            invoiceType: finalInvoiceType,
            totals: { 
                matrah, 
                kdv: totalVAT, 
                kdvTevkifat: totalWH, 
                stopaj: r(totalV0011 + totalV0003), 
                vergilerDahil: includedTaxes, 
                odenecek: payable 
            },
          },
        });
    } else {
        throw new Error(response.data.messages?.[0]?.text || JSON.stringify(response.data));
    }

  } catch (err) {
    try { await EInvoice.logout(); } catch (_) {}
    console.error('[send-invoice] HATA:', err.message);
    console.error('[send-invoice] Stack:', err.stack);

    return res.status(500).json({
      success: false, 
      error: 'GİB İletim Hatası',
      message: err.message,
      debug: TEST_MODE === 'true' ? { jp } : undefined
    });
  }
};
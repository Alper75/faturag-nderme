/**
 * api/send-invoice.js
 * 
 * ÇÖZÜM: e-fatura paketi JSON'daki özel vergi alanlarını (tevkifatKodu, v0011Orani) 
 * sildiği için, paketin sadece Token (Giriş) özelliğini kullanıp faturayı doğrudan 
 * GİB API'sine (Axios ile) saf JSON formatında iletiyoruz. PHP kütüphanesi ile aynı mantık!
 */

const { default: EInvoice } = require('e-fatura');
const axios = require('axios');
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
  let totalV0011 = 0;
  let totalV0003 = 0;

  // ── Ürün Satırı Hesaplamaları (Saf GİB JSON Formatı İçin) ─────────────────
  const malHizmetTable = body.products.map((p) => {
    const qty    = parseFloat(p.quantity)     || 0;
    const up     = parseFloat(p.unitPrice)    || 0;
    const vr     = parseFloat(p.vatRate)      || 0;
    const dr     = parseFloat(p.discountRate) || 0;
    const whCode = p.withholdingCode ? parseInt(p.withholdingCode) : 0;

    const gross  = r(qty * up);           // Fiyat
    const disc   = r(gross * (dr / 100)); // İskonto Tutarı
    const net    = r(gross - disc);       // Mal Hizmet Tutarı (Net Tutar)
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

    // Tevkifat (ürün bazlı)
    if (whCode && whRate > 0) {
      row.tevkifatKodu   = whCode;
      row.tevkifatOrani  = whRate;
      row.tevkifatTutari = whAmt;
    }

    // Stopaj (ürün bazlı)
    stopajList.forEach(t => {
      const sRate = parseFloat(t.rate) || 0;
      const sAmt = r(net * (sRate / 100));
      if (t.type === 'V0011') {
          row.v0011Orani = sRate;
          row.v0011Tutari = sAmt;
          totalV0011 += sAmt;
      } else if (t.type === 'V0003') {
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

  // KDV Tevkifatı Fatura Geneli (Eğer Varsa)
  if (totalWH > 0) {
    jp.hesaplananV9015 = totalWH;
    jp.tevkifataTabiIslemTutar = whBase;
    jp.tevkifataTabiIslemKdv = whVatTotal;
  }

  // Stopaj Fatura Geneli (Eğer Varsa)
  if (totalV0011 > 0) jp.hesaplananV0011 = totalV0011;
  if (totalV0003 > 0) jp.hesaplananV0003 = totalV0003;

  // ── GİB'E İLETİM (e-fatura paketinin kısıtlamalarını by-pass ediyoruz) ───
  try {
    // 1. Sadece güvenli Login olmak için paketi kullanıyoruz
    await EInvoice.connect(TEST_MODE === 'true' ? { anonymous: true } : { username: GIB_USERNAME, password: GIB_PASSWORD });
    
    // 2. Token'i paketten çekiyoruz
    const token = EInvoice.token || EInvoice._token || (EInvoice.client && EInvoice.client.token);
    if (!token) throw new Error("GİB Portalından token alınamadı.");

    // 3. Faturayı paket üzerinden DEĞİL, doğrudan Axios ile saf GİB API'sine yolluyoruz!
    const baseUrl = TEST_MODE === 'true' 
        ? 'https://earsivportaltest.efatura.gov.tr/earsiv-services/dispatch' 
        : 'https://earsivportal.efatura.gov.tr/earsiv-services/dispatch';

    const params = new URLSearchParams();
    params.append('cmd', 'EARSIV_PORTAL_FATURA_KAYDET');
    params.append('pageName', 'RG_TASLAKLAR');
    params.append('token', token);
    params.append('jp', JSON.stringify(jp));

    console.log('[send-invoice] Manuel Dispatch Başlıyor...', invoiceUUID);

    const response = await axios.post(baseUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    await EInvoice.logout();

    // 4. GİB Başarı Kontrolü
    if (response.data && response.data.data === 'Fatura başarıyla oluşturuldu.') {
        return res.status(200).json({
          success: true,
          message: 'Fatura başarıyla oluşturuldu',
          data: {
            invoiceUUID: invoiceUUID,
            taxIdUsed:   body.buyerTaxId,
            invoiceType: finalInvoiceType,
            totals: { 
                matrah, kdv: totalVAT, kdvTevkifat: totalWH, 
                stopaj: r(totalV0011 + totalV0003), vergilerDahil: includedTaxes, odenecek: payable 
            },
          },
        });
    } else {
        throw new Error(response.data.messages?.[0]?.text || JSON.stringify(response.data));
    }

  } catch (err) {
    try { await EInvoice.logout(); } catch (_) {}
    console.error('[send-invoice] HATA:', err.message);

    return res.status(500).json({
      success: false, 
      error: 'GİB İletim Hatası',
      message: err.message,
    });
  }
};
/**
 * api/send-invoice.js
 * 
 * KESİN ÇÖZÜM: e-fatura paketi tamamen devreden çıkarıldı! 
 * Node.js'in yerleşik 'fetch' özelliği ile doğrudan GİB API'sine bağlanılıp, 
 * Cookie (JSESSIONID) yönetimi manuel yapılıyor ve saf JSON iletiliyor.
 */

const crypto = require('crypto'); // Node.js yerleşik modülü (Şifreleme ve UUID için)

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
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

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

  // Fatura Tipi Otomatik Ayarlama (KDV Tevkifatı veya Stopaj varsa Tevkifat olmalıdır)
  let finalInvoiceType = body.invoiceType || "SATIS";
  if ((totalWH > 0 || totalV0011 > 0 || totalV0003 > 0) && finalInvoiceType === "SATIS") {
     finalInvoiceType = "TEVKIFAT";
  }

  const invoiceUUID = crypto.randomUUID(); // Node.js dahili güvenli UUID oluşturucusu

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
    jp.hesaplananV9015 = totalWH;
    jp.tevkifataTabiIslemTutar = whBase;
    jp.tevkifataTabiIslemKdv = whVatTotal;
  }

  // Stopaj Fatura Geneli ve Vergi Tablosu
  const vergiTable = [];
  if (totalV0011 > 0) {
      jp.hesaplananV0011 = totalV0011;
      vergiTable.push({ vergiKodu: "0011", vergiTutari: totalV0011.toString() });
  }
  if (totalV0003 > 0) {
      jp.hesaplananV0003 = totalV0003;
      vergiTable.push({ vergiKodu: "0003", vergiTutari: totalV0003.toString() });
  }
  if (vergiTable.length > 0) {
      jp.vergiTable = vergiTable;
  }

  console.log('[send-invoice] Payload Gönderiliyor:', JSON.stringify({
    tip: jp.faturaTipi, vkn: jp.vknTckn, matrah, kdv: totalVAT, tevkifat: totalWH, v0011: totalV0011, v0003: totalV0003, payable,
  }));

  // ── GİB'E İLETİM (Harici Paket Kullanılmadan %100 Node.js Native) ───────────
  try {
    const baseUrl = TEST_MODE === 'true' 
        ? 'https://earsivportaltest.efatura.gov.tr/earsiv-services' 
        : 'https://earsivportal.efatura.gov.tr/earsiv-services';

    // 1. GİB SİSTEMİNE GİRİŞ (LOGIN)
    const loginParams = new URLSearchParams();
    loginParams.append('assoscmd', TEST_MODE === 'true' ? 'login' : 'anologin');
    loginParams.append('userid', GIB_USERNAME);
    loginParams.append('sifre', GIB_PASSWORD);
    loginParams.append('sifre2', GIB_PASSWORD);
    loginParams.append('parola', '1');

    const loginRes = await fetch(`${baseUrl}/assos-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: loginParams.toString()
    });

    const loginData = await loginRes.json();
    const token = loginData.token;

    if (!token) {
        throw new Error(loginData.messages?.[0]?.text || "GİB Sistemine giriş yapılamadı. Kullanıcı adı veya şifrenizi kontrol edin.");
    }

    // Giriş sırasında GİB'in verdiği Oturum Çerezini (JSESSIONID) Yakalıyoruz
    const setCookieHeader = loginRes.headers.get('set-cookie');
    let cookieString = '';
    if (setCookieHeader) {
        const match = setCookieHeader.match(/JSESSIONID=[^;]+/);
        if (match) cookieString = match[0];
    }

    // 2. FATURAYI TASLAKLARA KAYDET (DISPATCH)
    const dispatchParams = new URLSearchParams();
    dispatchParams.append('cmd', 'EARSIV_PORTAL_FATURA_KAYDET');
    dispatchParams.append('pageName', 'RG_TASLAKLAR');
    dispatchParams.append('token', token);
    dispatchParams.append('jp', JSON.stringify(jp));

    const dispatchHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (cookieString) dispatchHeaders['Cookie'] = cookieString; // Yetki hatasını çözen altın vuruş!

    const dispatchRes = await fetch(`${baseUrl}/dispatch`, {
        method: 'POST',
        headers: dispatchHeaders,
        body: dispatchParams.toString()
    });

    const dispatchData = await dispatchRes.json();

    // 3. GÜVENLİ ÇIKIŞ (Sistemi Yormamak İçin)
    const logoutParams = new URLSearchParams();
    logoutParams.append('assoscmd', 'logout');
    logoutParams.append('token', token);
    fetch(`${baseUrl}/assos-login`, { 
        method: 'POST', 
        headers: dispatchHeaders, 
        body: logoutParams.toString() 
    }).catch(() => null);

    // 4. BAŞARI KONTROLÜ
    if (dispatchData.data === 'Fatura başarıyla oluşturuldu.') {
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
        throw new Error(dispatchData.messages?.[0]?.text || JSON.stringify(dispatchData));
    }

  } catch (err) {
    console.error('[send-invoice] HATA:', err.message);

    return res.status(500).json({
      success: false, 
      error: 'GİB İletim Hatası',
      message: err.message,
    });
  }
};
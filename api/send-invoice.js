const {
  default: EInvoice,
  InvoiceType,
  EInvoiceCountry,
  EInvoiceUnitType,
  EInvoiceCurrencyType,
  EInvoiceApiError,
  EInvoiceTypeError
} = require('e-fatura')

const INVOICE_TYPE_MAP = {
  'SATIS': InvoiceType.SATIS,
  'TEVKIFAT': InvoiceType.TEVKIFAT,
  'IADE': InvoiceType.IADE,
  'ISTISNA': InvoiceType.ISTISNA,
  'OZELMATRAH': InvoiceType.OZEL_MATRAH,
  'IHRACKAYITLI': InvoiceType.IHRAC_KAYITLI
}

const UNIT_TYPE_MAP = {
  'C62': EInvoiceUnitType.ADET,
  'DAY': EInvoiceUnitType.GUN,
  'HUR': EInvoiceUnitType.SAAT,
  'KGM': EInvoiceUnitType.KG,
  'LTR': EInvoiceUnitType.LT,
  'MTR': EInvoiceUnitType.METRE,
  'MTK': EInvoiceUnitType.METREKARE,
  'MTQ': EInvoiceUnitType.METREKUP,
  'ADET': EInvoiceUnitType.ADET,
  'PAKET': EInvoiceUnitType.PAKET,
  'KUTU': EInvoiceUnitType.KUTU,
  'TON': EInvoiceUnitType.TON,
  'SAAT': EInvoiceUnitType.SAAT,
  'GUN': EInvoiceUnitType.GUN,
  'AY': EInvoiceUnitType.AY,
  'YIL': EInvoiceUnitType.YIL
}

const CURRENCY_MAP = {
  'TRY': EInvoiceCurrencyType.TURK_LIRASI,
  'USD': EInvoiceCurrencyType.AMERIKAN_DOLARI,
  'EUR': EInvoiceCurrencyType.EURO,
  'GBP': EInvoiceCurrencyType.INGILIZ_STERLINI
}

// Tevkifat kodları ve oranları
const WITHHOLDING_RATES = {
  '601': 70, '602': 50, '603': 70, '604': 50, '605': 50,
  '606': 50, '607': 50, '608': 70, '609': 50, '610': 20,
  '611': 20, '612': 40, '613': 40, '614': 50, '615': 50,
  '616': 90, '617': 20, '618': 20, '619': 20, '620': 20,
  '621': 20, '622': 20, '623': 20, '624': 50, '625': 20,
  '626': 20, '627': 20, '801': 70, '802': 50, '803': 70
};

function convertDate(d) {
  if (!d) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}.${month}.${year}`;
  }
  const [year, month, day] = d.split('-');
  return `${day}.${month}.${year}`; // DD.MM.YYYY
}

function convertTime(t) {
  if (!t) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return t; // HH:mm:ss zaten doğru formatta
}

function mapProducts(products) {
  return products.map(p => {
    const quantity = parseFloat(p.quantity) || 0;
    const unitPrice = parseFloat(p.unitPrice) || 0;
    const vatRate = parseFloat(p.vatRate) || 0;
    const discountRate = parseFloat(p.discountRate) || 0;
    
    // Temel hesaplamalar
    const grossAmount = quantity * unitPrice; // Brüt tutar
    const discountAmount = grossAmount * (discountRate / 100); // İskonto
    const baseAmount = grossAmount - discountAmount; // Matrah (KDV'siz)
    const vatAmount = baseAmount * (vatRate / 100); // KDV tutarı
    const totalAmount = baseAmount + vatAmount; // Toplam (KDV dahil)
    
    // Tevkifat hesaplama
    let withholdingRate = 0;
    let withholdingAmount = 0;
    if (p.withholdingCode && WITHHOLDING_RATES[p.withholdingCode]) {
      withholdingRate = WITHHOLDING_RATES[p.withholdingCode];
      withholdingAmount = vatAmount * (withholdingRate / 100);
    }

    const unitType = UNIT_TYPE_MAP[p.unitType] || EInvoiceUnitType.ADET;
    
    return {
      name: p.name,
      quantity: quantity,
      unitType: unitType,
      unitPrice: unitPrice,
      price: unitPrice,
      vatRate: vatRate,
      vatAmount: vatAmount,
      discountRate: discountRate,
      discountAmount: discountAmount,
      totalAmount: baseAmount, // KDV hariç matrah
      grossAmount: grossAmount,
      netAmount: totalAmount, // KDV dahil
      
      // Tevkifat bilgileri
      withholdingCode: p.withholdingCode || undefined,
      withholdingRate: withholdingRate,
      withholdingAmount: withholdingAmount
    };
  });
}

function buildInvoicePayload(body) {
  console.log('=== buildInvoicePayload BAŞLADI ===');
  console.log('Gelen body:', JSON.stringify(body, null, 2));

  // Ürünleri map et
  const mappedProducts = mapProducts(body.products || []);
  console.log('Mapped products:', mappedProducts);

  // Toplamlar - KDV HARİÇ (matrah)
  const base = mappedProducts.reduce((sum, p) => sum + p.totalAmount, 0);
  const productsTotalPrice = mappedProducts.reduce((sum, p) => sum + p.grossAmount, 0);
  const totalDiscount = mappedProducts.reduce((sum, p) => sum + p.discountAmount, 0);
  const totalVat = mappedProducts.reduce((sum, p) => sum + p.vatAmount, 0);
  
  // Tevkifat toplamları
  const totalWithholding = mappedProducts
    .filter(p => p.withholdingCode)
    .reduce((sum, p) => sum + (p.withholdingAmount || 0), 0);
  
  const withholdingBase = mappedProducts
    .filter(p => p.withholdingCode)
    .reduce((sum, p) => sum + p.totalAmount, 0);

  // Stopaj hesaplama (vergi ekleme bölümünden)
  let stopajAmount = 0;
  const taxTotals = {};
  
  if (body.taxes && body.taxes.length > 0) {
    body.taxes.forEach(tax => {
      if (tax.type === 'V0011') { // KV Stopaj - matrah üzerinden
        const amount = base * (parseFloat(tax.rate) / 100);
        stopajAmount += amount;
        taxTotals['V0011'] = {
          taxType: 'V0011',
          rate: tax.rate,
          amount: amount
        };
      }
      if (tax.type === 'V0003') { // GV Stopaj
        const amount = base * (parseFloat(tax.rate) / 100);
        stopajAmount += amount;
        taxTotals['V0003'] = {
          taxType: 'V0003',
          rate: tax.rate,
          amount: amount
        };
      }
    });
  }

  // Ödenecek tutar = Toplam - Tevkifat - Stopaj
  const paymentPrice = (base + totalVat) - totalWithholding - stopajAmount;
  
  // Vergiler dahil toplam
  const includedTaxesTotalPrice = base + totalVat;

  console.log('Hesaplanan değerler:', {
    base,
    productsTotalPrice,
    totalDiscount,
    totalVat,
    totalWithholding,
    withholdingBase,
    stopajAmount,
    paymentPrice,
    includedTaxesTotalPrice
  });

  // Tarih ve saat
  const date = convertDate(body.date);
  const time = convertTime(body.time);

  // Fatura tipi
  let invoiceType = INVOICE_TYPE_MAP[body.invoiceType] || InvoiceType.SATIS;
  
  // Eğer tevkifat varsa ve tip TEVKIFAT değilse, uyarı ver ama değiştirme
  const hasWithholding = mappedProducts.some(p => p.withholdingCode);
  if (hasWithholding && body.invoiceType !== 'TEVKIFAT') {
    console.warn('UYARI: Tevkifat kodu var ama fatura tipi TEVKIFAT değil!');
  }

  const payload = {
    // UUID - otomatik oluştur veya gelen değeri kullan
    uuid: body.uuid || undefined,
    
    // Tarih/Saat
    date: date,
    time: time,
    
    // Fatura bilgileri
    invoiceType: invoiceType,
    currency: CURRENCY_MAP[body.currency] || EInvoiceCurrencyType.TURK_LIRASI,
    currencyRate: 1,
    country: EInvoiceCountry.TURKIYE,

    // Alıcı bilgileri
    buyerFirstName: body.buyerFirstName || undefined,
    buyerLastName: body.buyerLastName || undefined,
    buyerTitle: body.buyerTitle || undefined,
    buyerTaxId: body.buyerTaxId,
    buyerTaxOffice: body.buyerTaxOffice || undefined,
    buyerEmail: body.buyerEmail || undefined,
    buyerPhoneNumber: body.buyerPhoneNumber || undefined,
    buyerAddress: body.buyerAddress || undefined,
    buyerCity: body.buyerCity || undefined,
    buyerDistrict: body.buyerDistrict || undefined,

    // Ürünler
    products: mappedProducts.map(p => ({
      name: p.name,
      quantity: p.quantity,
      unitType: p.unitType,
      unitPrice: p.unitPrice,
      price: p.price,
      totalAmount: p.totalAmount, // KDV hariç
      vatRate: p.vatRate,
      vatAmount: p.vatAmount,
      discountRate: p.discountRate,
      discountAmount: p.discountAmount
    })),

    // ÖNEMLİ: Toplamlar - base (matrah) 0'dan büyük olmalı!
    base: base, // MATRAH - KDV hariç toplam
    productsTotalPrice: productsTotalPrice, // Brüt toplam
    totalDiscount: totalDiscount,
    totalVat: totalVat,
    includedTaxesTotalPrice: includedTaxesTotalPrice, // KDV dahil toplam
    paymentPrice: paymentPrice, // Ödenecek tutar

    // Tevkifat bilgileri
    withholdingBase: withholdingBase || undefined,
    withholdingAmount: totalWithholding || undefined,
    
    // Not
    note: body.note || undefined,
    
    // Ek alanlar
    orderNumber: body.orderNumber || undefined,
    orderDate: body.orderDate ? convertDate(body.orderDate) : undefined,
    shipmentDate: body.shipmentDate ? convertDate(body.shipmentDate) : undefined,
    shipmentTime: body.shipmentTime || undefined
  };

  // Undefined değerleri temizle
  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) delete payload[key];
  });
  
  // Products içindeki undefined değerleri de temizle
  payload.products.forEach(p => {
    Object.keys(p).forEach(key => {
      if (p[key] === undefined) delete p[key];
    });
  });

  console.log('=== OLUŞTURULAN PAYLOAD ===');
  console.log(JSON.stringify(payload, null, 2));
  console.log('base değeri:', payload.base, 'tipi:', typeof payload.base);

  return payload;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env;

  if (!GIB_USERNAME || !GIB_PASSWORD) {
    return res.status(500).json({
      success: false,
      error: 'GIB credentials not configured'
    });
  }

  const body = req.body;

  console.log('=== YENİ İSTEK ===');
  console.log('Vergi No:', body.buyerTaxId);
  console.log('Ürün sayısı:', body.products?.length);

  // VALIDASYONLAR
  if (!body.buyerTaxId) {
    return res.status(400).json({
      success: false,
      error: 'buyerTaxId (VKN/TCKN) zorunludur'
    });
  }

  if (body.buyerTaxId === '11111111111' || body.buyerTaxId === '11111111110') {
    return res.status(400).json({
      success: false,
      error: 'Test vergi numarası kullanılamaz'
    });
  }

  if (!body.products || body.products.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'En az bir ürün/hizmet eklemelisiniz'
    });
  }

  // Ürün validasyonu
  for (let i = 0; i < body.products.length; i++) {
    const p = body.products[i];
    if (!p.name || !p.unitPrice || p.quantity <= 0) {
      return res.status(400).json({
        success: false,
        error: `Ürün ${i+1}: Ad, birim fiyat ve miktar zorunludur`
      });
    }
  }

  try {
    if (TEST_MODE === 'true') {
      EInvoice.setTestMode(true);
      console.log('TEST MODU');
    }

    await EInvoice.connect({
      username: GIB_USERNAME,
      password: GIB_PASSWORD
    });

    const invoicePayload = buildInvoicePayload(body);
    
    // Son kontrol - base değeri
    if (!invoicePayload.base || invoicePayload.base <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Hesaplama hatası: Matrah (base) 0 veya hesaplanamadı',
        details: {
          products: body.products,
          calculatedBase: invoicePayload.base
        }
      });
    }

    console.log('Fatura oluşturuluyor...');
    const invoiceUUID = await EInvoice.createDraftInvoice(invoicePayload);
    console.log('UUID:', invoiceUUID);

    let signed = false;
    let signResult = null;

    if (body.autoSign) {
      try {
        const methods = Object.keys(EInvoice).filter(k => typeof EInvoice[k] === 'function');
        const signMethod = methods.find(m => 
          m.toLowerCase().includes('sign') || 
          m.toLowerCase().includes('approve')
        );
        
        if (signMethod) {
          console.log('İmzalama metodu:', signMethod);
          signResult = await EInvoice[signMethod]({ uuid: invoiceUUID });
          signed = true;
        }
      } catch (signError) {
        console.error('İmzalama hatası:', signError);
        signResult = { error: signError.message };
      }
    }

    await EInvoice.logout();

    return res.status(200).json({
      success: true,
      message: signed ? 'Fatura oluşturuldu ve imzalandı' : 'Fatura taslak olarak oluşturuldu',
      data: {
        invoiceUUID,
        taxIdUsed: invoicePayload.buyerTaxId,
        base: invoicePayload.base,
        signed,
        signResult
      }
    });

  } catch (error) {
    try { await EInvoice.logout(); } catch (_) {}

    console.error('HATA:', error);

    if (error instanceof EInvoiceApiError) {
      return res.status(400).json({
        success: false,
        error: 'GIB API Hatası',
        message: error.message,
        errorCode: error.errorCode
      });
    }

    if (error instanceof EInvoiceTypeError) {
      return res.status(400).json({
        success: false,
        error: 'Doğrulama Hatası',
        message: error.message
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Sunucu Hatası',
      message: error.message
    });
  }
};
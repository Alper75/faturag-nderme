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
  'MTQ': EInvoiceUnitType.METREKUP
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
  const [year, month, day] = d.split('-');
  return `${day}.${month}.${year}`; // DD.MM.YYYY
}

function convertTime(t) {
  return t; // HH:mm:ss zaten doğru formatta
}

function buildInvoicePayload(body) {
  const products = body.products.map(p => {
    const unitType = UNIT_TYPE_MAP[p.unitType] || EInvoiceUnitType.ADET;
    
    return {
      name: p.name,
      quantity: p.quantity,
      unitType: unitType,
      unitPrice: p.unitPrice,
      price: p.unitPrice,
      totalAmount: p.totalAmount,
      vatRate: p.vatRate,
      vatAmount: p.vatAmount,
      discountRate: p.discountRate || 0,
      discountAmount: p.discountAmount || 0,
      // Tevkifat bilgileri
      withholdingCode: p.withholdingCode,
      withholdingRate: p.withholdingRate || 0,
      withholdingAmount: p.withholdingAmount || 0
    };
  });

  // Toplamlar
  const productsTotalPrice = products.reduce((sum, p) => sum + p.totalAmount, 0);
  const totalDiscount = products.reduce((sum, p) => sum + (p.discountAmount || 0), 0);
  const totalVat = products.reduce((sum, p) => sum + p.vatAmount, 0);
  
  // Tevkifat toplamları
  const withholdingBase = products
    .filter(p => p.withholdingCode)
    .reduce((sum, p) => sum + p.totalAmount, 0);
  const withholdingVat = products
    .filter(p => p.withholdingCode)
    .reduce((sum, p) => sum + (p.withholdingAmount || 0), 0);

  // Stopaj hesaplama (vergi ekleme bölümünden)
  let stopajAmount = 0;
  if (body.taxes && body.taxes.length > 0) {
    body.taxes.forEach(tax => {
      if (tax.type === 'V0011') { // KV Stopaj
        stopajAmount += productsTotalPrice * (tax.rate / 100);
      }
      // GV Stopaj (V0003) için farklı hesaplama gerekebilir
    });
  }

  const grandTotal = productsTotalPrice + totalVat;
  const payableTotal = grandTotal - withholdingVat - stopajAmount;

  return {
    uuid: body.uuid,
    date: convertDate(body.date),
    time: body.time,
    invoiceType: INVOICE_TYPE_MAP[body.invoiceType] || InvoiceType.SATIS,
    currency: CURRENCY_MAP[body.currency] || EInvoiceCurrencyType.TURK_LIRASI,
    currencyRate: 1,
    country: EInvoiceCountry.TURKIYE,

    // Alıcı
    buyerFirstName: body.buyerFirstName,
    buyerLastName: body.buyerLastName,
    buyerTitle: body.buyerTitle,
    buyerTaxId: body.buyerTaxId, // GERÇEK VERGİ NO - 11111111111 DEĞİL!
    buyerTaxOffice: body.buyerTaxOffice,
    buyerEmail: body.buyerEmail,
    buyerAddress: body.buyerAddress,

    // Ürünler
    products,
    productsTotalPrice,
    totalDiscount,
    totalVat,
    
    // Tevkifat
    withholdingBase,
    withholdingVat,
    
    // Stopaj (vergi tablosu olarak eklenecek)
    taxes: body.taxes || [],
    
    // Toplamlar
    grandTotal,
    payableTotal,

    note: body.note
  };
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

  // DEBUG: Gelen veriyi logla
  console.log('=== GELEN VERİ ===');
  console.log('Vergi No:', body.buyerTaxId);
  console.log('Fatura Tipi:', body.invoiceType);
  console.log('Ürün sayısı:', body.products?.length);
  console.log('Vergiler:', body.taxes);

  // VALIDASYONLAR
  if (!body.buyerTaxId) {
    return res.status(400).json({
      success: false,
      error: 'buyerTaxId (VKN/TCKN) zorunludur'
    });
  }

  // TEST VERGİ NO ENGELLEME
  if (body.buyerTaxId === '11111111111' || body.buyerTaxId === '11111111110') {
    return res.status(400).json({
      success: false,
      error: 'Test vergi numarası (11111111111) kullanılamaz. Gerçek VKN/TCKN giriniz.'
    });
  }

  if (!body.products || body.products.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'En az bir ürün/hizmet eklemelisiniz'
    });
  }

  if (!body.buyerFirstName && !body.buyerTitle) {
    return res.status(400).json({
      success: false,
      error: 'Ad veya unvan girilmelidir'
    });
  }

  try {
    if (TEST_MODE === 'true') {
      EInvoice.setTestMode(true);
      console.log('TEST MODU AKTİF');
    }

    await EInvoice.connect({
      username: GIB_USERNAME,
      password: GIB_PASSWORD
    });

    const invoicePayload = buildInvoicePayload(body);
    
    console.log('=== PAYLOAD ===');
    console.log('Vergi No (Payload):', invoicePayload.buyerTaxId);

    const invoiceUUID = await EInvoice.createDraftInvoice(invoicePayload);
    console.log('Taslak oluşturuldu:', invoiceUUID);

    let signed = false;
    let signResult = null;

    if (body.autoSign) {
      try {
        // Paketin imzalama metodunu bul
        const methods = Object.keys(EInvoice).filter(k => typeof EInvoice[k] === 'function');
        console.log('Mevcut metodlar:', methods);
        
        const signMethod = methods.find(m => 
          m.toLowerCase().includes('sign') || 
          m.toLowerCase().includes('approve')
        );
        
        if (signMethod) {
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
        signed,
        signResult,
        withholdingApplied: invoicePayload.withholdingVat > 0,
        stopajApplied: (body.taxes || []).some(t => t.type === 'V0011')
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
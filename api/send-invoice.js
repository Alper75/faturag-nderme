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
  SATIS: InvoiceType.SATIS,
  IADE: InvoiceType.IADE,
  TEVKIFAT: InvoiceType.TEVKIFAT,
  ISTISNA: InvoiceType.ISTISNA,
  OZEL_MATRAH: InvoiceType.OZEL_MATRAH,
  IHRAC_KAYITLI: InvoiceType.IHRAC_KAYITLI
}

const UNIT_TYPE_MAP = {
  ADET: EInvoiceUnitType.ADET,
  PAKET: EInvoiceUnitType.PAKET,
  KUTU: EInvoiceUnitType.KUTU,
  KG: EInvoiceUnitType.KG,
  LT: EInvoiceUnitType.LT,
  TON: EInvoiceUnitType.TON,
  M2: EInvoiceUnitType.M2,
  M3: EInvoiceUnitType.M3,
  SAAT: EInvoiceUnitType.SAAT,
  GUN: EInvoiceUnitType.GUN,
  AY: EInvoiceUnitType.AY,
  YIL: EInvoiceUnitType.YIL
}

const CURRENCY_MAP = {
  TRY: EInvoiceCurrencyType.TURK_LIRASI,
  USD: EInvoiceCurrencyType.AMERIKAN_DOLARI,
  EUR: EInvoiceCurrencyType.EURO,
  GBP: EInvoiceCurrencyType.INGILIZ_STERLINI
}

function mapProducts(products) {
  return products.map((item) => {
    const totalAmount = item.totalAmount || item.quantity * item.unitPrice
    const vatAmount = item.vatAmount !== undefined
      ? item.vatAmount
      : totalAmount * ((item.vatRate || 0) / 100)

    return {
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      price: item.unitPrice,
      unitType: UNIT_TYPE_MAP[item.unitType] || EInvoiceUnitType.ADET,
      totalAmount,
      vatRate: item.vatRate || 0,
      vatAmount
    }
  })
}

// YENİ: HTML date input formatından (YYYY-MM-DD) GIB formatına çevirme
function convertDateToGIBFormat(dateString) {
  if (!dateString) return null;
  
  // HTML input: YYYY-MM-DD -> GIB: DD/MM/YYYY veya DD.MM.YYYY
  const [year, month, day] = dateString.split('-');
  
  // Denenecek formatlar:
  // return `${day}/${month}/${year}`;  // DD/MM/YYYY
  return `${day}.${month}.${year}`;      // DD.MM.YYYY (GIB genelde bunu kullanır)
}

function buildInvoicePayload(body) {
  const products = mapProducts(body.products || [])

  const productsTotalPrice = products.reduce((sum, p) => sum + p.totalAmount, 0)
  const totalVat = products.reduce((sum, p) => sum + (p.vatAmount || 0), 0)
  const paymentPrice = body.paymentPrice || productsTotalPrice + totalVat

  // YENİ: Tarih formatı dönüşümü
  const rawDate = body.date;
  const rawTime = body.time;
  
  // Eğer kullanıcı tarih seçtiyse onu kullan, yoksa bugünü kullan
  const date = rawDate ? convertDateToGIBFormat(rawDate) : formatDate(new Date());
  const time = rawTime || formatTime(new Date());

  return {
    uuid: body.uuid,
    date,           // DD.MM.YYYY formatında
    time,           // HH:mm:ss formatında
    invoiceType: INVOICE_TYPE_MAP[body.invoiceType] || InvoiceType.SATIS,
    currency: CURRENCY_MAP[body.currency] || EInvoiceCurrencyType.TURK_LIRASI,
    currencyRate: body.currencyRate || 1,
    country: EInvoiceCountry.TURKIYE,

    buyerFirstName: body.buyerFirstName,
    buyerLastName: body.buyerLastName,
    buyerTitle: body.buyerTitle,
    buyerTaxId: body.buyerTaxId,
    buyerTaxOffice: body.buyerTaxOffice,
    buyerEmail: body.buyerEmail,
    buyerPhoneNumber: body.buyerPhoneNumber,
    buyerAddress: body.buyerAddress,
    buyerCity: body.buyerCity,
    buyerDistrict: body.buyerDistrict,

    products,
    productsTotalPrice,
    includedTaxesTotalPrice: paymentPrice,
    totalVat,
    paymentPrice,
    base: productsTotalPrice,

    note: body.note,
    orderNumber: body.orderNumber,
    orderDate: body.orderDate ? convertDateToGIBFormat(body.orderDate) : undefined,
    shipmentDate: body.shipmentDate ? convertDateToGIBFormat(body.shipmentDate) : undefined,
    shipmentTime: body.shipmentTime
  }
}

// Yardımcı fonksiyonlar (eğer kullanıcı tarih seçmezse)
function formatDate(d) {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}.${month}.${year}` // DD.MM.YYYY (nokta ile)
}

function formatTime(d) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}` // HH:mm:ss
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    })
  }

  const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env

  if (!GIB_USERNAME || !GIB_PASSWORD) {
    return res.status(500).json({
      success: false,
      error: 'GIB credentials not configured in environment variables.'
    })
  }

  const body = req.body

  if (!body || !body.products || body.products.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request body. products array is required.'
    })
  }

  if (!body.buyerFirstName && !body.buyerTitle) {
    return res.status(400).json({
      success: false,
      error: 'buyerFirstName or buyerTitle is required.'
    })
  }

  if (!body.buyerTaxId) {
    return res.status(400).json({
      success: false,
      error: 'buyerTaxId (TC/Vergi No) is required.'
    })
  }

  try {
    if (TEST_MODE === 'true') {
      EInvoice.setTestMode(true)
    }

    await EInvoice.connect({
      username: GIB_USERNAME,
      password: GIB_PASSWORD
    })

    const invoicePayload = buildInvoicePayload(body)
    
    // Debug: Payload'i konsola yazdir (TEST_MODE'da)
    if (TEST_MODE === 'true') {
      console.log('Invoice Payload:', JSON.stringify(invoicePayload, null, 2));
    }

    const invoiceUUID = await EInvoice.createDraftInvoice(invoicePayload)

    let signResult = null
    if (body.autoSign !== false) {
      signResult = await EInvoice.signDraftInvoice({ uuid: invoiceUUID })
    }

    await EInvoice.logout()

    return res.status(200).json({
      success: true,
      message: 'Fatura başarıyla oluşturuldu.',
      data: {
        invoiceUUID,
        signed: body.autoSign !== false,
        signResult
      }
    })
  } catch (error) {
    try { await EInvoice.logout() } catch (_) {}

    if (error instanceof EInvoiceApiError) {
      return res.status(400).json({
        success: false,
        error: 'GIB API Hatası',
        message: error.message,
        errorCode: error.errorCode,
        // Debug bilgisi
        details: TEST_MODE === 'true' ? error.stack : undefined
      })
    }

    if (error instanceof EInvoiceTypeError) {
      return res.status(400).json({
        success: false,
        error: 'Doğrulama Hatası',
        message: error.message,
        details: TEST_MODE === 'true' ? error.stack : undefined
      })
    }

    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message,
      details: TEST_MODE === 'true' ? error.stack : undefined
    })
  }
}
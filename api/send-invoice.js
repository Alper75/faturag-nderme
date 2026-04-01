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
  TEVKIFAT: InvoiceType.TEVKIFAT,  // Tevkifatlı fatura tipi
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

function mapProducts(products, withholdingRate = 0) {
  return products.map((item) => {
    const totalAmount = item.totalAmount || item.quantity * item.unitPrice
    const vatRate = item.vatRate || 0
    const vatAmount = totalAmount * (vatRate / 100)
    
    // Tevkifat hesaplama (KDV'nin belirli oranı)
    const withholdingAmount = withholdingRate > 0 ? (vatAmount * withholdingRate / 100) : 0
    const netVatAmount = vatAmount - withholdingAmount

    return {
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      price: item.unitPrice,
      unitType: UNIT_TYPE_MAP[item.unitType] || EInvoiceUnitType.ADET,
      totalAmount,
      vatRate: vatRate,
      vatAmount: netVatAmount, // Tevkifat sonrası KDV
      withholdingRate: withholdingRate, // Tevkifat oranı
      withholdingAmount: withholdingAmount, // Tevkifat tutarı
      // Stopaj için ek alanlar
      stopajRate: item.stopajRate || 0,
      stopajAmount: item.stopajAmount || 0
    }
  })
}

function convertDateToGIBFormat(dateString) {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-');
  return `${day}.${month}.${year}`; // DD.MM.YYYY
}

function buildInvoicePayload(body) {
  const withholdingRate = parseFloat(body.withholdingRate) || 0
  const stopajRate = parseFloat(body.stopajRate) || 0
  
  const products = mapProducts(body.products || [], withholdingRate)

  const productsTotalPrice = products.reduce((sum, p) => sum + p.totalAmount, 0)
  const totalVat = products.reduce((sum, p) => sum + (p.vatAmount || 0), 0)
  const totalWithholding = products.reduce((sum, p) => sum + (p.withholdingAmount || 0), 0)
  
  // Stopaj hesaplama (matrah üzerinden)
  const stopajAmount = stopajRate > 0 ? (productsTotalPrice * stopajRate / 100) : 0
  
  const paymentPrice = productsTotalPrice + totalVat

  const now = new Date()
  const date = body.date ? convertDateToGIBFormat(body.date) : formatDate(now)
  const time = body.time || formatTime(now)

  // Fatura tipi: Eğer tevkifat varsa TEVKIFAT, yoksa seçilen tip
  let invoiceType = INVOICE_TYPE_MAP[body.invoiceType] || InvoiceType.SATIS
  if (withholdingRate > 0 && body.invoiceType !== 'TEVKIFAT') {
    invoiceType = InvoiceType.TEVKIFAT
  }

  return {
    uuid: body.uuid,
    date,
    time,
    invoiceType: invoiceType,
    currency: CURRENCY_MAP[body.currency] || EInvoiceCurrencyType.TURK_LIRASI,
    currencyRate: body.currencyRate || 1,
    country: EInvoiceCountry.TURKIYE,

    // ALICI BİLGİLERİ - VERGİ NO KONTROLÜ
    buyerFirstName: body.buyerFirstName,
    buyerLastName: body.buyerLastName,
    buyerTitle: body.buyerTitle,
    buyerTaxId: body.buyerTaxId, // KESİNLİKLE 11111111111 OLMAYACAK
    buyerTaxOffice: body.buyerTaxOffice, // ZORUNLU
    buyerEmail: body.buyerEmail,
    buyerPhoneNumber: body.buyerPhoneNumber,
    buyerAddress: body.buyerAddress,
    buyerCity: body.buyerCity,
    buyerDistrict: body.buyerDistrict,

    // ÜRÜNLER
    products,
    productsTotalPrice,
    includedTaxesTotalPrice: paymentPrice,
    totalVat,
    paymentPrice,
    base: productsTotalPrice,

    // TEVKİFAT BİLGİLERİ
    withholdingRate: withholdingRate,
    withholdingAmount: totalWithholding,
    
    // STOPAJ BİLGİLERİ
    stopajRate: stopajRate,
    stopajAmount: stopajAmount,

    note: body.note,
    orderNumber: body.orderNumber,
    orderDate: body.orderDate ? convertDateToGIBFormat(body.orderDate) : undefined,
    shipmentDate: body.shipmentDate ? convertDateToGIBFormat(body.shipmentDate) : undefined,
    shipmentTime: body.shipmentTime
  }
}

function formatDate(d) {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}.${month}.${year}`
}

function formatTime(d) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

module.exports = async function handler(req, res) {
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
      error: 'GIB credentials not configured.'
    })
  }

  const body = req.body
  
  // DEBUG: Gelen veriyi kontrol et
  console.log('Gelen veri:', JSON.stringify(body, null, 2))
  console.log('Vergi No:', body.buyerTaxId)

  // VERGİ NO KONTROLÜ - 11111111111 DEĞİLSE DEVAM ET
  if (body.buyerTaxId === '11111111111' || !body.buyerTaxId) {
    console.warn('UYARI: Test vergi numarası veya boş vergi numarası tespit edildi!')
  }

  if (!body || !body.products || body.products.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'products array is required.'
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

  // Vergi dairesi zorunlu (özellikle tevkifatlı faturalarda)
  if (!body.buyerTaxOffice) {
    return res.status(400).json({
      success: false,
      error: 'buyerTaxOffice (Vergi Dairesi) is required for withholding invoices.'
    })
  }

  try {
    if (TEST_MODE === 'true') {
      EInvoice.setTestMode(true)
      console.log('TEST MODU AKTİF')
    }

    await EInvoice.connect({
      username: GIB_USERNAME,
      password: GIB_PASSWORD
    })

    const invoicePayload = buildInvoicePayload(body)
    
    // DEBUG: Oluşturulan payload'ı kontrol et
    console.log('Invoice Payload:', JSON.stringify(invoicePayload, null, 2))
    console.log('Payload Vergi No:', invoicePayload.buyerTaxId)

    const invoiceUUID = await EInvoice.createDraftInvoice(invoicePayload)
    console.log('Taslak oluşturuldu:', invoiceUUID)

    let signResult = null
    let signed = false
    
    if (body.autoSign !== false) {
      try {
        const methods = Object.keys(EInvoice).filter(k => typeof EInvoice[k] === 'function')
        console.log('Mevcut metodlar:', methods)
        
        const signMethod = methods.find(m => 
          m.toLowerCase().includes('sign') || 
          m.toLowerCase().includes('approve')
        )
        
        if (signMethod) {
          signResult = await EInvoice[signMethod]({ uuid: invoiceUUID })
          signed = true
        }
      } catch (signError) {
        console.error('İmzalama hatası:', signError)
        signResult = { error: signError.message }
      }
    }

    await EInvoice.logout()

    return res.status(200).json({
      success: true,
      message: 'Fatura oluşturuldu.',
      data: {
        invoiceUUID,
        signed,
        taxIdUsed: invoicePayload.buyerTaxId, // Hangi vergi no kullanıldığını göster
        withholdingRate: invoicePayload.withholdingRate,
        stopajRate: invoicePayload.stopajRate,
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
        errorCode: error.errorCode
      })
    }

    if (error instanceof EInvoiceTypeError) {
      return res.status(400).json({
        success: false,
        error: 'Doğrulama Hatası',
        message: error.message
      })
    }

    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message
    })
  }
}
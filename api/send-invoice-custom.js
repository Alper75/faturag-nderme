/**
 * api/send-invoice-custom.js
 * Kendi kütüphanemizi kullanan fatura gönderim API'si
 */

const { GibClient, Invoice, InvoiceItem } = require('../lib');

module.exports = async function handler(req, res) {
  // CORS ayarları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env;

  // Validasyon
  if (!GIB_USERNAME || !GIB_PASSWORD) {
    return res.status(500).json({ 
      success: false, 
      error: 'GIB_USERNAME / GIB_PASSWORD tanımlı değil' 
    });
  }

  const body = req.body;

  // Zorunlu alan kontrolü
  if (!body.buyerTaxId) {
    return res.status(400).json({ success: false, error: 'buyerTaxId zorunludur' });
  }

  if (['11111111111', '11111111110'].includes(body.buyerTaxId)) {
    return res.status(400).json({ success: false, error: 'Test vergi numarası kullanılamaz' });
  }

  if (!body.products?.length) {
    return res.status(400).json({ success: false, error: 'En az bir ürün ekleyiniz' });
  }

  try {
    // 1. Fatura modeli oluştur
    const invoice = new Invoice({
      date: body.date,
      time: body.time,
      type: body.invoiceType,
      currency: body.currency,
      buyerTaxId: body.buyerTaxId,
      buyerTitle: body.buyerTitle,
      buyerFirstName: body.buyerFirstName,
      buyerLastName: body.buyerLastName,
      buyerTaxOffice: body.buyerTaxOffice,
      buyerAddress: body.buyerAddress,
      country: body.country,
      note: body.note,
      orderNumber: body.orderNumber,
      orderDate: body.orderDate,
      waybillNumber: body.waybillNumber,
      waybillDate: body.waybillDate
    });

    // 2. Ürün kalemlerini ekle
    for (const product of body.products) {
      const item = new InvoiceItem({
        name: product.name,
        quantity: product.quantity,
        unit: product.unitType,
        unitPrice: product.unitPrice,
        vatRate: product.vatRate,
        discountRate: product.discountRate,
        withholdingCode: product.withholdingCode
      });

      // Ürün bazlı stopaj varsa ekle
      if (body.taxes && body.taxes.length > 0) {
        body.taxes.forEach(tax => {
          if (tax.type === 'V0011' || tax.type === 'V0003') {
            item.addStopaj(tax.type, parseFloat(tax.rate));
          }
        });
      }

      invoice.addItem(item);
    }

    // 3. Fatura geneli stopajlar (eğer ürün bazlı değilse)
    if (body.taxes && body.taxes.length > 0) {
      body.taxes.forEach(tax => {
        if (tax.type === 'V0011' || tax.type === 'V0003') {
          invoice.addInvoiceTax(tax.type, parseFloat(tax.rate));
        }
      });
    }

    // 4. GİB JSON'ını oluştur
    const gibJSON = invoice.toGibJSON();

    // Debug: JSON'ı logla (test modunda)
    if (TEST_MODE === 'true') {
      console.log('[DEBUG] GİB JSON:', JSON.stringify(gibJSON, null, 2));
    }

    // 5. GİB'e bağlan ve gönder
    const client = new GibClient({
      test: TEST_MODE === 'true'
    });

    if (TEST_MODE === 'true') {
      client.setTestCredentials();
    } else {
      client.setCredentials(GIB_USERNAME, GIB_PASSWORD);
    }

    // Login
    await client.login();

    // Faturayı gönder
    const result = await client.sendInvoice(gibJSON);

    // Logout
    await client.logout();

    // Başarılı yanıt
    if (result.success) {
      const totals = invoice.calculateTotals();
      
      return res.status(200).json({
        success: true,
        message: 'Fatura başarıyla oluşturuldu',
        data: {
          invoiceUUID: invoice.uuid,
          taxIdUsed: body.buyerTaxId,
          invoiceType: invoice.type,
          totals: {
            matrah: totals.netTotal,
            kdv: totals.totalVAT,
            kdvTevkifat: totals.totalWithholding,
            stopaj: totals.totalStopaj,
            vergilerDahil: totals.grandTotal,
            odenecek: totals.payable
          }
        }
      });
    } else {
      throw new Error('Fatura oluşturulamadı');
    }

  } catch (error) {
    console.error('[send-invoice-custom] HATA:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Fatura oluşturma hatası',
      message: error.message,
      // Test modunda detaylı hata
      debug: TEST_MODE === 'true' ? {
        stack: error.stack
      } : undefined
    });
  }
};
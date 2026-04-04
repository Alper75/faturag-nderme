const InvoiceItem = require('./InvoiceItem');
const { round } = require('../utils/calculations');
const { toGibDate, toGibTime, toGibAmount } = require('../utils/formatters');
const { v4: uuidv4 } = require('uuid');

class Invoice {
  constructor(data = {}) {
    this.uuid = data.uuid || uuidv4();
    this.documentNumber = data.documentNumber || '';
    
    // Tarih/Saat
    this.date = data.date || new Date().toISOString().split('T')[0];
    this.time = data.time || new Date().toTimeString().slice(0, 8);
    
    // Para birimi
    this.currency = data.currency || 'TRY';
    this.exchangeRate = data.exchangeRate || 0;
    
    // Fatura tipi
    this.type = data.type || 'SATIS';
    
    // Alıcı bilgileri
    this.buyer = {
      taxId: data.buyerTaxId || '',
      title: data.buyerTitle || '',
      firstName: data.buyerFirstName || '',
      lastName: data.buyerLastName || '',
      taxOffice: data.buyerTaxOffice || '',
      address: data.buyerAddress || '',
      country: data.country || 'Türkiye'
    };
    
    // Notlar
    this.note = data.note || '';
    
    // Sipariş bilgileri
    this.orderNumber = data.orderNumber || '';
    this.orderDate = data.orderDate || '';
    
    // İrsaliye bilgileri
    this.waybillNumber = data.waybillNumber || '';
    this.waybillDate = data.waybillDate || '';
    
    // Kalemler
    this.items = [];
    
    // Fatura geneli stopajlar
    this.invoiceTaxes = [];
  }

  // Kalem ekle
  addItem(itemData) {
    const item = itemData instanceof InvoiceItem ? itemData : new InvoiceItem(itemData);
    this.items.push(item);
    return this;
  }

  // Fatura geneli stopaj ekle (tüm kalemlere uygulanır)
  addInvoiceTax(type, rate) {
    this.invoiceTaxes.push({ type, rate });
    return this;
  }

  // Toplamları hesapla
  calculateTotals() {
    let grossTotal = 0;
    let totalDiscount = 0;
    let netTotal = 0;
    let totalVAT = 0;
    let totalWithholding = 0;
    let withholdingBase = 0;
    let withholdingVAT = 0;

    // Her kalem için
    this.items.forEach(item => {
      grossTotal += item.grossAmount;
      totalDiscount += item.discountAmount;
      netTotal += item.netAmount;
      totalVAT += item.vatAmount;
      
      // KDV Tevkifatı
      if (item.withholdingAmount > 0) {
        totalWithholding += item.withholdingAmount;
        withholdingBase += item.netAmount;
        withholdingVAT += item.vatAmount;
      }
    });

    // Stopaj toplamları
    let totalStopajV0011 = 0;
    let totalStopajV0003 = 0;

    // Ürün bazlı stopajları topla
    this.items.forEach(item => {
      item.taxes.forEach(tax => {
        if (tax.vergiKodu === '0015') totalStopajV0011 += parseFloat(tax.vergiTutari);
        if (tax.vergiKodu === '0003') totalStopajV0003 += parseFloat(tax.vergiTutari);
      });
    });

    // Fatura geneli stopajları hesapla ve ekle
    this.invoiceTaxes.forEach(tax => {
      const amount = round(netTotal * (tax.rate / 100));
      if (tax.type === 'V0011') {
        totalStopajV0011 += amount;
      } else if (tax.type === 'V0003') {
        totalStopajV0003 += amount;
      }
    });

    const totalStopaj = round(totalStopajV0011 + totalStopajV0003);
    const totalTaxes = round(totalVAT);
    const grandTotal = round(netTotal + totalVAT);
    const payable = round(grandTotal - totalWithholding - totalStopaj);

    // Fatura tipi otomatik ayarla
    if (totalWithholding > 0 && this.type === 'SATIS') {
      this.type = 'TEVKIFAT';
    }

    return {
      grossTotal: round(grossTotal),
      totalDiscount: round(totalDiscount),
      netTotal: round(netTotal),
      totalVAT: round(totalVAT),
      totalWithholding: round(totalWithholding),
      withholdingBase: round(withholdingBase),
      withholdingVAT: round(withholdingVAT),
      totalStopajV0011: round(totalStopajV0011),
      totalStopajV0003: round(totalStopajV0003),
      totalStopaj: round(totalStopaj),
      totalTaxes,
      grandTotal,
      payable
    };
  }

  // GİB JSON formatına dönüştür
  toGibJSON() {
    const totals = this.calculateTotals();

    const jp = {
      faturaUuid: this.uuid,
      belgeNumarasi: this.documentNumber,
      faturaTarihi: toGibDate(this.date),
      saat: toGibTime(this.time),
      paraBirimi: this.currency,
      dovzTLkur: this.exchangeRate.toString(),
      faturaTipi: this.type,
      
      // Alıcı
      vknTckn: this.buyer.taxId,
      aliciUnvan: this.buyer.title,
      aliciAdi: this.buyer.firstName,
      aliciSoyadi: this.buyer.lastName,
      vergiDairesi: this.buyer.taxOffice,
      bulvarcaddesokak: this.buyer.address,
      mahalleSemtIlce: '',
      sehir: '',
      ulke: this.buyer.country,
      
      // Toplamlar
      matrah: totals.netTotal,
      malHizmetToplamTutari: totals.grossTotal,
      toplamIskonto: totals.totalDiscount,
      hesaplanankdv: totals.totalVAT,
      vergilerToplami: totals.totalTaxes,
      vergilerDahilToplamTutar: totals.grandTotal,
      odenecekTutar: totals.payable,
      
      // Not
      not: this.note,
      
      // Sipariş
      siparisNumarasi: this.orderNumber,
      siparisTarihi: toGibDate(this.orderDate),
      
      // İrsaliye
      irsaliyeNumarasi: this.waybillNumber,
      irsaliyeTarihi: toGibDate(this.waybillDate),
      
      // Boş alanlar
      fisNo: '',
      fisTarihi: '',
      fisSaati: '',
      fisTipi: '',
      zRaporNo: '',
      okcSeriNo: '',
      
      // Kalemler
      malHizmetTable: this.items.map(item => item.toGibJSON())
    };

    // KDV Tevkifatı (fatura geneli)
    if (totals.totalWithholding > 0) {
      jp.hesaplananV9015 = totals.totalWithholding;
      jp.tevkifataTabiIslemTutar = totals.withholdingBase;
      jp.tevkifataTabiIslemKdv = totals.withholdingVAT;
    }

    // Stopajlar (fatura geneli)
    const vergiTable = [];
    
    if (totals.totalStopajV0011 > 0) {
      jp.hesaplananV0011 = totals.totalStopajV0011;
      vergiTable.push({
        vergiKodu: '0015',
        vergiTutari: toGibAmount(totals.totalStopajV0011)
      });
    }
    
    if (totals.totalStopajV0003 > 0) {
      jp.hesaplananV0003 = totals.totalStopajV0003;
      vergiTable.push({
        vergiKodu: '0003',
        vergiTutari: toGibAmount(totals.totalStopajV0003)
      });
    }
    
    if (vergiTable.length > 0) {
      jp.vergiTable = vergiTable;
    }

    return jp;
  }
}

module.exports = Invoice;
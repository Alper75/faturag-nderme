const { round, calculateVAT, calculateDiscount, calculateStopaj, calculateWithholding } = require('../utils/calculations');
const { TAX_CODES, UNIT_CODES, toGibAmount } = require('../utils/formatters');

class InvoiceItem {
  constructor(data = {}) {
    this.name = data.name || '';
    this.quantity = parseFloat(data.quantity) || 1;
    this.unit = UNIT_CODES[data.unit] || 'C62';
    this.unitPrice = parseFloat(data.unitPrice) || 0;
    this.vatRate = parseFloat(data.vatRate) || 20;
    this.discountRate = parseFloat(data.discountRate) || 0;
    this.withholdingCode = data.withholdingCode ? parseInt(data.withholdingCode) : null;
    
    // Hesaplanan değerler
    this._calculate();
  }

  _calculate() {
    // Brüt tutar
    this.grossAmount = round(this.quantity * this.unitPrice);
    
    // İskonto
    this.discountAmount = calculateDiscount(this.grossAmount, this.discountRate);
    
    // Net tutar (matrah)
    this.netAmount = round(this.grossAmount - this.discountAmount);
    
    // KDV
    this.vatAmount = calculateVAT(this.netAmount, this.vatRate);
    
    // KDV Tevkifatı
    this.withholdingAmount = 0;
    this.withholdingRate = 0;
    
    if (this.withholdingCode && TAX_CODES.WITHHOLDING[this.withholdingCode]) {
      this.withholdingRate = TAX_CODES.WITHHOLDING[this.withholdingCode].rate;
      this.withholdingAmount = calculateWithholding(this.vatAmount, this.withholdingRate);
    }
    
    // Stopajlar (ürün bazlı)
    this.taxes = [];
    this.totalStopaj = 0;
  }

  // Stopaj ekle
  addStopaj(type, rate) {
    const stopajInfo = TAX_CODES.STOPAJ[type];
    if (!stopajInfo) return this;
    
    const amount = calculateStopaj(this.netAmount, rate);
    
    this.taxes.push({
      vergiKodu: stopajInfo.code,
      vergiTutari: toGibAmount(amount),
      vergiOrani: rate.toString()
    });
    
    this.totalStopaj += amount;
    return this;
  }

  // GİB formatına dönüştür
  toGibJSON() {
    const row = {
      malHizmet: this.name,
      miktar: this.quantity,
      birim: this.unit,
      birimFiyat: this.unitPrice,
      fiyat: this.grossAmount,
      iskontoOrani: this.discountRate,
      iskontoTutari: this.discountAmount,
      iskontoNedeni: '',
      malHizmetTutari: this.netAmount,
      kdvOrani: this.vatRate,
      kdvTutari: this.vatAmount,
      vergininKdvTutari: "0"
    };

    // KDV Tevkifatı
    if (this.withholdingCode && this.withholdingAmount > 0) {
      row.tevkifatKodu = this.withholdingCode.toString();
      row.tevkifatOrani = this.withholdingRate.toString();
      row.tevkifatTutari = this.withholdingAmount;
    }

    // Vergi tablosu (stopajlar)
    if (this.taxes.length > 0) {
      row.vergiTable = this.taxes;
    }

    return row;
  }
}

module.exports = InvoiceItem;
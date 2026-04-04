/**
 * Yuvarlama fonksiyonu (2 ondalık)
 */
function round(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * KDV hesapla
 */
function calculateVAT(netAmount, vatRate) {
  return round(netAmount * (vatRate / 100));
}

/**
 * İskonto hesapla
 */
function calculateDiscount(grossAmount, discountRate) {
  return round(grossAmount * (discountRate / 100));
}

/**
 * Stopaj hesapla
 */
function calculateStopaj(netAmount, stopajRate) {
  return round(netAmount * (stopajRate / 100));
}

/**
 * KDV Tevkifatı hesapla
 */
function calculateWithholding(vatAmount, withholdingRate) {
  return round(vatAmount * (withholdingRate / 100));
}

module.exports = {
  round,
  calculateVAT,
  calculateDiscount,
  calculateStopaj,
  calculateWithholding
};
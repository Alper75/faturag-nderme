/**
 * Tarih formatını GİB formatına çevir (DD/MM/YYYY)
 */
function toGibDate(dateStr) {
  if (!dateStr) return undefined;
  if (dateStr.includes('/')) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Saat formatını GİB formatına çevir (HH:MM:SS)
 */
function toGibTime(timeStr) {
  if (!timeStr) {
    const now = new Date();
    return now.toTimeString().slice(0, 8);
  }
  if (timeStr.length === 5) return timeStr + ':00'; // HH:MM -> HH:MM:SS
  return timeStr;
}

/**
 * Para birimini formatla (string olarak)
 */
function toGibAmount(amount) {
  return amount.toFixed(2);
}

/**
 * Vergi kodu dönüştürücü
 */
const TAX_CODES = {
  // KDV Tevkifat kodları
  WITHHOLDING: {
    601: { rate: 70, name: 'Yapım İşleri' },
    602: { rate: 50, name: 'Danışmanlık' },
    603: { rate: 70, name: 'Makine Bakım' },
    604: { rate: 50, name: 'Yemek Servis' },
    605: { rate: 50, name: 'İşgücü Temin' },
    606: { rate: 50, name: 'Yapı Denetim' },
    607: { rate: 50, name: 'Fason Tekstil' },
    608: { rate: 70, name: 'Turistik Mağaza' },
    609: { rate: 50, name: 'Spor Kulübü' },
    610: { rate: 20, name: 'Temizlik' },
    611: { rate: 20, name: 'Bahçe Bakım' },
    612: { rate: 40, name: 'Servis Taşımacılık' },
    613: { rate: 40, name: 'Baskı/Basım' },
    614: { rate: 50, name: 'Külçe Metal' },
    615: { rate: 50, name: 'Bakır/Demir/Çinko' },
    616: { rate: 90, name: 'Hurda ve Atık' },
    617: { rate: 20, name: 'Plastik Hurda' },
    618: { rate: 20, name: 'Pamuk/Yün' },
    619: { rate: 20, name: 'Ağaç Ürünleri' },
    620: { rate: 20, name: 'Yük Taşımacılık' },
    622: { rate: 20, name: 'Güvenlik' },
    623: { rate: 20, name: 'Fuar/Sergi' },
    624: { rate: 50, name: 'Depolama' },
    625: { rate: 30, name: 'Ticari Reklam' },
    626: { rate: 20, name: 'Tekstil Teslim' },
    627: { rate: 20, name: 'Diğer Hizmetler' },
    801: { rate: 70, name: 'Yapım İşleri (Kamu)' },
    802: { rate: 50, name: 'Danışmanlık (Kamu)' },
    803: { rate: 70, name: 'Makine Bakım (Kamu)' }
  },
  // Stopaj kodları
  STOPAJ: {
    V0011: { code: '0015', name: 'KV Stopaj' },  // Kurumlar Vergisi
    V0003: { code: '0003', name: 'GV Stopaj' }   // Gelir Vergisi
  }
};

/**
 * Birim kodları
 */
const UNIT_CODES = {
  C62: 'C62',   // Adet
  HUR: 'HUR',   // Saat
  DAY: 'DAY',   // Gün
  MON: 'MON',   // Ay
  KGM: 'KGM',   // Kg
  LTR: 'LTR',   // Litre
  MTR: 'MTR',   // Metre
  MTK: 'MTK',   // m²
  MTQ: 'MTQ',   // m³
  PA: 'PA',     // Paket
  BX: 'BX'      // Kutu
};

module.exports = {
  toGibDate,
  toGibTime,
  toGibAmount,
  TAX_CODES,
  UNIT_CODES
};
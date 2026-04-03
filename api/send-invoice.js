/**
 * send-invoice.js — E-Arşiv Fatura API
 */
const Fatura = require('./Fatura');

// ─── Sabitler ─────────────────────────────────────────────────────────────────

const INVOICE_TYPES = {
    'SATIS': 'SATIS',
    'TEVKIFAT': 'TEVKIFAT',
    'IADE': 'IADE',
    'ISTISNA': 'ISTISNA',
    'OZELMATRAH': 'OZELMATRAH',
    'IHRACKAYITLI': 'IHRACKAYITLI'
};

const UNIT_TYPES = {
    'C62': 'C62', 'DAY': 'DAY', 'HUR': 'HUR', 'KGM': 'KGM',
    'LTR': 'LTR', 'MTR': 'MTR', 'MTK': 'MTK', 'MTQ': 'MTQ',
    'ADET': 'C62', 'PAKET': 'PA', 'KUTU': 'BX',
    'KG': 'KGM', 'LT': 'LTR', 'TON': 'TNE',
    'SAAT': 'HUR', 'GUN': 'DAY', 'AY': 'MON', 'YIL': 'ANN'
};

const CURRENCIES = { 'TRY': 'TRY', 'USD': 'USD', 'EUR': 'EUR', 'GBP': 'GBP' };

const WITHHOLDING_RATES = {
    '601': 70, '602': 50, '603': 70, '604': 50, '605': 50,
    '606': 50, '607': 50, '608': 70, '609': 50, '610': 20,
    '611': 20, '612': 40, '613': 40, '614': 50, '615': 50,
    '616': 90, '617': 20, '618': 20, '619': 20, '620': 20,
    '621': 20, '622': 20, '623': 20, '624': 50, '625': 30,
    '626': 20, '627': 20, '801': 70, '802': 50, '803': 70
};

const WITHHOLDING_NAMES = {
    '601': 'Yapım İşleri [KDVGUT-(I/C-2.1.3.2.1)]',
    '602': 'Etüt, Plan-Proje, Danışmanlık [KDVGUT-(I/C-2.1.3.2.2)]',
    '603': 'Makine, Teçhizat Tadil, Bakım [KDVGUT-(I/C-2.1.3.2.3)]',
    '604': 'Yemek Servis [KDVGUT-(I/C-2.1.3.2.4)]',
    '605': 'İşgücü Temin [KDVGUT-(I/C-2.1.3.2.5)]',
    '606': 'Yapı Denetim [KDVGUT-(I/C-2.1.3.2.6)]',
    '607': 'Fason Tekstil [KDVGUT-(I/C-2.1.3.2.7)]',
    '608': 'Turistik Mağaza [KDVGUT-(I/C-2.1.3.2.8)]',
    '609': 'Spor Kulübü [KDVGUT-(I/C-2.1.3.2.9)]',
    '610': 'Temizlik [KDVGUT-(I/C-2.1.3.2.10)]',
    '611': 'Bahçe Bakım [KDVGUT-(I/C-2.1.3.2.11)]',
    '612': 'Servis Taşımacılık [KDVGUT-(I/C-2.1.3.2.12)]',
    '613': 'Baskı/Basım [KDVGUT-(I/C-2.1.3.2.13)]',
    '614': 'Külçe Metal [KDVGUT-(I/C-2.1.3.3.1)]',
    '615': 'Bakır/Çinko/Demir [KDVGUT-(I/C-2.1.3.3.2)]',
    '616': 'Hurda ve Atık [KDVGUT-(I/C-2.1.3.3.3)]',
    '617': 'Plastik/Metal Hurda [KDVGUT-(I/C-2.1.3.3.3)]',
    '618': 'Pamuk/Yün [KDVGUT-(I/C-2.1.3.3.4)]',
    '619': 'Ağaç Ürünleri [KDVGUT-(I/C-2.1.3.3.5)]',
    '620': 'Yük Taşımacılığı [KDVGUT-(I/C-2.1.3.2.14)]',
    '621': 'Ticari Reklam (Kısmi) [KDVGUT-(I/C-2.1.3.2.15)]',
    '622': 'Güvenlik [KDVGUT-(I/C-2.1.3.2.16)]',
    '623': 'Fuar/Sergi [KDVGUT-(I/C-2.1.3.2.17)]',
    '624': 'Depolama [KDVGUT-(I/C-2.1.3.2.18)]',
    '625': 'Ticari Reklam [KDVGUT-(I/C-2.1.3.2.15)]',
    '626': 'Tekstil Teslim [KDVGUT-(I/C-2.1.3.3.6)]',
    '627': 'Diğer Hizmetler [KDVGUT-(I/C-2.1.3.2.22)]',
    '801': 'Ticari Reklam (Stopaj Dahil)',
    '802': 'Yapım İşleri (Stopaj Dahil)',
    '803': 'Makine Onarım (Stopaj Dahil)'
};

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function formatDate(d) {
    if (!d) {
        const now = new Date();
        return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    }
    const [year, month, day] = d.split('-');
    return `${day}/${month}/${year}`;
}

function formatTime(t) {
    return t || new Date().toTimeString().slice(0, 8);
}

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Güvenli loglama - circular reference yok
function safeLog(label, obj) {
    try {
        console.log(label, JSON.stringify(obj, null, 2));
    } catch (e) {
        console.log(label, '[Circular structure]', typeof obj, Object.keys(obj || {}));
    }
}

// ─── Ana fatura veri oluşturma ─────────────────────────────────────────────────

function buildInvoiceData(body) {
    console.log('=== buildInvoiceData başladı ===');

    // ── Ürün satırları ──────────────────────────────────────────────────────────
    const malHizmetTable = body.products.map((p, index) => {
        const miktar = parseFloat(p.quantity) || 0;
        const birimFiyat = parseFloat(p.unitPrice) || 0;
        const kdvOrani = parseFloat(p.vatRate) || 0;
        const iskontoOrani = parseFloat(p.discountRate) || 0;

        const malHizmetTutari = round2(miktar * birimFiyat);
        const iskontoTutari = round2(malHizmetTutari * (iskontoOrani / 100));
        const netTutar = round2(malHizmetTutari - iskontoTutari);
        const kdvTutari = round2(netTutar * (kdvOrani / 100));

        const tevkifatKodu = p.withholdingCode || '';
        let tevkifatOrani = 0;
        let tevkifatTutari = 0;

        if (tevkifatKodu && WITHHOLDING_RATES[tevkifatKodu]) {
            tevkifatOrani = WITHHOLDING_RATES[tevkifatKodu];
            tevkifatTutari = round2(kdvTutari * (tevkifatOrani / 100));
        }

        return {
            siraNo: index + 1,
            malHizmet: p.name,
            miktar,
            birim: UNIT_TYPES[p.unitType] || 'C62',
            birimFiyat,
            malHizmetTutari,
            iskontoArttm: 'Iskonto',
            iskontoOrani,
            iskontoTutari,
            iskontoNedeni: '',
            fiyat: netTutar,
            kdvOrani,
            kdvTutari,
            tevkifatKodu,
            _tevkifatOrani: tevkifatOrani,
            _tevkifatTutari: tevkifatTutari,
            gtip: '',
            ozelMatrahNedeni: 0,
            ozelMatrahTutari: 0,
            tevkifatKodu_v9015: tevkifatKodu ? parseInt(tevkifatKodu) : 0
        };
    });

    // ── Genel toplamlar ─────────────────────────────────────────────────────────
    const matrah = round2(malHizmetTable.reduce((s, p) => s + p.fiyat, 0));
    const toplamIskonto = round2(malHizmetTable.reduce((s, p) => s + p.iskontoTutari, 0));
    const hesaplananKDV = round2(malHizmetTable.reduce((s, p) => s + p.kdvTutari, 0));

    const hesaplananV9015 = round2(
        malHizmetTable
            .filter(p => p.tevkifatKodu)
            .reduce((s, p) => s + p._tevkifatTutari, 0)
    );

    let hesaplananV0011 = 0;
    let stopajList = [];

    if (body.taxes && body.taxes.length > 0) {
        body.taxes.forEach(tax => {
            const stopajTutar = round2(matrah * (parseFloat(tax.rate) / 100));
            if (tax.type === 'V0011') {
                hesaplananV0011 += stopajTutar;
                stopajList.push({
                    kod: '0011',
                    ad: 'KV. STOPAJI',
                    oran: parseFloat(tax.rate),
                    tutar: stopajTutar
                });
            } else if (tax.type === 'V0003') {
                hesaplananV0011 += stopajTutar;
                stopajList.push({
                    kod: '0003',
                    ad: 'GV. STOPAJI',
                    oran: parseFloat(tax.rate),
                    tutar: stopajTutar
                });
            }
        });
        hesaplananV0011 = round2(hesaplananV0011);
    }

    const vergilerDahilToplam = round2(matrah + hesaplananKDV);
    const odenecekTutar = round2(vergilerDahilToplam - hesaplananV9015 - hesaplananV0011);

    // ── vergiTable ────────────────────────────────────────────────────────────
    const vergiTable = [];

    if (hesaplananV9015 > 0 && malHizmetTable.some(p => p.tevkifatKodu)) {
        const firstWh = malHizmetTable.find(p => p.tevkifatKodu);
        vergiTable.push({
            vergiKodu: 'V9015',
            vergiAdi: WITHHOLDING_NAMES[firstWh.tevkifatKodu] || 'KDV Tevkifatı',
            vergiTutari: hesaplananV9015,
            tevkifatOrani: firstWh._tevkifatOrani,
            tevkifatKodu: firstWh.tevkifatKodu
        });
    }

    stopajList.forEach(s => {
        vergiTable.push({
            vergiKodu: `V${s.kod}`,
            vergiAdi: s.ad,
            vergiTutari: s.tutar,
            stopajOrani: s.oran
        });
    });

    // ── Fatura nesnesi ──────────────────────────────────────────────────────────
    const invoiceData = {
        faturaUuid: body.uuid || undefined,
        belgeNumarasi: '',
        faturaTarihi: formatDate(body.date),
        saat: formatTime(body.time),
        paraBirimi: CURRENCIES[body.currency] || 'TRY',
        dovzTLkur: (body.currency && body.currency !== 'TRY') ? (body.currencyRate || '1') : '0',
        faturaTipi: INVOICE_TYPES[body.invoiceType] || 'SATIS',

        vknTckn: body.buyerTaxId,
        aliciUnvan: body.buyerTitle || '',
        aliciAdi: body.buyerFirstName || '',
        aliciSoyadi: body.buyerLastName || '',
        vergiDairesi: body.buyerTaxOffice || '',
        ulke: body.country || 'Türkiye',
        bulvarcaddesokak: body.buyerAddress || '',
        mahalleSemtIlce: '',
        sehir: '',

        malHizmetTable: malHizmetTable.map(p => ({
            malHizmet: p.malHizmet,
            miktar: p.miktar,
            birim: p.birim,
            birimFiyat: p.birimFiyat,
            kdvOrani: p.kdvOrani,
            fiyat: p.fiyat,
            iskontoArttm: p.iskontoArttm,
            iskontoOrani: p.iskontoOrani,
            iskontoTutari: p.iskontoTutari,
            iskontoNedeni: p.iskontoNedeni,
            malHizmetTutari: p.malHizmetTutari,
            kdvTutari: p.kdvTutari,
            tevkifatKodu: p.tevkifatKodu_v9015 || 0,
            ozelMatrahNedeni: 0,
            ozelMatrahTutari: 0,
            gtip: ''
        })),

        vergiTable,

        matrah,
        malhizmetToplamTutari: matrah,
        toplamIskonto,
        hesaplanankdv: hesaplananKDV,
        tevkifataTabiIslemTutar: round2(malHizmetTable.filter(p => p.tevkifatKodu).reduce((s, p) => s + p.fiyat, 0)),
        tevkifataTabiIslemKdv: round2(malHizmetTable.filter(p => p.tevkifatKodu).reduce((s, p) => s + p.kdvTutari, 0)),
        hesaplananV9015,
        hesaplananV0011,
        vergilerToplami: hesaplananKDV,
        vergilerDahilToplamTutar: vergilerDahilToplam,
        toplamMasraflar: 0,
        odenecekTutar,

        irsaliyeNumarasi: body.waybillNumber || '',
        irsaliyeTarihi: body.waybillDate ? formatDate(body.waybillDate) : '',

        siparisNumarasi: body.orderNumber || '',
        siparisTarihi: body.orderDate ? formatDate(body.orderDate) : '',

        not: body.note || '',

        iadeTable: [],
        hangiTip: '5000/30000'
    };

    // ✅ Güvenli log
    console.log('Fatura verisi hazırlandı:', {
        faturaTipi: invoiceData.faturaTipi,
        matrah: invoiceData.matrah,
        hesaplananKDV: invoiceData.hesaplanankdv,
        odenecekTutar: invoiceData.odenecekTutar,
        urunSayisi: invoiceData.malHizmetTable.length
    });

    return invoiceData;
}

// ─── Vercel Handler ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { GIB_USERNAME, GIB_PASSWORD, TEST_MODE } = process.env;

    if (!GIB_USERNAME || !GIB_PASSWORD) {
        return res.status(500).json({
            success: false,
            error: 'GIB kimlik bilgileri yapılandırılmamış (GIB_USERNAME / GIB_PASSWORD)'
        });
    }

    const body = req.body;
    safeLog('İstek geldi:', body);

    // ── Validasyon ────────────────────────────────────────────────────────────
    if (!body.buyerTaxId) {
        return res.status(400).json({ success: false, error: 'VKN/TCKN zorunludur' });
    }
    if (body.buyerTaxId === '11111111111' || body.buyerTaxId === '11111111110') {
        return res.status(400).json({
            success: false,
            error: 'Test VKN/TCKN kullanılamaz. Gerçek vergi numarası giriniz.'
        });
    }
    if (!body.products || body.products.length === 0) {
        return res.status(400).json({ success: false, error: 'En az bir ürün/hizmet ekleyiniz' });
    }

    // ── İşlem ─────────────────────────────────────────────────────────────────
    const fatura = new Fatura();

    try {
        if (TEST_MODE === 'true') {
            fatura.enableTestMode();
            await fatura.setTestCredentials();
            console.log('TEST MODU aktif - Kullanıcı:', fatura.userId);
        } else {
            await fatura.setCredentials(GIB_USERNAME, GIB_PASSWORD);
        }

        await fatura.login();
        console.log('GİB girişi başarılı');

        const invoiceData = buildInvoiceData(body);

        console.log('Fatura oluşturuluyor...');

        // ✅ DÜZELTİLDİ: let kullan ve tek seferde tanımla
        let apiResult = await fatura.createDraft(invoiceData);

        console.log('createDraft sonuç tipi:', typeof apiResult);
        console.log('createDraft sonuç:', apiResult);

        // Eğer apiResult undefined veya null ise
        if (!apiResult) {
            throw new Error('GİB yanıt vermedi');
        }

        // Eğer string ise (HTML hata sayfası olabilir)
        if (typeof apiResult === 'string') {
            if (apiResult.trim().startsWith('<')) {
                throw new Error('GİB HTML hata sayfası döndürdü');
            }
            // JSON string olabilir, dene
            try {
                apiResult = JSON.parse(apiResult);
            } catch (e) {
                throw new Error('GİB geçersiz yanıt döndürdü: ' + apiResult.substring(0, 100));
            }
        }

        // Şimdi apiResult bir obje olmalı
        let resultData = apiResult.data || apiResult || {};

        // Eğer hata varsa
        if (resultData.error || resultData.messages) {
            console.error('GİB Hatası:', resultData);
            throw new Error(resultData.messages?.[0] || resultData.error || 'Fatura oluşturulamadı');
        }

        let invoiceUUID = resultData?.uuid ||
            resultData?.faturaUuid ||
            resultData?.ettn ||
            resultData?.belgeNumarasi ||
            '';

        console.log('Bulunan UUID:', invoiceUUID);

        // Güvenli şekilde data'yı logla
        if (apiResult?.data) {
            if (typeof apiResult.data === 'string') {
                console.log('Yanıt string (HTML veya hata):', apiResult.data.substring(0, 200));
            } else {
                safeLog('Yanıt data:', apiResult.data);
            }
        }

        await fatura.logout();

        // Eğer bulunamadıysa, gönderdiğimiz UUID'yi kullan
        if (!invoiceUUID && invoiceData.faturaUuid) {
            invoiceUUID = invoiceData.faturaUuid;
        }

        console.log('Bulunan sonuç:', {
            invoiceUUID: invoiceUUID || 'Bulunamadı',
            documentNumber: resultData.belgeNumarasi || 'Bulunamadı'
        });

        return res.status(200).json({
            success: true,
            message: 'Fatura başarıyla oluşturuldu',
            data: {
                invoiceUUID: invoiceUUID || 'UUID alınamadı',
                documentNumber: resultData.belgeNumarasi || '',
                taxIdUsed: body.buyerTaxId,
                invoiceType: body.invoiceType,
                totals: {
                    matrah: invoiceData.matrah,
                    kdv: invoiceData.hesaplanankdv,
                    kdvTevkifat: invoiceData.hesaplananV9015,
                    stopaj: invoiceData.hesaplananV0011,
                    vergilerDahil: invoiceData.vergilerDahilToplamTutar,
                    odenecek: invoiceData.odenecekTutar
                },
                rawResult: TEST_MODE === 'true' ? resultData : undefined
            }
        });

    } catch (error) {
        try { await fatura.logout(); } catch (_) { /* ignore */ }

        console.error('HATA:', error.message);
        console.error('Hata stack:', error.stack);

        let errorMessage = error.message || 'Bilinmeyen hata';
        let errorCode = null;

        if (error.response?.data) {
            const gibError = error.response.data;
            errorMessage = gibError.error || gibError.message || errorMessage;
            errorCode = gibError.errorCode;
            console.error('GİB Hatası:', gibError);
        }

        return res.status(500).json({
            success: false,
            error: 'Fatura oluşturma hatası',
            message: errorMessage,
            errorCode,
            stack: TEST_MODE === 'true' ? error.stack : undefined
        });
    }
};
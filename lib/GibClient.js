const axios = require('axios');
const { URLSearchParams } = require('url');

class GibClient {
  constructor(options = {}) {
    this.isTest = options.test || false;
    this.baseUrl = this.isTest 
      ? 'https://earsivportaltest.efatura.gov.tr'
      : 'https://earsivportal.efatura.gov.tr';
    
    this.username = options.username || '';
    this.password = options.password || '';
    this.token = null;
    
    // JAR için cookie yönetimi
    this.cookies = {};
  }

  // Cookie header'ını oluştur
  _getCookieHeader() {
    return Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  // Cookie'leri parse et
  _parseCookies(setCookieHeader) {
    if (!setCookieHeader) return;
    
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    
    cookies.forEach(cookie => {
      const [nameValue] = cookie.split(';');
      const [name, value] = nameValue.trim().split('=');
      if (name && value) {
        this.cookies[name] = value;
      }
    });
  }

  // HTTP isteği yap
  async _request(url, params, options = {}) {
    const cookieHeader = this._getCookieHeader();
    
    const config = {
      method: 'POST',
      url: url,
      data: params.toString(),
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/login.jsp`,
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0'
      },
      ...(cookieHeader && { headers: { ...config?.headers, 'Cookie': cookieHeader } }),
      ...options
    };

    if (cookieHeader) {
      config.headers['Cookie'] = cookieHeader;
    }

    try {
      const response = await axios(config);
      
      // Cookie'leri sakla
      if (response.headers['set-cookie']) {
        this._parseCookies(response.headers['set-cookie']);
      }
      
      return response;
    } catch (error) {
      throw error;
    }
  }

  enableTestMode() {
    this.isTest = true;
    this.baseUrl = 'https://earsivportaltest.efatura.gov.tr';
    return this;
  }

  setCredentials(username, password) {
    this.username = username;
    this.password = password;
    return this;
  }

  setTestCredentials() {
    this.username = '333333054';
    this.password = '1';
    return this;
  }

  async login() {
    const loginUrl = `${this.baseUrl}/earsiv-services/esign`;
    
    const params = new URLSearchParams();
    params.append('assoscmd', 'login');
    params.append('rtype', 'json');
    params.append('userid', this.username);
    params.append('sifre', this.password);
    params.append('parola', '1');

    console.log('[GibClient] Login deneniyor...', { 
      url: loginUrl, 
      username: this.username
    });

    try {
      const response = await this._request(loginUrl, params);
      
      console.log('[GibClient] Login yanıt status:', response.status);
      console.log('[GibClient] Login yanıt data:', response.data);
      console.log('[GibClient] Login yanıt headers:', response.headers);

      // Yanıt boş mu?
      if (!response.data || Object.keys(response.data).length === 0) {
        // Bazen GİB text/plain döner, JSON parse et
        const text = response.data;
        console.log('[GibClient] Boş yanıt, text:', text);
        
        // Cookie'de token var mı kontrol et
        if (this.cookies['token']) {
          this.token = this.cookies['token'];
          console.log('[GibClient] Token cookie\'den alındı');
        }
      }

      // Token'ı dene
      this.token = response.data?.token || 
                   response.data?.data?.token ||
                   response.data?.TOKEN ||
                   response.data?.tokenBean?.token ||
                   this.cookies['token'];

      if (!this.token) {
        console.error('[GibClient] Token bulunamadı');
        throw new Error('Token alınamadı. GİB yanıtı: ' + JSON.stringify(response.data));
      }

      console.log('[GibClient] Login başarılı. Token:', this.token.substring(0, 15) + '...');

      return {
        success: true,
        token: this.token
      };
    } catch (error) {
      console.error('[GibClient] Login hatası:', error.message);
      if (error.response) {
        console.error('[GibClient] Status:', error.response.status);
        console.error('[GibClient] Data:', error.response.data);
        console.error('[GibClient] Headers:', error.response.headers);
      }
      throw new Error(`Giriş başarısız: ${error.message}`);
    }
  }

  async logout() {
    if (!this.token) return;
    
    const logoutUrl = `${this.baseUrl}/earsiv-services/esign`;
    
    const params = new URLSearchParams();
    params.append('assoscmd', 'logout');
    params.append('rtype', 'json');
    params.append('token', this.token);

    try {
      await this._request(logoutUrl, params);
      console.log('[GibClient] Logout başarılı');
    } catch (error) {
      console.error('[GibClient] Logout hatası:', error.message);
    } finally {
      this.token = null;
      this.cookies = {};
    }
  }

  async sendInvoice(invoiceJSON) {
    if (!this.token) {
      throw new Error('Oturum açık değil. Önce login() çağırın.');
    }

    const dispatchUrl = `${this.baseUrl}/earsiv-services/dispatch`;

    const params = new URLSearchParams();
    params.append('cmd', 'EARSIV_PORTAL_FATURA_KAYDET');
    params.append('pageName', 'RG_TASLAKLAR');
    params.append('token', this.token);
    params.append('jp', JSON.stringify(invoiceJSON));

    console.log('[GibClient] Fatura gönderiliyor...');

    try {
      const response = await this._request(dispatchUrl, params);

      console.log('[GibClient] GİB yanıtı:', response.data);

      // Başarı kontrolü
      const isSuccess = response.data?.data === 'Fatura başarıyla oluşturuldu.' ||
                       response.data?.success === true ||
                       (typeof response.data?.data === 'string' && 
                        response.data?.data?.includes('başarıyla'));

      if (isSuccess) {
        return {
          success: true,
          message: 'Fatura başarıyla oluşturuldu',
          data: response.data
        };
      }

      // Hata mesajı
      if (response.data?.messages && response.data.messages.length > 0) {
        const errorMsg = response.data.messages.map(m => m.text).join(', ');
        throw new Error(errorMsg);
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      return {
        success: false,
        data: response.data
      };
    } catch (error) {
      console.error('[GibClient] Fatura gönderim hatası:', error.message);
      throw error;
    }
  }
}

module.exports = GibClient;
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
    
    // Axios instance - cookie'leri otomatik yönet
    this.httpClient = axios.create({
      timeout: 30000,
      withCredentials: true, // Cookie'leri gönder/al
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*'
      }
    });
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
      username: this.username,
      test: this.isTest 
    });

    try {
      const response = await this.httpClient.post(loginUrl, params.toString());
      
      console.log('[GibClient] Login yanıtı:', response.data);

      // Token kontrolü - farklı formatları dene
      this.token = response.data.token || 
                   response.data.data?.token || 
                   response.data.TOKEN || 
                   response.data.tokenBean?.token;

      if (!this.token) {
        console.error('[GibClient] Token bulunamadı. Yanıt:', response.data);
        throw new Error('Token alınamadı. GİB yanıtı: ' + JSON.stringify(response.data));
      }

      console.log('[GibClient] Login başarılı. Token:', this.token.substring(0, 10) + '...');

      return {
        success: true,
        token: this.token
      };
    } catch (error) {
      console.error('[GibClient] Login hatası:', error.message);
      if (error.response) {
        console.error('[GibClient] Yanıt:', error.response.data);
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
      await this.httpClient.post(logoutUrl, params.toString());
      console.log('[GibClient] Logout başarılı');
    } catch (error) {
      console.error('[GibClient] Logout hatası:', error.message);
    } finally {
      this.token = null;
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

    console.log('[GibClient] Fatura gönderiliyor...', {
      url: dispatchUrl,
      token: this.token.substring(0, 10) + '...'
    });

    try {
      const response = await this.httpClient.post(dispatchUrl, params.toString());

      console.log('[GibClient] GİB yanıtı:', response.data);

      // Başarı kontrolü
      const isSuccess = response.data.data === 'Fatura başarıyla oluşturuldu.' ||
                       response.data.success === true ||
                       (typeof response.data.data === 'string' && 
                        response.data.data.includes('başarıyla'));

      if (isSuccess) {
        return {
          success: true,
          message: 'Fatura başarıyla oluşturuldu',
          data: response.data
        };
      }

      // Hata mesajı var mı?
      if (response.data.messages && response.data.messages.length > 0) {
        const errorMsg = response.data.messages.map(m => m.text).join(', ');
        throw new Error(errorMsg);
      }

      // Diğer hata durumları
      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return {
        success: false,
        data: response.data
      };
    } catch (error) {
      console.error('[GibClient] Fatura gönderim hatası:', error.message);
      if (error.response) {
        console.error('[GibClient] Yanıt:', error.response.data);
      }
      throw error;
    }
  }

  async getInvoiceHTML(uuid, isSigned = false) {
    if (!this.token) {
      throw new Error('Oturum açık değil.');
    }

    const dispatchUrl = `${this.baseUrl}/earsiv-services/dispatch`;

    const params = new URLSearchParams();
    params.append('cmd', 'EARSIV_PORTAL_FATURA_GOSTER');
    params.append('pageName', 'RG_TASLAKLAR');
    params.append('token', this.token);
    params.append('ettn', uuid);
    params.append('onayDurumu', isSigned ? 'Onaylandı' : 'Onaylanmadı');

    try {
      const response = await this.httpClient.post(dispatchUrl, params.toString());
      return response.data;
    } catch (error) {
      throw new Error(`Fatura görüntüleme hatası: ${error.message}`);
    }
  }
}

module.exports = GibClient;
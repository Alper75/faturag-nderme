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
    this.sessionCookies = null;
    
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*'
      }
    });
  }

  // Test modu ayarları
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

  // GİB'e giriş yap
  async login() {
    const loginUrl = `${this.baseUrl}/earsiv-services/esign`;
    
    const params = new URLSearchParams();
    params.append('assoscmd', 'login');
    params.append('rtype', 'json');
    params.append('userid', this.username);
    params.append('sifre', this.password);
    params.append('parola', '1');

    try {
      const response = await this.httpClient.post(loginUrl, params.toString());
      
      if (response.data.error) {
        throw new Error(`GİB Giriş Hatası: ${response.data.message || response.data.error}`);
      }

      this.token = response.data.token;
      
      // Çerezleri sakla
      if (response.headers['set-cookie']) {
        this.sessionCookies = response.headers['set-cookie'];
      }

      return {
        success: true,
        token: this.token
      };
    } catch (error) {
      throw new Error(`Giriş başarısız: ${error.message}`);
    }
  }

  // Çıkış yap
  async logout() {
    if (!this.token) return;
    
    const logoutUrl = `${this.baseUrl}/earsiv-services/esign`;
    
    const params = new URLSearchParams();
    params.append('assoscmd', 'logout');
    params.append('rtype', 'json');
    params.append('token', this.token);

    try {
      await this.httpClient.post(logoutUrl, params.toString());
      this.token = null;
      this.sessionCookies = null;
    } catch (error) {
      console.error('Logout error:', error.message);
    }
  }

  // Fatura gönder
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

    // Çerezleri ekle
    const headers = {};
    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies.join('; ');
    }

    try {
      const response = await this.httpClient.post(dispatchUrl, params.toString(), { headers });

      // Başarı kontrolü
      if (response.data && response.data.data === 'Fatura başarıyla oluşturuldu.') {
        return {
          success: true,
          message: 'Fatura başarıyla oluşturuldu',
          data: response.data
        };
      }

      // Hata kontrolü
      if (response.data && response.data.messages) {
        const errorMsg = response.data.messages.map(m => m.text).join(', ');
        throw new Error(errorMsg);
      }

      return {
        success: false,
        data: response.data
      };
    } catch (error) {
      throw new Error(`Fatura gönderim hatası: ${error.message}`);
    }
  }

  // Fatura HTML'i al
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

    const headers = {};
    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies.join('; ');
    }

    try {
      const response = await this.httpClient.post(dispatchUrl, params.toString(), { headers });
      return response.data;
    } catch (error) {
      throw new Error(`Fatura görüntüleme hatası: ${error.message}`);
    }
  }
}

module.exports = GibClient;
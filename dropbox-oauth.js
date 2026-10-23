/* OAuth 2.0 PKCE for Dropbox. Experimental integration.
 * Browser session only: tokens are not written to long-term localStorage.
 * A secured server-side token vault is required for unattended long-term sync.
 */
(function (root) {
  'use strict';
  const OAUTH = 'https://www.dropbox.com/oauth2/authorize';
  const TOKEN = 'https://api.dropboxapi.com/oauth2/token';
  const PREFIX = 'notas-pro-dropbox-pkce-v1:';
  const SCOPES = 'files.content.read files.content.write files.metadata.read files.metadata.write account_info.read';

  const b64 = bytes => {
    let result = '';
    for (const byte of bytes) result += String.fromCharCode(byte);
    return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };
  const random = size => {
    const bytes = new Uint8Array(size);
    root.crypto.getRandomValues(bytes);
    return b64(bytes);
  };
  async function challenge(verifier) {
    const bytes = new TextEncoder().encode(verifier);
    return b64(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)));
  }
  function callbackUrl(location) {
    return location.origin + location.pathname;
  }
  function validatedReturnUrl(value, target) {
    const result = new URL(value, target);
    if (result.origin !== target.origin || result.pathname !== target.pathname) {
      throw new TypeError('Destino de retorno inválido');
    }
    if (result.searchParams.has('code') || result.searchParams.has('access_token')) {
      throw new TypeError('Destino com parâmetros de autenticação');
    }
    return result.href;
  }
  class DropboxOAuth {
    constructor({owner, appKey, storage, fetchImpl, location, redirect}) {
      if (!owner || typeof owner !== 'string') throw new TypeError('Conta inválida');
      if (!appKey || typeof appKey !== 'string') throw new TypeError('É necessária a chave pública da aplicação Dropbox');
      this.owner = owner;
      this.appKey = appKey.trim();
      this.storage = storage || root.sessionStorage;
      this.fetch = fetchImpl || root.fetch.bind(root);
      this.location = location || root.location;
      this.redirect = redirect || callbackUrl(this.location);
      this.tokensKey = PREFIX + owner + ':' + this.appKey + ':tokens';
      this.pendingKey = PREFIX + owner + ':' + this.appKey + ':pending';
      this.refreshFlight = null;
      this.vault = root.NotasDropboxTokenVault || null;
      this.persistentError = null;
    }
    connected() {
      try {
        const current = JSON.parse(this.storage.getItem(this.tokensKey) || 'null');
        return !!(current && (current.refresh_token || (current.access_token && current.expires_at > Date.now())));
      } catch (_) { return false; }
    }
    disconnect() {
      this.storage.removeItem(this.tokensKey);
      this.storage.removeItem(this.pendingKey);
      this.vault?.forget(this.owner,this.appKey).catch(() => {});
    }
    async restorePersistent() {
      if (this.connected() || !this.vault) return this.connected();
      let refreshToken;
      try { refreshToken=await this.vault.restore(this.owner,this.appKey); }
      catch(err){this.persistentError=err.message;return false;}
      if (!refreshToken) return false;
      this.storage.setItem(this.tokensKey,JSON.stringify({
        access_token:'',refresh_token:refreshToken,expires_at:0
      }));
      return true;
    }
    async begin(returnUrl) {
      const current = new URL(callbackUrl(this.location));
      const original = validatedReturnUrl(returnUrl || this.location.href, current);
      const verifier = random(48);
      const state = random(24);
      this.storage.setItem(this.pendingKey, JSON.stringify({
        verifier, state, created: Date.now(), returnUrl: original
      }));
      const uri = new URL(OAUTH);
      const params = uri.searchParams;
      params.set('response_type', 'code');
      params.set('client_id', this.appKey);
      params.set('redirect_uri', this.redirect);
      params.set('code_challenge_method', 'S256');
      params.set('code_challenge', await challenge(verifier));
      params.set('token_access_type', 'offline');
      params.set('scope', SCOPES);
      params.set('state', state);
      return uri.href;
    }
    async finish(queryString) {
      const params = new URLSearchParams(queryString === undefined ? this.location.search : queryString);
      if (params.has('error')) throw new Error('Autorização Dropbox recusada');
      if (!params.has('code')) return null;
      let pending;
      try { pending = JSON.parse(this.storage.getItem(this.pendingKey) || 'null'); }
      catch (_) { pending = null; }
      // Reject forged, expired or mismatched callbacks without contacting Dropbox.
      if (!pending || !pending.verifier || !pending.state || !params.get('state')
          || pending.state !== params.get('state') || Date.now() - pending.created > 10 * 60 * 1000
          || pending.created > Date.now() + 10 * 1000) {
        throw new Error('Validação da autenticação Dropbox falhou');
      }
      const form = new URLSearchParams({
        code: params.get('code'), grant_type: 'authorization_code',
        client_id: this.appKey, code_verifier: pending.verifier, redirect_uri: this.redirect
      });
      const res = await this.fetch(TOKEN, {method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: form, cache:'no-store'});
      if (!res.ok) throw new Error('O Dropbox recusou o código de autorização');
      const data = await res.json();
      if (!data.access_token || !data.expires_in) throw new Error('Resposta Dropbox inválida');
      this.storage.setItem(this.tokensKey, JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token || '',
        expires_at: Date.now() + data.expires_in * 1000
      }));
      this.storage.removeItem(this.pendingKey);
      if (this.vault && data.refresh_token) {
        try { await this.vault.remember(this.owner,this.appKey,data.refresh_token); }
        catch(err){this.persistentError=err.message;}
      }
      return validatedReturnUrl(pending.returnUrl, new URL(callbackUrl(this.location)));
    }
    async getToken() {
      let data;
      try { data = JSON.parse(this.storage.getItem(this.tokensKey) || 'null'); }
      catch (_) { data = null; }
      if (!data) throw new Error('É necessário ligar o Dropbox');
      if (data.access_token && data.expires_at - Date.now() > 60000) return data.access_token;
      if (!data.refresh_token) throw new Error('Sessão Dropbox expirada; ligue novamente');
      if (this.refreshFlight) return this.refreshFlight;
      this.refreshFlight = (async () => {
        const form = new URLSearchParams({
          grant_type: 'refresh_token', refresh_token: data.refresh_token, client_id: this.appKey
        });
        const res = await this.fetch(TOKEN, {method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body:form, cache:'no-store'});
        if (!res.ok) throw new Error('Não foi possível renovar a sessão Dropbox');
        const fresh = await res.json();
        if (!fresh.access_token || !fresh.expires_in) throw new Error('Token renovado inválido');
        this.storage.setItem(this.tokensKey, JSON.stringify({
          access_token: fresh.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + fresh.expires_in * 1000
        }));
        return fresh.access_token;
      })();
      try { return await this.refreshFlight; }
      finally { this.refreshFlight = null; }
    }
  }

  const API = Object.freeze({DropboxOAuth, callbackUrl, validatedReturnUrl});
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.NotasDropboxOAuth = API;
})(globalThis);

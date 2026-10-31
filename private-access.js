(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const shell = $('#private-app');
  const gate = $('#private-access');
  const form = $('#private-login-form');
  const message = $('#private-access-message');
  const startupStatus = $('#private-startup-status');
  const devicesDialog = $('#private-devices-dialog');
  const devicesList = $('#private-devices-list');
  const devicesMessage = $('#private-devices-message');
  const config = window.NOTAS_CONFIG || {};
  const DEVICE_NAME_KEY = 'notas-pro:private-device-name';
  const MAX_DEVICES = 3;
  const RPC_TIMEOUT = 15000;
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && /^(sb_publishable_|eyJ)/.test(config.supabasePublishableKey || '');
  let cloud = null;
  let currentSession = null;
  let approvedSession = null;
  let currentIdentity = '';
  let approvedIdentity = '';
  let epoch = 0;
  let checkFlight = null;
  let checkEpoch = null;
  let checkAgain = false;
  let appLoading = null;
  let appReady = false;
  let appFailed = false;
  let reason = 'checking';
  let authBusy = false;
  let reloading = false;
  let expiryTimer;

  function defaultDeviceName() {
    const ua = navigator.userAgent;
    const device = /Android/i.test(ua) ? 'Android' : /iPhone/i.test(ua) ? 'iPhone' : /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Windows/i.test(ua) ? 'PC Windows' : /Macintosh/i.test(ua) ? 'Mac' : 'Computador';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
    return `${device} · ${browser}`;
  }
  function deviceName() {
    return ($('#private-device-name').value.trim() || defaultDeviceName()).slice(0, 60);
  }
  try { $('#private-device-name').value = localStorage.getItem(DEVICE_NAME_KEY) || defaultDeviceName(); }
  catch { $('#private-device-name').value = defaultDeviceName(); }

  // Decoding is only for noticing session changes and expiry in this tab.
  // Only the server RPC and database policies can grant access.
  function tokenClaims(session) {
    try {
      const segment = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, '=')));
    } catch { return {}; }
  }
  function identity(session) {
    if (!session?.user?.id || !session.access_token) return '';
    return `${session.user.id}:${tokenClaims(session).session_id || session.access_token}`;
  }
  function authorized() {
    return !!approvedSession && approvedIdentity === currentIdentity;
  }
  function lock(nextReason = 'checking') {
    const wasAuthorized = !!approvedSession;
    approvedSession = null;
    approvedIdentity = '';
    clearTimeout(expiryTimer);
    shell.hidden = true;
    shell.inert = true;
    gate.hidden = false;
    document.body.classList.add('private-locked');
    document.body.classList.remove('private-loading');
    const keepDeviceManager = nextReason === 'device_limit' && reason === 'device_limit';
    document.querySelectorAll('dialog[open]').forEach(dialog => { if (dialog !== devicesDialog || !keepDeviceManager) dialog.close(); });
    if (!keepDeviceManager) devicesList.replaceChildren();
    if (wasAuthorized && appReady) window.dispatchEvent(new CustomEvent('notas:private-locked', {detail: {reason: nextReason}}));
    document.title = 'Notas Exclusivas Pro';
    renderState(nextReason);
  }
  function observeSession(session) {
    const nextIdentity = identity(session);
    const changed = nextIdentity !== currentIdentity;
    if (changed) {
      epoch++;
      currentIdentity = nextIdentity;
      currentSession = session;
      lock(session ? 'checking' : 'unauthenticated');
    } else currentSession = session;
    return changed;
  }
  function renderState(nextReason, customMessage = '') {
    reason = nextReason;
    // Session restoration is not a login screen. Keep notes locked, and only
    // show the access card after a confirmed denial, missing session or error.
    gate.hidden = nextReason === 'checking' || nextReason === 'authorized';
    if (startupStatus) startupStatus.hidden = nextReason !== 'checking';
    const messages = {
      checking: 'A verificar o acesso pessoal…',
      unauthenticated: 'Inicie sessão com a sua conta para abrir as notas.',
      not_owner: 'Esta conta não tem acesso à aplicação pessoal.',
      device_limit: 'Já existem três acessos autorizados. Remova um em Gerir dispositivos para utilizar este dispositivo.',
      session_revoked: 'O acesso desta sessão foi removido. Termine esta sessão e volte a entrar para autorizar um novo acesso.',
      invalid_session: 'Esta sessão já não é válida. Termine a sessão e volte a entrar.',
      unavailable: 'Não foi possível confirmar o acesso. Verifique a ligação à Internet e tente novamente.',
      configuration: 'O acesso pessoal está indisponível. A configuração de segurança precisa de ser concluída.',
      app_error: 'Não foi possível abrir a aplicação. Recarregue a página para tentar novamente.',
      authorized: ''
    };
    message.textContent = customMessage || messages[nextReason] || messages.unavailable;
    form.hidden = nextReason !== 'unauthenticated' || !cloud;
    $('#private-retry-btn').hidden = !['unavailable', 'device_limit', 'configuration', 'app_error'].includes(nextReason);
    $('#private-manage-btn').hidden = nextReason !== 'device_limit';
    $('#private-logout-btn').hidden = !currentSession;
    $('#private-login-btn').disabled = authBusy;
    $('#private-google-btn').disabled = authBusy;
    $('#private-logout-btn').disabled = authBusy;
  }
  async function rpc(name, params) {
    const controller = new AbortController();
    let timer;
    try {
      let request = cloud.rpc(name, params);
      if (typeof request.abortSignal === 'function') request = request.abortSignal(controller.signal);
      const result = await Promise.race([
        request,
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('RPC timeout')); }, RPC_TIMEOUT); })
      ]);
      if (result.error) throw new Error('RPC unavailable');
      return result.data;
    } finally { clearTimeout(timer); }
  }
  function loadApplication() {
    if (appReady) return Promise.resolve();
    if (appLoading) return appLoading;
    if (appFailed) return Promise.reject(new Error('Application initialization failed'));
    appLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'app.js';
      script.onload = () => {
        if (appReady) resolve();
        else { appFailed = true; reject(new Error('Application not ready')); }
      };
      script.onerror = () => { script.remove(); appLoading = null; reject(new Error('Application unavailable')); };
      document.body.append(script);
    });
    return appLoading;
  }
  async function validate({fresh = false} = {}) {
    // Keep an already authorized editor available during temporary network outages.
    // Never authorize a fresh offline session or bypass token expiry.
    if (navigator.onLine === false && authorized()) return true;
    if (!cloud) { lock('configuration'); return false; }
    if (checkFlight) { if (fresh || checkEpoch !== epoch) checkAgain = true; return checkFlight; }
    checkFlight = (async () => {
      let requestEpoch = epoch;
      checkEpoch = requestEpoch;
      try {
        const {data, error} = await cloud.auth.getSession();
        // A logout or account change can arrive while session restoration is
        // pending. Never let that older result restore the previous identity.
        if (requestEpoch !== epoch) { checkAgain = true; return false; }
        if (error) throw new Error('Session unavailable');
        observeSession(data.session);
        requestEpoch = epoch;
        checkEpoch = requestEpoch;
        const session = currentSession;
        const requestedIdentity = currentIdentity;
        if (!session || !requestedIdentity) { lock('unauthenticated'); return false; }
        const result = await rpc('personal_app_access', {p_device_name: deviceName()});
        if (requestEpoch !== epoch || requestedIdentity !== currentIdentity) return false;
        if (result?.allowed !== true || result.reason !== 'authorized' || result.max_devices !== MAX_DEVICES || !Number.isInteger(result.active_devices) || result.active_devices < 1 || result.active_devices > MAX_DEVICES) {
          const denial = ['unauthenticated', 'not_owner', 'device_limit', 'session_revoked', 'invalid_session'].includes(result?.reason) ? result.reason : 'unavailable';
          lock(denial);
          return false;
        }
        const wasAuthorized = authorized();
        approvedSession = session;
        approvedIdentity = requestedIdentity;
        // Make layout measurable only after authorization, while keeping all
        // editor content invisible and inert until initialization completes.
        if (!appReady) document.body.classList.add('private-loading');
        await loadApplication();
        if (requestEpoch !== epoch || requestedIdentity !== currentIdentity || !authorized()) return false;
        shell.hidden = false;
        shell.inert = false;
        gate.hidden = true;
        document.body.classList.remove('private-locked', 'private-loading');
        renderState('authorized');
        if (!wasAuthorized) window.dispatchEvent(new CustomEvent('notas:private-authorized', {detail: {session}}));
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        clearTimeout(expiryTimer);
        const expiresAt = Number(tokenClaims(session).exp) * 1000;
        if (Number.isFinite(expiresAt)) expiryTimer = setTimeout(() => { lock('checking'); void validate(); }, Math.max(0, expiresAt - Date.now()));
        return true;
      } catch {
        if (requestEpoch === epoch) lock(appFailed ? 'app_error' : 'unavailable');
        return false;
      }
    })();
    try { return await checkFlight; }
    finally {
      checkFlight = null;
      checkEpoch = null;
      if (checkAgain) { checkAgain = false; setTimeout(() => void validate(), 0); }
    }
  }
  async function signOut() {
    if (!cloud || authBusy) return;
    authBusy = true;
    renderState(reason);
    try {
      const {error} = await cloud.auth.signOut({scope: 'local'});
      if (error) throw new Error('Logout failed');
      observeSession(null);
      lock('unauthenticated');
      // Check after sign-out so edits made while it was pending are preserved.
      const canReload = window.dispatchEvent(new Event('notas:private-before-reload', {cancelable: true}));
      if (canReload) { reloading = true; location.reload(); }
      else renderState('unauthenticated', 'Sessão terminada. Mantenha esta página aberta e entre novamente para recuperar as alterações por guardar.');
    } catch {
      if (authorized()) $('#auth-message').textContent = 'Não foi possível terminar a sessão. Tente novamente.';
      else renderState(reason, 'Não foi possível terminar a sessão. Verifique a ligação e tente novamente.');
    } finally { authBusy = false; $('#private-login-btn').disabled = false; $('#private-logout-btn').disabled = false; }
  }
  function displayDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-PT', {dateStyle: 'short', timeStyle: 'short'}).format(date);
  }
  async function listDevices() {
    const requestedEpoch = epoch;
    devicesMessage.textContent = 'A consultar os acessos autorizados…';
    devicesList.replaceChildren();
    $('#private-devices-refresh').disabled = true;
    try {
      const data = await rpc('personal_app_list_devices');
      if (requestedEpoch !== epoch) return;
      if (!Array.isArray(data)) throw new Error('Invalid device list');
      devicesMessage.textContent = `${data.length} de ${MAX_DEVICES} acessos autorizados.`;
      data.forEach(device => {
        if (!device || typeof device.session_id !== 'string') return;
        const item = document.createElement('li');
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = String(device.device_name || 'Dispositivo').slice(0, 60);
        text.append(name);
        if (device.is_current) { const tag = document.createElement('span'); tag.className = 'private-current-device'; tag.textContent = 'Este dispositivo'; text.append(tag); }
        const lastSeen = document.createElement('small');
        const date = displayDate(device.last_seen_at || device.created_at);
        lastSeen.textContent = date ? `Último acesso: ${date}` : '';
        text.append(lastSeen);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remover acesso';
        remove.addEventListener('click', async () => {
          if (!confirm(`Remover o acesso de «${name.textContent}»? As notas guardadas na sua conta serão mantidas.`)) return;
          remove.disabled = true;
          try {
            const result = await rpc('personal_app_revoke_device', {p_session_id: device.session_id});
            if (requestedEpoch !== epoch) return;
            if (result?.revoked !== true) throw new Error('Revocation failed');
            if (device.is_current) { lock('session_revoked'); await signOut(); return; }
            if (reason === 'device_limit') {
              devicesDialog.close();
              // A response started before revocation cannot confirm the newly
              // freed place; always queue a fresh admission check.
              await validate({fresh: true});
            } else await listDevices();
          } catch { devicesMessage.textContent = 'Não foi possível remover o acesso. Atualize a lista e tente novamente.'; }
          finally { remove.disabled = false; }
        });
        item.append(text, remove);
        devicesList.append(item);
      });
    } catch {
      if (requestedEpoch === epoch) devicesMessage.textContent = 'Não foi possível consultar os dispositivos. Verifique a ligação e a sessão.';
    } finally { $('#private-devices-refresh').disabled = false; }
  }
  function manageDevices() {
    if (!currentSession || (!authorized() && reason !== 'device_limit')) return;
    $('#auth-dialog').close();
    if (!devicesDialog.open) devicesDialog.showModal();
    void listDevices();
  }

  window.NOTAS_PRIVATE = Object.freeze({
    get client() { return cloud; },
    get session() { return authorized() ? approvedSession : null; },
    get authorized() { return authorized(); },
    get reloading() { return reloading; },
    validate,
    signOut,
    manageDevices,
    linkGoogle:beginGoogleLink
  });
  window.addEventListener('notas:private-ready', () => { appReady = true; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!cloud || authBusy || !form.reportValidity()) return;
    authBusy = true;
    renderState(reason, 'A iniciar sessão…');
    try {
      try { localStorage.setItem(DEVICE_NAME_KEY, deviceName()); } catch {}
      const {data, error} = await cloud.auth.signInWithPassword({email: $('#private-email').value.trim(), password: $('#private-password').value});
      $('#private-password').value = '';
      if (error) { renderState('unauthenticated', 'Não foi possível entrar. Confirme o e-mail, a palavra-passe e a ligação à Internet.'); return; }
      observeSession(data.session);
      await validate();
    } catch { renderState('unauthenticated', 'Não foi possível iniciar sessão. Verifique a ligação à Internet.'); }
    finally { authBusy = false; $('#private-login-btn').disabled = false; $('#private-logout-btn').disabled = false; }
  });
  const nativePlatform = Boolean(window.Capacitor?.isNativePlatform?.()) || location.protocol === 'notas:';
  const oauthCallback = 'notaspro://auth/callback';
  async function beginGoogleLogin(){
    if(!cloud||authBusy)return;
    authBusy=true;renderState(reason,'A abrir a autenticação Google…');
    try{
      const {data,error}=await cloud.auth.signInWithOAuth({
        provider:'google',
        options:{redirectTo:nativePlatform?oauthCallback:location.origin+location.pathname,skipBrowserRedirect:nativePlatform}
      });
      if(error)throw error;
      if(nativePlatform){
        if(!data?.url)throw new Error('Google login URL missing');
        await window.NOTAS_NATIVE?.openExternal?.(data.url);
      }
    }catch{
      renderState(reason,'Não foi possível iniciar o login Google. Verifique a configuração Google no Supabase e a ligação.');
    }finally{authBusy=false;$('#private-google-btn').disabled=false;}
  }
  async function beginGoogleLink() {
    if(!cloud||authBusy||!authorized()||!currentSession?.user?.id)return;
    authBusy=true;
    try {
      sessionStorage.setItem('notas:google-link-owner',currentSession.user.id);
      const {data,error}=await cloud.auth.linkIdentity({
        provider:'google',
        options:{redirectTo:nativePlatform?oauthCallback:location.origin+location.pathname,skipBrowserRedirect:nativePlatform}
      });
      if(error)throw error;
      if(nativePlatform){
        if(!data?.url)throw new Error('Missing Google link URL');
        await window.NOTAS_NATIVE?.openExternal?.(data.url);
      }
    } catch {
      sessionStorage.removeItem('notas:google-link-owner');
      const message=$('#auth-message');
      if(message)message.textContent='Não foi possível associar o Google. É necessário ativar o fornecedor e a associação de identidades no Supabase.';
    } finally{authBusy=false;}
  }
  $('#private-google-btn').addEventListener('click',()=>void beginGoogleLogin());
  window.addEventListener('notas:auth-url',event=>{
    if(!cloud||typeof event.detail?.url!=='string')return;
    let callback;try{callback=new URL(event.detail.url);}catch{return;}
    if(callback.protocol!=='notaspro:'||callback.hostname!=='auth'||callback.pathname!=='/callback')return;
    const code=callback.searchParams.get('code');
    if(!code){renderState('unauthenticated','O Google não devolveu um código de autorização válido.');return;}
    void cloud.auth.exchangeCodeForSession(code).then(async ({data,error})=>{
      if(error)throw error;
      const expected=sessionStorage.getItem('notas:google-link-owner');
      sessionStorage.removeItem('notas:google-link-owner');
      if(expected && data?.session?.user?.id!==expected){
        await cloud.auth.signOut({scope:'local'});
        observeSession(null);
        lock('not_owner');
        throw new Error('Google identity returned a different account');
      }
      observeSession(data.session);await validate({fresh:true});
    }).catch(()=>renderState('unauthenticated','Falhou a conclusão do login Google. Tente novamente.'));
  });
  window.dispatchEvent(new Event('notas:native-auth-ready'));
  $('#private-retry-btn').addEventListener('click', () => { if (appFailed || !cloud) location.reload(); else void validate(); });
  $('#private-logout-btn').addEventListener('click', () => void signOut());
  $('#private-manage-btn').addEventListener('click', manageDevices);
  $('#private-devices-close').addEventListener('click', () => devicesDialog.close());
  $('#private-devices-refresh').addEventListener('click', () => void listDevices());
  addEventListener('online', () => void validate());
  addEventListener('offline', () => { if(!authorized()){ epoch++; lock('unavailable'); } });
  addEventListener('focus', () => { if (currentSession) void validate(); });
  addEventListener('pageshow', event => { if (event.persisted) { epoch++; lock('checking'); void validate(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && currentSession) void validate(); });
  setInterval(() => { if (!document.hidden && currentSession) void validate(); }, 60000);
  // Cache only the application shell; authorization always requires the server.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').then(reg => reg.update()).catch(() => {});
  if (configured && window.supabase) {
    try { cloud = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey,{auth:{flowType:'pkce',detectSessionInUrl:!nativePlatform}}); }
    catch { lock('configuration'); return; }
    cloud.auth.onAuthStateChange((_event, session) => {
      const changed = observeSession(session);
      // SIGNED_OUT also invalidates a pending initial getSession(), before an
      // identity has been observed in this page.
      if (_event === 'SIGNED_OUT' && !changed) { epoch++; lock('unauthenticated'); }
      // getSession() already covers the initial identity. Supabase can also
      // repeat SIGNED_IN on focus; neither needs a second identical RPC.
      if (!changed && ['INITIAL_SESSION', 'SIGNED_IN'].includes(_event)) return;
      // Supabase callbacks must return before another auth/API request starts.
      setTimeout(() => void validate(), 0);
    });
    void validate();
  } else lock('configuration');
})();

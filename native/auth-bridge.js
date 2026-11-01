import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
if (isAndroid) {
  document.documentElement.classList.add('native-android');
  void syncSystemInsets();
  window.addEventListener('resize', () => void syncSystemInsets(), {passive: true});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncSystemInsets();
  });

  // WebView assets are bundled in the APK. Purge only stale static web caches,
  // never localStorage or application notes.
  if (typeof caches !== 'undefined') {
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('notas-pro-')).map(k => caches.delete(k)))).catch(() => {});
  }
}
const NativeShare = registerPlugin('KeepShare');
const NativeInsets = registerPlugin('KeepInsets');
async function syncSystemInsets() {
  if (!isAndroid) return;
  try {
    const data = await NativeInsets.getInsets();
    for (const edge of ['top', 'bottom']) {
      const value = Number(data?.[edge]);
      if (!Number.isFinite(value) || value < 0 || value > 96) continue;
      document.documentElement.style.setProperty('--notes-system-' + edge, value + 'px');
    }
  } catch {
    // Older/native preview builds can use CSS env(safe-area-inset-*) fallback.
  }
}

let pendingAuthUrl = null;
let lastDeliveredUrl = null;
function handleAppUrl(url) {
  if(typeof url!=='string'||!url.startsWith('notaspro://auth/callback?'))return;
  if(url===lastDeliveredUrl)return;
  lastDeliveredUrl=url;
  pendingAuthUrl = url;
  window.dispatchEvent(new CustomEvent('notas:auth-url',{detail:{url}}));
  if(isAndroid)Browser.close().catch(()=>{});
}
window.NOTAS_NATIVE = Object.freeze({
  isNative: isAndroid || location.protocol === 'notas:',
  consumeAuthUrl: () => {const value=pendingAuthUrl;pendingAuthUrl=null;return value;},
  openExternal: async url => {
    const u=new URL(url);
    if(u.protocol!=='https:')throw Error('Invalid external authentication URL');
    if(isAndroid)await Browser.open({url:u.href});
    else window.open(u.href,'_blank','noopener,noreferrer');
  },
  copyText: async text => {
    if(isAndroid)await Clipboard.write({string:String(text)});
    else await navigator.clipboard.writeText(String(text));
  },
  shareFile: async ({target,title,filename,content}) => {
    if(!isAndroid)return false;
    await NativeShare.shareFile({
      target:String(target||'dropbox'),title:String(title||'Nota'),
      filename:String(filename||'Nota.html'),content:String(content||'')
    });
    return true;
  },
  shareText: async ({target,title,text}) => {
    if(!isAndroid)return false;
    await NativeShare.shareText({
      target:String(target||''),title:String(title||'Nota'),text:String(text||'')
    });
    return true;
  }
});
window.addEventListener('notas:native-auth-ready',()=>{
  if(pendingAuthUrl)window.dispatchEvent(new CustomEvent('notas:auth-url',{detail:{url:pendingAuthUrl}}));
});
if(isAndroid){
  // Register the Android system Back action. Without an explicit handler,
  // Capacitor may leave the WebView on a stale history entry or not exit.
  App.addListener('backButton', () => {
    const request=new Event('notas:android-back', {cancelable:true});
    window.dispatchEvent(request);
    if(!request.defaultPrevented){
      // Home screen: return to Android launcher, preserving the authenticated
      // local profile; never sign the user out.
      App.exitApp().catch(() => {});
    }
  }).catch(() => {});
  App.addListener('appUrlOpen',event=>handleAppUrl(event.url));
  App.getLaunchUrl().then(event=>{if(event?.url)handleAppUrl(event.url);}).catch(()=>{});
}

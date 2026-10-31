import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
const isAndroid = Boolean(window.Capacitor?.isNativePlatform?.());
window.NOTAS_NATIVE = Object.freeze({
  openExternal: async url => {
    const u = new URL(url);
    if(u.protocol !== 'https:') throw Error('Invalid external auth URL');
    if(isAndroid) await Browser.open({url:u.href});
    else window.open(u.href,'_blank','noopener,noreferrer');
  }
});
if(isAndroid){
  App.addListener('appUrlOpen',event=>{
    if(typeof event.url==='string'&&event.url.startsWith('notaspro://auth/callback?')){
      window.dispatchEvent(new CustomEvent('notas:auth-url',{detail:{url:event.url}}));
      Browser.close().catch(()=>{});
    }
  });
}

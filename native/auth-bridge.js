import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { registerPlugin } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
const isAndroid = Boolean(window.Capacitor?.isNativePlatform?.());
const NativeShare = registerPlugin('KeepShare');
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
  App.addListener('appUrlOpen',event=>handleAppUrl(event.url));
  App.getLaunchUrl().then(event=>{if(event?.url)handleAppUrl(event.url);}).catch(()=>{});
}

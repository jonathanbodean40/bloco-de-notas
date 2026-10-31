import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Clipboard } from '@capacitor/clipboard';
const isAndroid = Boolean(window.Capacitor?.isNativePlatform?.());
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
  shareFile: async ({title,filename,text}) => {
    if(!isAndroid)return false;
    const safeName=String(filename||'Nota.txt').replace(/[^A-Za-z0-9_.-]/g,'-').slice(0,110);
    const path='exports/'+Date.now()+'-'+safeName;
    await Filesystem.writeFile({path,data:String(text),directory:Directory.Cache,encoding:Encoding.UTF8,recursive:true});
    const {uri}=await Filesystem.getUri({path,directory:Directory.Cache});
    await Share.share({title:String(title||'Nota'),files:[uri],dialogTitle:'Exportar a nota'});
    return true;
  },
  shareText: async ({title,text}) => {
    if(!isAndroid)return false;
    await Share.share({title:String(title||'Nota'),text:String(text),dialogTitle:'Partilhar a nota'});
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

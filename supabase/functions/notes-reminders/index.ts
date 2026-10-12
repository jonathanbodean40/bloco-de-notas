import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// Confirmado em Authentication e na conta da aplicação; não vem de user_metadata.
const OWNER_ID='38409eff-d6a5-49ef-b2a2-1d2a8312cc1b';
const SITE='https://jonathanbodean40.github.io';
const headers={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Vary':'Origin'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function check(result:any){if(result.error)throw new Error('database');return result.data;}
function validSubscription(s:any){
  try{const u=new URL(s.endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&
    (['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname)||u.hostname.endsWith('.notify.windows.com'))&&
    /^[\w-]{80,100}$/.test(s.keys.p256dh)&&/^[\w-]{20,30}$/.test(s.keys.auth);
  }catch{return false;}
}
async function settings(){
  let s=check(await db.from('notes_push_settings').select('*').eq('id',true).single());
  if(!s.public_key){const keys=webpush.generateVAPIDKeys();check(await db.from('notes_push_settings').update({public_key:keys.publicKey,private_key:keys.privateKey}).eq('id',true).is('public_key',null));s=check(await db.from('notes_push_settings').select('*').eq('id',true).single());}
  return s;
}
async function dispatch(s:any){
  const reminders=check(await db.rpc('claim_notes_reminders'))||[];
  let delivered=0;
  for(const r of reminders){
    // Defesa adicional se uma versão anterior da função de claim devolver outras contas.
    if(r.user_id!==OWNER_ID)continue;
    try{
      const devices=check(await db.from('notes_push_devices').select('*').eq('user_id',OWNER_ID));
      const old=check(await db.from('notes_push_deliveries').select('device_id').eq('reminder_id',r.id).eq('revision',r.revision));
      const sent=new Set(old.map((d:any)=>d.device_id));let all=devices.length>0,successes=devices.filter((d:any)=>sent.has(d.id)).length;
      for(const d of devices){
        if(sent.has(d.id))continue;
        const latest=check(await db.from('notes_reminders').select('status,revision').eq('id',r.id).eq('user_id',OWNER_ID).single());
        if(latest.status!=='scheduled'||latest.revision!==r.revision){all=false;break;}
        if(!validSubscription(d.subscription)){all=false;continue;}
        try{
          await webpush.sendNotification(d.subscription,JSON.stringify({id:r.id,revision:r.revision}),{
            TTL:86400,urgency:'high',timeout:5000,
            vapidDetails:{subject:SITE+'/bloco-de-notas/',publicKey:s.public_key,privateKey:s.private_key}
          });
          check(await db.from('notes_push_deliveries').upsert({reminder_id:r.id,revision:r.revision,device_id:d.id}));delivered++;successes++;
        }catch(e){
          if([404,410].includes(e.statusCode))check(await db.from('notes_push_devices').delete().eq('id',d.id).eq('user_id',OWNER_ID));
          else all=false;
        }
      }
      check(await db.from('notes_reminders').update({claimed_at:null,...(all&&successes>0?{status:'sent'}:{})}).eq('id',r.id).eq('user_id',OWNER_ID).eq('revision',r.revision).eq('status','scheduled'));
    }catch{await db.from('notes_reminders').update({claimed_at:null}).eq('id',r.id).eq('user_id',OWNER_ID).eq('revision',r.revision);}
  }
  return {delivered};
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  if(req.method!=='POST')return reply({error:'Método não permitido.'},405);
  try{
    if(Number(req.headers.get('content-length')||0)>12000000)return reply({error:'Pedido demasiado grande.'},413);
    const raw=await req.text();if(raw.length>12000000)return reply({error:'Nota demasiado grande. Reduza as imagens.'},413);
    const body=JSON.parse(raw),action=body.action;
    // Partilhas públicas desativadas, incluindo links anteriormente criados.
    if(action==='share-open'||action==='share-create')return reply({error:'As partilhas estão desativadas nesta aplicação pessoal.'},403);
    // The cron authenticates with its private secret. All other calls verify the user's JWT.
    if(action==='dispatch'){
      const s=check(await db.from('notes_push_settings').select('*').eq('id',true).single());
      if(!req.headers.get('x-notes-cron')||req.headers.get('x-notes-cron')!==s.cron_secret)return reply({error:'Não autorizado.'},401);
      if(!s.public_key)return reply({delivered:0});
      return reply(await dispatch(s));
    }
    const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
    if(!token)return reply({error:'Entre na sua conta.'},401);
    const {data,error}=await db.auth.getUser(token);if(error||!data.user)return reply({error:'Sessão expirada. Entre novamente.'},401);
    const owner=data.user.id;
    if(owner!==OWNER_ID)return reply({error:'Acesso reservado ao proprietário desta aplicação.'},403);
    // A RPC usa o JWT do utilizador. Nunca usar o cliente service_role neste gate.
    const publicKey=Deno.env.get('SUPABASE_ANON_KEY');
    if(!publicKey)return reply({error:'O controlo de acesso está indisponível.'},503);
    const requestDb=createClient(Deno.env.get('SUPABASE_URL')!,publicKey,{
      global:{headers:{Authorization:'Bearer '+token}},
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const access=await requestDb.rpc('personal_app_access');
    if(access.error||!access.data)return reply({error:'Não foi possível verificar o acesso. Tente novamente.'},503);
    if(access.data.allowed!==true||access.data.reason!=='authorized')return reply({error:'Esta sessão não está autorizada a usar a aplicação.'},403);
    if(action==='settings'){const s=await settings();return reply({publicKey:s.public_key});}
    if(action==='list'){
      const reminders=check(await db.from('notes_reminders').select('id,label,due_at,note_id,shipment_id,status').eq('user_id',owner).is('hidden_at',null).order('due_at',{ascending:false}).limit(500));
      const devices=check(await db.from('notes_push_devices').select('endpoint').eq('user_id',owner));return reply({reminders,devices:devices.length,endpoints:devices.map((d:any)=>d.endpoint)});
    }
    if(action==='subscribe'){
      const subscription=body.subscription;if(!validSubscription(subscription))return reply({error:'Dispositivo de notificações inválido.'},400);
      const list=check(await db.from('notes_push_devices').select('id,endpoint').eq('user_id',owner));if(list.length>=30&&!list.some((d:any)=>d.endpoint===subscription.endpoint))return reply({error:'Limite de 30 dispositivos atingido.'},400);
      check(await db.from('notes_push_devices').upsert({user_id:owner,endpoint:subscription.endpoint,subscription,updated_at:new Date().toISOString()},{onConflict:'endpoint'}));return reply({ok:true});
    }
    if(action==='unsubscribe'){
      check(await db.from('notes_push_devices').delete().eq('user_id',owner).eq('endpoint',String(body.endpoint)));return reply({ok:true});
    }
    if(!uuid(body.id))return reply({error:'Identificador inválido.'},400);
    if(action==='save'){
      const label=String(body.label||'').trim(),due=new Date(body.dueAt);
      if(!label||label.length>250||!Number.isFinite(due.getTime())||due.getTime()<=Date.now()||due.getTime()>Date.now()+5*366*86400000)return reply({error:'Indique uma descrição e uma data futura dentro dos próximos cinco anos.'},400);
      if((body.noteId&&!uuid(body.noteId))||(body.shipmentId&&!uuid(body.shipmentId)))return reply({error:'Referência inválida.'},400);
      const existing=check(await db.from('notes_reminders').select('id,user_id').eq('id',body.id).maybeSingle());
      if(existing&&existing.user_id!==owner)return reply({error:'Não autorizado.'},403);
      const values={user_id:owner,label,due_at:due.toISOString(),note_id:body.noteId||null,shipment_id:body.shipmentId||null,status:'scheduled',revision:crypto.randomUUID(),claimed_at:null,updated_at:new Date().toISOString()};
      if(existing)check(await db.from('notes_reminders').update(values).eq('id',body.id).eq('user_id',owner));
      else check(await db.from('notes_reminders').insert({id:body.id,...values}));
      return reply({ok:true});
    }
    if(action==='delete'){check(await db.from('notes_reminders').update({status:'cancelled',hidden_at:new Date().toISOString(),revision:crypto.randomUUID(),updated_at:new Date().toISOString()}).eq('id',body.id).eq('user_id',owner));return reply({ok:true});}
    if(action==='cancel'||action==='complete'){
      check(await db.from('notes_reminders').update({status:action==='cancel'?'cancelled':'completed',revision:crypto.randomUUID(),updated_at:new Date().toISOString()}).eq('id',body.id).eq('user_id',owner));return reply({ok:true});
    }
    return reply({error:'Ação desconhecida.'},400);
  }catch{return reply({error:'Não foi possível concluir o pedido. Tente novamente.'},503);}
});

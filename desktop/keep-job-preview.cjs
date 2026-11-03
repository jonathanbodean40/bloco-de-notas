'use strict';
// Read-only verified PNG projection. No HTML execution, browser navigation,
// case-file reads, commands, publication, approval, or arbitrary renderer paths.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {TextDecoder}=require('node:util');
const ID=/^[a-f0-9]{32}$/;
const SHA=/^[a-f0-9]{64}$/;
const GUIDE=['GUIA.pptx','guide-1.png','guide-2.png','guide-native.json'];
const PRESENTATION=[...GUIDE,'ANTES E DEPOIS.pptx','comparison-1.png','comparison-native.json','movement-table.png','RELATORIO CLINICO.txt'];
const LABELS={'guide-1.png':'Guia — odontograma','guide-2.png':'Guia — relatório clínico',
 'comparison-1.png':'Antes/depois — resultado simulado','movement-table.png':'Tabela de movimentos'};
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');

async function noRedirects(target){
 let current=path.resolve(target);
 for(;;){
  const info=await fs.lstat(current);
  if(info.isSymbolicLink())throw Error('Redirected preview');
  const parent=path.dirname(current);
  if(parent===current)break;
  current=parent;
 }
}

async function readBounded(target,limit){
 await noRedirects(target);
 const before=await fs.lstat(target);
 if(!before.isFile()||before.size>limit)throw Error('Invalid preview size');
 const handle=await fs.open(target,'r');
 try{
  const opened=await handle.stat();
  if(!opened.isFile()||opened.ino!==before.ino||opened.dev!==before.dev||opened.size>limit)
   throw Error('Preview changed while opening');
  const bytes=Buffer.alloc(limit+1);
  let count=0;
  while(count<bytes.length){
   const {bytesRead}=await handle.read(bytes,count,bytes.length-count,count);
   if(!bytesRead)break;
   count+=bytesRead;
  }
  if(count>limit)throw Error('Preview exceeds limit');
  return bytes.subarray(0,count);
 }finally{await handle.close();}
}

async function objectAt(target){
 const bytes=await readBounded(target,512*1024);
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid preview record');
 return value;
}

async function getKeepJobPreview(agentRoot,jobsRoot,id){
 if(!path.isAbsolute(agentRoot)||!path.isAbsolute(jobsRoot)||typeof id!=='string'||!ID.test(id))
  throw Error('Pedido não autorizado');
 try{
  const result=await objectAt(path.join(agentRoot,'results',id+'.json'));
  const r=result.request, report=result.artifactReport;
  if(result.id!==id||result.state!=='awaiting_visual_review'||!r
     ||!['guide','presentation'].includes(r.mode)||typeof r.reference!=='string'
     ||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(r.reference)
     ||typeof r.version!=='string'||!r.version||r.version.length>160
     ||!report||report.verified!==true||report.nativeRendered!==true
     ||report.clinicalApproval!==false||report.publishingAuthorized!==false)
    throw Error('No verified preview');
  const required=r.mode==='guide'?GUIDE:PRESENTATION;
  if(!Array.isArray(report.files)||report.files.length!==required.length)throw Error('Incomplete output list');
  const records=new Map();
  for(const item of report.files){
   if(!item||!required.includes(item.name)||records.has(item.name)||!SHA.test(item.sha256||'')
      ||!Number.isSafeInteger(item.bytes)||item.bytes<=0)throw Error('Invalid output identity');
   records.set(item.name,item);
  }
  const slug=(r.reference+'-'+r.version).replace(/[^A-Za-z0-9_-]/g,'_');
  const expected=path.join(jobsRoot,slug);
  if(typeof report.jobDirectory!=='string'||!path.isAbsolute(report.jobDirectory))throw Error('Invalid job');
  await noRedirects(expected);
  await noRedirects(report.jobDirectory);
  if(await fs.realpath(expected)!==await fs.realpath(report.jobDirectory))throw Error('Wrong job directory');
  const receipt=await objectAt(path.join(expected,'receipt.json'));
  if(receipt.case_id!==r.reference||receipt.plan_id!==r.version||receipt.mode!==r.mode
     ||receipt.status!=='awaiting_visual_review'||receipt.native_rendered!==true
     ||receipt.visual_review_complete!==false||receipt.publication_authorized!==false
     ||!receipt.outputs||Object.keys(receipt.outputs).length!==required.length)
    throw Error('Wrong output receipt');
  for(const name of required)if(receipt.outputs[name]!==records.get(name).sha256)throw Error('Output receipt changed');
  const selected=r.mode==='guide'?['guide-1.png','guide-2.png']:
   ['guide-1.png','guide-2.png','comparison-1.png','movement-table.png'];
  const images=[];let total=0;
  for(const name of selected){
   const bytes=await readBounded(path.join(expected,name),16*1024*1024);
   const record=records.get(name);
   total+=bytes.length;
   if(total>32*1024*1024||record.bytes!==bytes.length||hash(bytes)!==record.sha256
      ||bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'
      ||bytes.subarray(12,16).toString('ascii')!=='IHDR')throw Error('Preview image changed');
   const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
   if(width<1||height<1||width>8192||height>8192||width*height>50000000)throw Error('Invalid image size');
   if(name==='comparison-1.png'&&(width!==3840||height!==2160))throw Error('Comparison is not 4K');
   images.push({name,label:LABELS[name],width,height,dataUrl:'data:image/png;base64,'+bytes.toString('base64')});
  }
  return {id,images,clinicalApproval:false,publishingAuthorized:false,
   message:'Prévia técnica. A revisão visual e clínica humana continua obrigatória.'};
 }catch{
  throw Error('Prévia indisponível ou ficheiros alterados. Verifique o pedido sem publicar.');
 }
}
module.exports={getKeepJobPreview};

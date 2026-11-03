'use strict';
// Synthetic preview fixture only; not evidence of a real native generation.
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPcsmULAwMDEwMDAwMDAwAZegIgI5cD+wAAAABJRU5ErkJggg==','base64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(file,data)=>fs.writeFile(file,JSON.stringify(data));
async function createPreviewFixture(base,id='b'.repeat(32),reference='SYNTHETIC-PREVIEW'){
 const agentRoot=path.join(base,'KeepAligner','LocalAgent');
 const jobsRoot=path.join(base,'KEEP ALIGNER GENERATOR','jobs');
 const version='SYNTHETIC-V1';
 const job=path.join(jobsRoot,reference+'-'+version);
 await fs.mkdir(job,{recursive:true});await fs.mkdir(path.join(agentRoot,'results'),{recursive:true});
 const files=[];
 for(const name of ['GUIA.pptx','guide-1.png','guide-2.png','guide-native.json']){
  const bytes=name.endsWith('.png')?PNG:Buffer.from('SYNTHETIC FIXTURE ONLY');
  await fs.writeFile(path.join(job,name),bytes);
  files.push({name,sha256:sha(bytes),bytes:bytes.length});
 }
 const receipt={case_id:reference,plan_id:version,mode:'guide',status:'awaiting_visual_review',
  native_rendered:true,visual_review_complete:false,publication_authorized:false,
  outputs:Object.fromEntries(files.map(f=>[f.name,f.sha256]))};
 const result={id,state:'awaiting_visual_review',message:'SYNTHETIC',request:{reference,version,mode:'guide',notes:'PRIVATE TEST FIELD'},
  artifactReport:{verified:true,nativeRendered:true,jobDirectory:job,files,clinicalApproval:false,publishingAuthorized:false},
  clinicalApproval:false,publishingAuthorized:false,stdoutTail:'PRIVATE TEST LOG'};
 const resultFile=path.join(agentRoot,'results',id+'.json'),receiptFile=path.join(job,'receipt.json');
 await save(resultFile,result);await save(receiptFile,receipt);
 return {id,agentRoot,jobsRoot,job,result,receipt,resultFile,receiptFile,save,PNG,sha};
}
module.exports={createPreviewFixture};

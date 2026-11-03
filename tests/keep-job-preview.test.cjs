'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {getKeepJobPreview}=require('../desktop/keep-job-preview.cjs');
const {createPreviewFixture}=require('./support/keep-preview-fixture.cjs');
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'keep-preview-synthetic-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=await createPreviewFixture(root);
 f.root=root;f.read=()=>getKeepJobPreview(f.agentRoot,f.jobsRoot,f.id);
 return f;
}

test('verified PNGs only, no case-file read, no paths/logs/approvals',async t=>{
 const f=await setup(t),r=await f.read();
 assert.equal(r.id,f.id);assert.equal(r.images.length,2);
 assert.equal(r.clinicalApproval,false);assert.equal(r.publishingAuthorized,false);
 assert(r.images.every(i=>i.dataUrl.startsWith('data:image/png;base64,')));
 assert.equal(r.images[0].width,2);
 const serialized=JSON.stringify(r);
 assert(!serialized.includes(f.root));assert(!serialized.includes('PRIVATE'));
 assert.equal(r.jobDirectory,undefined);assert.equal(r.request,undefined);
});

test('invalid ticket cannot select a file',async t=>{
 const f=await setup(t);
 await assert.rejects(getKeepJobPreview(f.agentRoot,f.jobsRoot,'../outside'),/não autorizado/);
});

test('absent result creates no queue or output',async t=>{
 const f=await setup(t);await fs.unlink(f.resultFile);
 await assert.rejects(f.read(),/Prévia indisponível/);
 assert.deepEqual(await fs.readdir(path.dirname(f.resultFile)),[]);
});

const resultMutations=[
 ['unfinished job',r=>{r.state='generating';}],
 ['different ticket',r=>{r.id='c'.repeat(32);}],
 ['wrong mode',r=>{r.request.mode='publish';}],
 ['wrong case',r=>{r.request.reference='OTHER';}],
 ['wrong plan',r=>{r.request.version='OTHER';}],
 ['unverified outputs',r=>{r.artifactReport.verified=false;}],
 ['no native rendering',r=>{r.artifactReport.nativeRendered=false;}],
 ['clinical approval flag',r=>{r.artifactReport.clinicalApproval=true;}],
 ['publication flag',r=>{r.artifactReport.publishingAuthorized=true;}],
 ['missing output',r=>{r.artifactReport.files.pop();}],
 ['duplicate output',r=>{r.artifactReport.files[1]={...r.artifactReport.files[2]};}],
 ['output traversal',r=>{r.artifactReport.files[1].name='../outside.png';}],
 ['invalid fingerprint',r=>{r.artifactReport.files[1].sha256='bad';}],
 ['invalid size',r=>{r.artifactReport.files[1].bytes=0;}]
];
for(const [name,mutate] of resultMutations)test('rejects '+name,async t=>{
 const f=await setup(t);mutate(f.result);await f.save(f.resultFile,f.result);
 await assert.rejects(f.read(),/Prévia indisponível/);
});

test('different job directory rejected',async t=>{
 const f=await setup(t);f.result.artifactReport.jobDirectory=f.root;
 await f.save(f.resultFile,f.result);await assert.rejects(f.read(),/Prévia indisponível/);
});

for(const [key,value] of [['case_id','OTHER'],['plan_id','OTHER'],['native_rendered',false],
 ['visual_review_complete',true],['publication_authorized',true]])test('rejects receipt '+key,async t=>{
 const f=await setup(t);f.receipt[key]=value;await f.save(f.receiptFile,f.receipt);
 await assert.rejects(f.read(),/Prévia indisponível/);
});

test('changed image rejected even when original receipt is intact',async t=>{
 const f=await setup(t);await fs.appendFile(path.join(f.job,'guide-1.png'),'changed');
 await assert.rejects(f.read(),/Prévia indisponível/);
});

test('changed fingerprint between result and receipt rejected',async t=>{
 const f=await setup(t);f.receipt.outputs['guide-1.png']='a'.repeat(64);
 await f.save(f.receiptFile,f.receipt);await assert.rejects(f.read(),/Prévia indisponível/);
});

test('non-PNG bytes rejected even with matching metadata',async t=>{
 const f=await setup(t),bytes=Buffer.from('not-a-png'.repeat(10));
 await fs.writeFile(path.join(f.job,'guide-1.png'),bytes);
 const item=f.result.artifactReport.files.find(x=>x.name==='guide-1.png');
 item.bytes=bytes.length;item.sha256=f.sha(bytes);f.receipt.outputs[item.name]=item.sha256;
 await f.save(f.resultFile,f.result);await f.save(f.receiptFile,f.receipt);
 await assert.rejects(f.read(),/Prévia indisponível/);
});

test('oversized result is rejected',async t=>{
 const f=await setup(t);await fs.writeFile(f.resultFile,'x'.repeat(512*1024+1));
 await assert.rejects(f.read(),/Prévia indisponível/);
});

test('symlink cannot supply preview image',async t=>{
 const f=await setup(t);const file=path.join(f.job,'guide-1.png');
 await fs.unlink(file);
 try{await fs.symlink(path.join(f.job,'guide-2.png'),file);}
 catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('Windows symlink permission unavailable');return;}throw e;}
 await assert.rejects(f.read(),/Prévia indisponível/);
});

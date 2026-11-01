'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const runner=path.join(root,'executor','agent.py');
const caseRoot=path.join(process.env.LOCALAPPDATA||path.join(process.env.USERPROFILE||process.cwd(),'AppData','Local'),'KeepAligner','LocalAgent');
const python=process.env.LOCAL_AGENT_PYTHON||'python';
const run=(args)=>spawnSync(python,[runner,...args],{cwd:root,encoding:'utf8',timeout:20000});
let r=run(['health']);
assert.equal(r.status,0,r.stderr);
const h=JSON.parse(r.stdout);
assert.equal(h.publishingEnabled,false);assert.equal(h.automaticCodexCalls,false);
let invalid=run(['enqueue','--request',path.join(root,'tests','fixtures','not-existing-request.json')]);
assert.notEqual(invalid.status,0);
const temp=path.join(process.env.TEMP||'.','keep-agent-test-'+Date.now()+'.json');
try{
 fs.writeFileSync(temp,JSON.stringify({mode:'guide',reference:'../../etc/passwd',notes:'x'}));
 // A reference cannot be used as a path because it is never interpolated into command arguments.
 r=run(['enqueue','--request',temp]);
 assert.equal(r.status,0,r.stderr);
 const ticket=JSON.parse(r.stdout).id;assert(/^[a-f0-9]{32}$/.test(ticket));
 r=run(['once']);assert.equal(r.status,0,r.stderr);
 const output=JSON.parse(r.stdout).find(e=>e.id===ticket);
 assert(output);assert.equal(output.state,'awaiting_case_data');
 const result=path.join(caseRoot,'results',ticket+'.json');
 assert(fs.existsSync(result));fs.unlinkSync(result);
 console.log('PASS: agent health, strict commands, isolated queue, no unintended generator invocation or publishing.');
}finally{try{fs.unlinkSync(temp)}catch{}}

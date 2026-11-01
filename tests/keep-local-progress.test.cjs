'use strict';
const assert=require('node:assert/strict');
const {localStatus}=require('../keep-aligner-tool.js');
for(const state of ['queued','validating_sources','generating','validating_outputs']){
 const item=localStatus({state,progress:{step:2,total:3}});
 assert.equal(item.pending,true);
 assert.match(item.message,/Etapa 2\/3/);
 assert.equal(item.clinicalApproval,false);
 assert.equal(item.publishingAuthorized,false);
}
for(const state of ['blocked','awaiting_verified_sources','awaiting_case_data','awaiting_visual_review'])
 assert.equal(localStatus({state}).pending,false);
const done=localStatus({state:'awaiting_visual_review',artifactCount:9,clinicalApproval:true,publishingAuthorized:true});
assert.match(done.message,/9 ficheiros verificados/);
assert.match(done.message,/Revisão humana obrigatória/);
assert.equal(done.clinicalApproval,false);
assert.equal(done.publishingAuthorized,false);
assert.doesNotMatch(localStatus({state:'generating',progress:{step:99,total:3}}).message,/Etapa/);
assert.doesNotMatch(localStatus({state:'blocked',artifactCount:9}).message,/ficheiros verificados/);
console.log('PASS: progress states never imply completion, clinical approval or publication.');

'use strict';
// Prepare a verified ASAR hotfix without changing the installed app or user data.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const asar=require('@electron/asar');
const repo=path.resolve(__dirname,'..');
const extract=(archive,name)=>asar.extractFile(archive,path.normalize(name));
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const filesIn=archive=>asar.listPackage(archive).map(p=>p.replace(/^[/\\]/,'').replaceAll('\\','/'))
 .filter(p=>!asar.statFile(archive,path.normalize(p)).files);
const replacements=new Map([
 ['desktop/main.cjs','desktop/main.cjs'],
 ['desktop/preload.cjs','desktop/preload.cjs'],
 ['desktop/keep-job-status.cjs','desktop/keep-job-status.cjs'],
 ['www/keep-aligner-tool.js','keep-aligner-tool.js']
]);
async function prepare(installed){
 if(!path.isAbsolute(installed))throw Error('An absolute installed archive path is required');
 const info=fs.lstatSync(installed);
 if(!info.isFile()||info.isSymbolicLink())throw Error('Installed archive must be a regular file');
 const before=sha(fs.readFileSync(installed));
 const executable=path.join(path.dirname(path.dirname(installed)),'Bloco de Notas Pro.exe');
 const fuses=require('@electron/fuses');
 const wire=await fuses.getCurrentFuseWire(executable);
 // Never change native integrity fuses. A hardened build needs a full signed rebuild.
 if(wire.version!=='1'||wire[fuses.FuseV1Options.EnableEmbeddedAsarIntegrityValidation]!==48)
  throw Error('Native integrity is enabled or unknown: ASAR-only update not permitted');
 const executableSha256=sha(fs.readFileSync(executable));
 const original=filesIn(installed);
 for(const name of original){
  const entry=asar.statFile(installed,path.normalize(name));
  if(entry.link||name.includes('..')||name.includes(':')||path.isAbsolute(name))
   throw Error('Unsupported archive entry');
 }
 const packageInfo=JSON.parse(extract(installed,'package.json').toString('utf8'));
 if(packageInfo.name!=='bloco-de-notas-pro'||packageInfo.main!=='desktop/main.cjs')
  throw Error('This is not the expected application');
 // Keep the deployed notes, sync and authentication code exactly as installed.
 for(const [inside,source] of [['www/app.js','app.js'],['www/config.js','config.js'],['www/private-access.js','private-access.js']]){
  if(!extract(installed,inside).equals(fs.readFileSync(path.join(repo,source))))
   throw Error('Installed application has independent changes: automatic update stopped');
 }
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
 const runtime=path.join(repo,'.runtime');fs.mkdirSync(runtime,{recursive:true});
 const root=fs.mkdtempSync(path.join(runtime,'desktop-workflow-update-'));
 const unpacked=path.join(root,'package');fs.mkdirSync(unpacked);
 asar.extractAll(installed,unpacked);
 for(const [inside,source] of replacements){
  const target=path.join(unpacked,inside);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(path.join(repo,source),target);
 }
 const candidate=path.join(root,'app.asar');
 await asar.createPackage(unpacked,candidate);
 const outputFiles=filesIn(candidate);
 const expected=new Set([...original,...replacements.keys()]);
 if(outputFiles.length!==expected.size||outputFiles.some(p=>!expected.has(p)))
  throw Error('Unexpected package contents');
 const changed=[];
 for(const name of outputFiles){
  const actual=extract(candidate,name);
  if(replacements.has(name)){
   if(!actual.equals(fs.readFileSync(path.join(repo,replacements.get(name)))))
    throw Error('Packaged workflow file differs from source');
   if(!original.includes(name)||!actual.equals(extract(installed,name)))changed.push(name);
  }else if(!actual.equals(extract(installed,name))){
   throw Error('An unrelated application resource changed');
  }
 }
 if(sha(fs.readFileSync(installed))!==before)throw Error('Installed archive changed during preparation');
 const manifest={schema:1,preparedAt:new Date().toISOString(),revision,
  installedArchive:installed,installedVersion:packageInfo.version,originalSha256:before,
  executable,executableSha256,nativeAsarIntegrityDisabled:true,nativeFusesModified:false,
  candidateArchive:candidate,candidateSha256:sha(fs.readFileSync(candidate)),
  totalFiles:outputFiles.length,changedFiles:changed,
  unrelatedResourcesPreserved:true,userProfileAccessed:false,installed:false,
  clinicalCollectionEnabled:false,clinicalApproval:false,publishingAuthorized:false};
 const manifestPath=path.join(root,'preparation.json');
 fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{flag:'wx'});
 console.log(JSON.stringify({...manifest,manifestPath},null,2));
 return manifest;
}
if(require.main===module){
 const archive=process.argv[2];
 if(!archive){console.error('Usage: node prepare-desktop-workflow-update.cjs ABSOLUTE_APP_ASAR');process.exitCode=2;}
 else prepare(archive).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={prepare};

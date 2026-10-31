import fs from 'node:fs';
import path from 'node:path';
const required=['index.html','private-access.js','app.js','config.js'];
for(const file of required){if(!fs.existsSync(file))throw Error('Em falta: '+file);}
const files=['app.js','private-access.js','config.js','service-worker.js','desktop/main.cjs','capacitor.config.json','scripts/stage-web.mjs'];
for(const file of files){const content=fs.readFileSync(file,'utf8');if(/api\.openai\.com|chatgpt\.com\/backend-api|dropbox\.com\/oauth2|Dropbox\.filesUpload/i.test(content))throw Error('Dependência proibida encontrada em '+file);}
console.log('Sem dependências diretas conhecidas de ChatGPT/OpenAI API ou armazenamento Dropbox nos ficheiros críticos.');

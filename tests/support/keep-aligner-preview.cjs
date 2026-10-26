'use strict';
// Loopback-only preview. The real auth/config files and private notes are never served.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bootstrap = path.join(__dirname, 'keep-aligner-preview-bootstrap.js');
const allowed = new Set([
  'index.html','app.js','style.css','keep-aligner-tool.css','keep-aligner-tool.js',
  'dropbox-feedback.css','notes-extras.css','dropbox-storage.js','dropbox-token-vault.js',
  'dropbox-oauth.js','dropbox-primary.js','note-export.js','dropbox-ui.js',
  'icon.svg','manifest.webmanifest','spell-worker.js','service-worker.js'
]);
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
function start(port = 4397) {
  const server = http.createServer((req,res) => {
    if (!['GET','HEAD'].includes(req.method)) return res.writeHead(405).end();
    let file;
    try { file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html'; }
    catch { return res.writeHead(400).end(); }
    let bytes;
    if (file === 'config.js') bytes = 'window.NOTAS_CONFIG={preview:true};';
    else if (file === 'private-access.js') bytes = fs.readFileSync(bootstrap);
    else if (file === 'vendor/supabase-js-v2.js') bytes = '/* No backend in local preview. */';
    else if (allowed.has(file)) bytes = fs.readFileSync(path.join(root,file));
    else return res.writeHead(404).end();
    res.setHeader('Content-Type', `${types[path.extname(file)] || 'text/plain'}; charset=utf-8`);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; form-action 'self'");
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
module.exports = {start};
if (require.main === module) start().then(() => console.log('PREVIA LOCAL: http://127.0.0.1:4397/?tool=keep'));

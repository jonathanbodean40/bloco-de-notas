import {build} from 'esbuild';
await build({entryPoints:['native/auth-bridge.js'],bundle:true,platform:'browser',format:'iife',target:'es2022',outfile:'native-auth.js',logLevel:'warning'});
console.log('Native OAuth bridge built');

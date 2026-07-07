'use strict';
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'ui/vendor/editorjs');
fs.mkdirSync(out, {recursive:true});
esbuild.buildSync({entryPoints:[path.join(__dirname,'entry.js')],bundle:true,minify:true,format:'iife',globalName:'NoteStationBlocks',target:'chrome100',outfile:path.join(out,'editorjs.bundle.js'),legalComments:'linked'});
esbuild.buildSync({stdin:{contents:"export {parseFragment} from 'parse5';",resolveDir:__dirname,sourcefile:'html-parser.js'},bundle:true,minify:true,format:'esm',target:'chrome100',outfile:path.join(out,'html-parser.js'),legalComments:'linked'});
const lock = JSON.parse(fs.readFileSync(path.join(__dirname,'package-lock.json'),'utf8'));
const supplemental = JSON.parse(fs.readFileSync(path.join(__dirname,'licenses/sources.json'),'utf8'));
const licenses=[];
for (const [location,record] of Object.entries(lock.packages)) {
  if (!location || record.dev) continue;
  const dir=path.join(__dirname,location);
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const file=fs.readdirSync(dir).find(n=>/^licen[cs]e(?:\.|$)/i.test(n));
  const fallback=supplemental[pkg.name+'@'+pkg.version];
  if (!file&&!fallback) throw Error('Missing license: '+location);
  const license=file?fs.readFileSync(path.join(dir,file),'utf8'):fs.readFileSync(path.join(__dirname,'licenses',fallback.file),'utf8');
  licenses.push(`\n===== ${pkg.name} ${pkg.version} (${pkg.license}) =====\n\n${license}`);
}
fs.writeFileSync(path.join(out,'LICENSES.txt'),licenses.join('\n'));
console.log('Built local Editor.js and HTML parser bundles with dependency licenses.');

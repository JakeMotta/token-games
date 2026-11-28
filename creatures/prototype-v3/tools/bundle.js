// Inline version 3's scripts (its own, and the ones it shares from ../prototype and ../prototype-v2) into one
// self-contained HTML file that opens straight from disk or as an artifact. Links to the other versions point at their
// standalone files.
// Usage: node tools/bundle.js [out.html]   (default: creatures-v3-standalone.html next to index.html)
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(dir, 'creatures-v3-standalone.html'));
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<script src="((?:\.\.\/prototype(?:-v2)?\/)?[\w.-]+\.js)"><\/script>/g, (_, file) =>
  '<script>\n' + fs.readFileSync(path.join(dir, file), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
if (/<script src=/.test(html)) throw new Error('a script was not inlined');
html = html.replace('href="../prototype/index.html"', 'href="../prototype/creatures-standalone.html"')
  .replace('href="../prototype-v2/index.html"', 'href="../prototype-v2/creatures-v2-standalone.html"');
fs.writeFileSync(out, html);
console.log('wrote', out, Math.round(html.length / 1024) + ' KB');

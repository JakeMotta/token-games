// Inline the page's scripts into one self-contained HTML file that opens straight from disk or as an artifact.
// Usage: node tools/bundle.js [out.html]   (default: creatures-standalone.html next to index.html)
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(dir, 'creatures-standalone.html'));
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<script src="([\w.-]+\.js)"><\/script>/g, (_, file) =>
  '<script>\n' + fs.readFileSync(path.join(dir, file), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
if (/<script src=/.test(html)) throw new Error('a script was not inlined');
fs.writeFileSync(out, html);
console.log('wrote', out, Math.round(html.length / 1024) + ' KB');

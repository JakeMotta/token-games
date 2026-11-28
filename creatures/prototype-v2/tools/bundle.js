// Inline version 2's scripts (its own and the ones it shares from ../prototype) into one self-contained HTML file that
// opens straight from disk or as an artifact, and the same for the compare lab. Links to the other versions point at
// their standalone files.
// Usage: node tools/bundle.js [out.html]   (default: creatures-v2-standalone.html next to index.html, and
// creatures-compare-standalone.html next to compare.html)
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const STANDALONE = [['../prototype/index.html', '../prototype/creatures-standalone.html'],
  ['../prototype-v3/index.html', '../prototype-v3/creatures-v3-standalone.html']];

function bundle(page, out, links) {
  let html = fs.readFileSync(path.join(dir, page), 'utf8');
  html = html.replace(/<script src="((?:\.\.\/prototype(?:-v\d)?\/)?[\w.-]+\.js)"><\/script>/g, (_, file) =>
    '<script>\n' + fs.readFileSync(path.join(dir, file), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
  if (/<script src=/.test(html)) throw new Error('a script was not inlined in ' + page);
  for (const [from, to] of links) html = html.split(from).join(to);
  fs.writeFileSync(out, html);
  console.log('wrote', out, Math.round(html.length / 1024) + ' KB');
}

bundle('index.html', path.resolve(process.argv[2] || path.join(dir, 'creatures-v2-standalone.html')), STANDALONE.slice(0, 1));
if (!process.argv[2]) bundle('compare.html', path.join(dir, 'creatures-compare-standalone.html'),
  [...STANDALONE, ["'index.html?seed=", "'creatures-v2-standalone.html?seed="]]);

const fs = require('fs');
process.chdir('/workspace');
const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('app.js', 'utf8');
const ids = new Set([...html.matchAll(/id=["']([^"']+)["']/g)].map(m => m[1]));
const refs = [...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
const missing = refs.filter(r => !ids.has(r));
console.log('missing ids:', missing);
const defs = new Set([...js.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
const consts = new Set([...js.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
const calls = new Set([...js.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]));
const kw = new Set(['if','for','while','switch','catch','return','typeof','new','Set','Map','parseInt','parseFloat','isNaN','setTimeout','setInterval','clearInterval','clearTimeout','fetch','alert','confirm','prompt','encodeURIComponent','decodeURIComponent','btoa','atob','TextEncoder','Blob','URLSearchParams','DOMParser','Date','Promise','Error','RegExp','Boolean','Array','Object','JSON','Math','String','Number']);
const undef = [...calls].filter(c => !defs.has(c) && !consts.has(c) && !kw.has(c));
console.log('possibly undefined calls:', undef);
// check HTML inline scripts referencing functions
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
console.log('inline script length:', inline.length);

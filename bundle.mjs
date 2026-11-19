// Junta os módulos ES do projeto em UM arquivo HTML que abre direto no Chrome (file://).
// uso: node bundle.mjs <pasta-do-projeto> <saida.html>
import fs from 'fs';
import path from 'path';

const dir = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// ---- 1. grafo de módulos a partir de app.js ----
const order = [];
const seen = new Set();
const deps = (src) => [...src.matchAll(/from\s+'\.\/([^']+)'/g)].map((m) => m[1]);
function visit(f) {
  if (seen.has(f)) return;
  seen.add(f);
  for (const d of deps(read(f))) visit(d);
  order.push(f);
}
visit('app.js');

// ---- 2. transforma cada módulo em função com seu objeto de exportações ----
function transform(f) {
  let s = read(f);
  const exportsList = [];
  // import { a, b as c } from './x.js';
  s = s.replace(/import\s*\{([^}]*)\}\s*from\s*'\.\/([^']+)';?/g, (_, names, mod) => {
    const parts = names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ': '));
    return `const { ${parts.join(', ')} } = __m['${mod}'];`;
  });
  // import * as ns from './x.js';
  s = s.replace(/import\s*\*\s*as\s+(\w+)\s+from\s*'\.\/([^']+)';?/g, (_, ns, mod) => `const ${ns} = __m['${mod}'];`);
  if (/^\s*import\s/m.test(s)) throw new Error(`import não tratado em ${f}`);
  // export default
  if (/export\s+default/.test(s)) throw new Error(`export default não tratado em ${f}`);
  // export { A, B as C };
  s = s.replace(/export\s*\{([^}]*)\};?/g, (_, names) => {
    for (const n of names.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [local, ext] = n.split(/\s+as\s+/);
      exportsList.push([ext || local, local]);
    }
    return '';
  });
  // export const/let/var/function/class
  s = s.replace(/^export\s+(async\s+function\*?|function\*?|const|let|var|class)\s+(\w+)/gm, (_, kind, name) => {
    exportsList.push([name, name]);
    return `${kind} ${name}`;
  });
  if (/^export\s/m.test(s)) throw new Error(`export não tratado em ${f}`);
  const ret = exportsList.map(([e, l]) => (e === l ? e : `${e}: ${l}`)).join(', ');
  return `__m['${f}'] = (function () {\n'use strict';\n${s}\nreturn { ${ret} };\n})();`;
}

let js = '(function () {\n"use strict";\nconst __m = {};\n' + order.map(transform).join('\n') + '\n})();';

// ---- 3. recursos embutidos ----
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`;
const iconUri = dataUri('bolt-icon.svg', 'image/svg+xml');
js = js.replaceAll("'bolt-icon.svg'", JSON.stringify(iconUri));
js = js.replace(/<\/script/gi, '<\\/script');

let css = read('styles.css') + '\n' + read('cockpit.css') + '\n' + read('standby.css');
let html = read('index.html');
html = html
  .replace(/<link rel="stylesheet" href="styles.css">\s*<link rel="stylesheet" href="cockpit.css">\s*<link rel="stylesheet" href="standby.css">/, () => `<style>\n${css}\n</style>`)
  .replace('<link rel="icon" href="favicon.svg" type="image/svg+xml">', `<link rel="icon" href="${dataUri('favicon.svg', 'image/svg+xml')}" type="image/svg+xml">`)
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/, '')
  .replace(/<link rel="manifest"[^>]*>\s*/, '')
  .replace('src="bolt-icon.svg"', `src="${iconUri}"`)
  .replace('<script type="module" src="app.js"></script>', () => `<script>\n${js}\n</script>`);

fs.writeFileSync(out, html);
console.log(`ok: ${order.length} módulos → ${out} (${(html.length / 1024).toFixed(0)} KB)`);

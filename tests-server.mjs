/** Testes do servidor (server.js): estáticos, segurança, proxy de IA e ponte Wi-Fi com adaptador TCP falso. */
import http from 'node:http';
import net from 'node:net';
import { createBoltServer, isPrivateTarget } from './server.js';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const close = (srv) => new Promise((r) => srv.close(() => r()));

export function serverTests({ test, assert, tick }) {
  const start = async (env = {}, fetchFn) => {
    const { server, info } = createBoltServer({ env: { HOST: '127.0.0.1', ...env }, fetchFn });
    const port = await listen(server);
    return { server, info, base: `http://127.0.0.1:${port}` };
  };
  const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  test('Servidor: entrega index.html e bloqueia arquivos privados, ocultos, subpastas e traversal', async () => {
    const s = await start();
    try {
      assert.equal((await fetch(`${s.base}/`)).status, 200);
      const html = await fetch(`${s.base}/index.html`);
      assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
      assert.equal((await fetch(`${s.base}/app.js`)).status, 200);
      for (const p of ['/server.js', '/package.json', '/.env', '/tests.mjs', '/README.md', '/Dockerfile', '/..%2fserver.js', '/%2e%2e/etc/passwd', '/a/b.js', '/%00.js']) {
        const r = await fetch(`${s.base}${p}`);
        assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
      }
    } finally { await close(s.server); }
  });

  test('Servidor: /api/health não expõe segredos e informa estado da IA e da ponte', async () => {
    const s = await start({ AI_API_KEY: 'sk-secret', BRIDGE_TOKEN: 'tok' });
    try {
      const txt = await (await fetch(`${s.base}/api/health`)).text();
      assert.ok(!txt.includes('sk-secret') && !txt.includes('tok"'));
      const j = JSON.parse(txt);
      assert.equal(j.ai, true); assert.equal(j.wifiBridge, true);
    } finally { await close(s.server); }
  });

  test('IA: sem chave retorna ai_not_configured', async () => {
    const s = await start();
    try {
      const r = await post(`${s.base}/api/assistant`, { messages: [{ role: 'user', content: 'oi' }] });
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error, 'ai_not_configured');
    } finally { await close(s.server); }
  });

  test('IA (Anthropic): monta prompt com regras, envia chave só no servidor e valida entrada', async () => {
    let seen;
    const fetchFn = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Tudo certo.' }] }), { status: 200 }); };
    const s = await start({ AI_API_KEY: 'sk-secret' }, fetchFn);
    try {
      const r = await post(`${s.base}/api/assistant`, { messages: [{ role: 'assistant', content: 'x' }, { role: 'user', content: 'Como está?' }], context: { dados_ao_vivo: { speed: { valor: 50 } } }, persona: { name: 'BOLT', personality: 'fun', level: 'minimal' } });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.reply, 'Tudo certo.');
      assert.ok(!JSON.stringify(j).includes('sk-secret'));
      assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
      assert.equal(seen.init.headers['x-api-key'], 'sk-secret');
      assert.equal(seen.body.messages[0].role, 'user');
      assert.match(seen.body.system, /Nunca invente/);
      assert.match(seen.body.system, /"speed"/);
      assert.equal((await post(`${s.base}/api/assistant`, { messages: [] })).status, 400);
      assert.equal((await post(`${s.base}/api/assistant`, { messages: [{ role: 'user', content: 'a'.repeat(1) }], context: 'x' })).status, 200);
    } finally { await close(s.server); }
  });

  test('IA (compatível com OpenAI): usa AI_BASE_URL e AI_MODEL; erro do provedor vira upstream_error', async () => {
    let url; let fail = false;
    const fetchFn = async (u) => { url = u; return fail ? new Response('x', { status: 500 }) : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }); };
    const s = await start({ AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm1', AI_BASE_URL: 'http://llm.local/v1/' }, fetchFn);
    try {
      assert.equal((await (await post(`${s.base}/api/assistant`, { messages: [{ role: 'user', content: 'oi' }] })).json()).reply, 'ok');
      assert.equal(url, 'http://llm.local/v1/chat/completions');
      fail = true;
      const r = await post(`${s.base}/api/assistant`, { messages: [{ role: 'user', content: 'oi' }] });
      assert.equal(r.status, 502); assert.equal((await r.json()).error, 'upstream_error');
    } finally { await close(s.server); }
  });

  test('IA: limite de requisições, corpo grande e CORS', async () => {
    const fetchFn = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
    const s = await start({ AI_API_KEY: 'k', AI_RATE_LIMIT_PER_MIN: '2', ALLOWED_ORIGINS: 'https://meu.github.io' }, fetchFn);
    try {
      const q = () => post(`${s.base}/api/assistant`, { messages: [{ role: 'user', content: 'oi' }] });
      assert.equal((await q()).status, 200); assert.equal((await q()).status, 200);
      assert.equal((await q()).status, 429);
      const big = await fetch(`${s.base}/api/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(70000) }) }).catch(() => ({ status: 413 }));
      assert.ok([413, 429].includes(big.status));
      const ok = await fetch(`${s.base}/api/health`, { headers: { Origin: 'https://meu.github.io' } });
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://meu.github.io');
      assert.equal((await fetch(`${s.base}/api/health`, { headers: { Origin: 'https://mal.example' } })).status, 403);
    } finally { await close(s.server); }
  });

  test('Ponte Wi-Fi: alvo precisa ser rede privada; exige token fora de localhost', async () => {
    assert.ok(isPrivateTarget('192.168.0.10') && isPrivateTarget('10.1.2.3') && isPrivateTarget('172.20.0.5'));
    assert.ok(!isPrivateTarget('8.8.8.8') && !isPrivateTarget('127.0.0.1') && !isPrivateTarget('localhost') && !isPrivateTarget('192.168.0.999'));
    const s = await start();
    try {
      const r = await post(`${s.base}/api/obd/wifi/connect`, { host: '8.8.8.8', port: 35000 });
      assert.equal(r.status, 400); assert.equal((await r.json()).error, 'target_not_allowed');
    } finally { await close(s.server); }
    const open = createBoltServer({ env: { HOST: '0.0.0.0' } });
    assert.equal(open.info.bridgeEnabled, false);
    assert.equal(createBoltServer({ env: { HOST: '0.0.0.0', BRIDGE_TOKEN: 't' } }).info.bridgeEnabled, true);
    const s2 = await start({ BRIDGE_TOKEN: 'segredo' });
    try {
      assert.equal((await post(`${s2.base}/api/obd/wifi/connect`, { host: '192.168.0.10', port: 1 })).status, 401);
      assert.equal((await post(`${s2.base}/api/obd/wifi/connect`, { host: '192.168.0.10', port: 1 }, { Authorization: 'Bearer errado' })).status, 401);
    } finally { await close(s2.server); }
  });

  test('Ponte Wi-Fi: fluxo completo com adaptador ELM327 TCP falso (connect, write, stream SSE, disconnect)', async () => {
    const elm = net.createServer((sk) => { sk.on('data', (d) => { const c = d.toString().trim(); sk.write(c === 'ATZ' ? 'ELM327 v1.5\r\r>' : `${c}\r41 0C 1A F8\r\r>`); }); });
    await new Promise((r) => elm.listen(0, '127.0.0.1', r));
    const elmPort = elm.address().port;
    const { server } = createBoltServer({ env: { HOST: '127.0.0.1', BRIDGE_TOKEN: 'tk' }, allowTarget: (h) => h === '127.0.0.1' });
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const H = { Authorization: 'Bearer tk' };
    try {
      const c = await post(`${base}/api/obd/wifi/connect`, { host: '127.0.0.1', port: elmPort }, H);
      assert.equal(c.status, 200);
      const { sid } = await c.json();
      assert.match(sid, /^[0-9a-f]{32}$/);
      const ctl = new AbortController();
      const stream = await fetch(`${base}/api/obd/wifi/stream?sid=${sid}`, { headers: H, signal: ctl.signal });
      assert.equal(stream.status, 200);
      assert.match(stream.headers.get('content-type'), /event-stream/);
      assert.equal((await post(`${base}/api/obd/wifi/write`, { sid, data: '010C\r' }, H)).status, 200);
      assert.equal((await post(`${base}/api/obd/wifi/write`, { sid, data: 'rm -rf /;\x00' }, H)).status, 400);
      const reader = stream.body.getReader();
      let acc = '';
      const dec = new TextDecoder();
      const t0 = Date.now();
      while (!acc.includes('41 0C') && Date.now() - t0 < 3000) { const { value, done } = await reader.read(); if (done) break; acc += dec.decode(value); }
      assert.ok(acc.includes('41 0C 1A F8'), acc);
      assert.equal((await post(`${base}/api/obd/wifi/disconnect`, { sid }, H)).status, 200);
      ctl.abort();
      assert.equal((await post(`${base}/api/obd/wifi/write`, { sid, data: 'ATZ\r' }, H)).status, 404);
      // recusa porta fechada com erro amigável
      const bad = await post(`${base}/api/obd/wifi/connect`, { host: '127.0.0.1', port: 1 }, H);
      assert.equal(bad.status, 502);
    } finally { await close(server); elm.close(); }
  });
}

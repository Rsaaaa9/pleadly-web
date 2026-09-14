// Pleadly 付费后端（Cloudflare Worker）
// 职责：
//   1) 代理 DeepSeek —— 你的 key 藏在环境变量里，买家永远接触不到
//   2) 服务端积分账本 —— 余额/扣分/赠送，不再信任浏览器 localStorage
//   3) 兑换码 —— 服务端生成、校验、单次使用
//   4) 会话(session) —— 一个功能扣一次分，该功能内部的多次 LLM 调用走同一会话
//
// 环境变量（用 wrangler secret put 设置，切勿写进代码/仓库）：
//   DEEPSEEK_API_KEY   你的 DeepSeek key
//   ADMIN_SECRET       管理接口密钥（生成兑换码用）
// KV 命名空间绑定名：PLEADLY_KV

const DEEPSEEK_BASE = 'https://api.deepseek.com';
const MODEL = 'deepseek-chat';
const FREE_STARTER = 0;         // 新设备赠送积分（0=不赠送，防换设备ID刷）
const MAX_OUT_TOKENS = 8192;
const SESSION_TTL = 30 * 60;    // 会话有效期（秒）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去 I/O/0/1 防混淆

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// 一次扣分对应的最大调用次数：低价功能限制调用数，防止拿 1 分连刷多次长输出
function budgetFor(cost) {
  return Math.min(30, Math.max(3, Math.round(cost * 3)));
}

function randId(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

function randCode() {
  return 'PLD-' + randId(8) + '-' + randId(8);
}

async function getBalance(env, deviceId) {
  const raw = await env.PLEADLY_KV.get('user:' + deviceId);
  if (raw !== null) return parseInt(raw, 10);
  await env.PLEADLY_KV.put('user:' + deviceId, String(FREE_STARTER));
  return FREE_STARTER;
}
async function setBalance(env, deviceId, bal) {
  await env.PLEADLY_KV.put('user:' + deviceId, String(bal));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const path = url.pathname;

    // 1) 查余额
    if (path === '/points' && request.method === 'GET') {
      const deviceId = (url.searchParams.get('deviceId') || '').toString().slice(0, 64);
      if (!deviceId) return json({ error: 'missing deviceId' }, 400);
      return json({ balance: await getBalance(env, deviceId) });
    }

    // 2) 兑换码
    if (path === '/redeem' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const deviceId = (body.deviceId || '').toString().slice(0, 64);
      const code = (body.code || '').trim().toUpperCase();
      if (!deviceId || !code) return json({ error: 'missing fields' }, 400);
      const rec = await env.PLEADLY_KV.get('code:' + code);
      if (!rec) return json({ error: 'invalid' }, 404);
      const parsed = JSON.parse(rec);
      if (parsed.used) return json({ error: 'used' }, 409);
      parsed.used = true;
      await env.PLEADLY_KV.put('code:' + code, JSON.stringify(parsed));
      const bal = await getBalance(env, deviceId);
      const newBal = bal + parsed.points;
      await setBalance(env, deviceId, newBal);
      return json({ added: parsed.points, balance: newBal });
    }

    // 3) 开会话（一次功能扣一次分）
    if (path === '/session' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const deviceId = (body.deviceId || '').toString().slice(0, 64);
      const cost = Math.max(0, parseInt(body.cost || '0', 10) || 0);
      if (!deviceId) return json({ error: 'missing deviceId' }, 400);
      const bal = await getBalance(env, deviceId);
      if (bal < cost) return json({ error: 'no_points' }, 402);
      await setBalance(env, deviceId, bal - cost);
      const sessionId = randId(24);
      await env.PLEADLY_KV.put('session:' + sessionId, JSON.stringify({
        deviceId, budget: budgetFor(cost), expires: Date.now() + SESSION_TTL * 1000,
      }), { expirationTtl: SESSION_TTL });
      return json({ sessionId, balance: bal - cost });
    }

    // 4) LLM 代理（凭会话）
    if (path === '/chat/completions' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const sessionId = (body.sessionId || '').toString();
      const messages = body.messages;
      if (!sessionId || !Array.isArray(messages) || !messages.length) return json({ error: 'missing fields' }, 400);
      const raw = await env.PLEADLY_KV.get('session:' + sessionId);
      if (!raw) return json({ error: 'session_expired' }, 401);
      const sess = JSON.parse(raw);
      if (Date.now() > sess.expires) return json({ error: 'session_expired' }, 401);
      if (sess.budget <= 0) return json({ error: 'session_depleted' }, 402);
      sess.budget -= 1;
      await env.PLEADLY_KV.put('session:' + sessionId, JSON.stringify(sess), { expirationTtl: SESSION_TTL });

      const upstream = await fetch(DEEPSEEK_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.DEEPSEEK_API_KEY },
        body: JSON.stringify({ model: MODEL, messages: messages, temperature: 0.3, max_tokens: MAX_OUT_TOKENS }),
      });
      if (!upstream.ok) {
        // 上游失败：退回这次额度，让用户能重试
        sess.budget += 1;
        await env.PLEADLY_KV.put('session:' + sessionId, JSON.stringify(sess), { expirationTtl: SESSION_TTL });
        const txt = await upstream.text();
        return json({ error: 'upstream ' + upstream.status, detail: txt.slice(0, 300) }, 502);
      }
      const data = await upstream.json();
      const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return json({ content });
    }

    // 5a) 管理：列出全部兑换码 + 状态（用 X-Admin-Secret 保护）
    if (path === '/admin/codes' && request.method === 'GET') {
      const secret = request.headers.get('X-Admin-Secret') || '';
      if (secret !== env.ADMIN_SECRET) return json({ error: 'forbidden' }, 403);
      const codes = [];
      let cursor;
      do {
        const list = await env.PLEADLY_KV.list({ prefix: 'code:', cursor });
        for (const key of list.keys) {
          const code = key.name.slice(5); // 去掉 'code:' 前缀
          let used = false, points = 0;
          const raw = await env.PLEADLY_KV.get(key.name);
          try { const p = JSON.parse(raw); used = !!p.used; points = p.points || 0; } catch (e) {}
          codes.push({ code, points, used });
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);
      codes.sort((a, b) => (a.code < b.code ? -1 : 1));
      return json({ codes });
    }

    // 5b) 管理：生成兑换码（用 X-Admin-Secret 保护）
    if (path === '/admin/codes' && request.method === 'POST') {
      const secret = request.headers.get('X-Admin-Secret') || '';
      if (secret !== env.ADMIN_SECRET) return json({ error: 'forbidden' }, 403);
      const body = await request.json().catch(() => ({}));
      const count = Math.max(1, Math.min(500, parseInt(body.count || '1', 10) || 1));
      const points = Math.max(1, parseInt(body.points || '100', 10) || 100);
      const codes = [];
      for (let i = 0; i < count; i++) {
        const c = randCode();
        await env.PLEADLY_KV.put('code:' + c, JSON.stringify({ points, used: false }));
        codes.push(c);
      }
      return json({ points, count, codes });
    }

    return json({ error: 'not found' }, 404);
  },
};

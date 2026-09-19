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
const MODEL = 'deepseek-v4-pro';
const FREE_STARTER = 0;         // 新用户免费试用积分（0=不赠送，防反复注册刷积分）
const MAX_OUT_TOKENS = 16384;
const SESSION_TTL = 30 * 60;    // 会话有效期（秒）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去 I/O/0/1 防混淆
const DEFAULT_POINTS = 50;   // 自动补码默认面额（对应 ¥25=50 档，最小面额）
const MIN_FRESH = 5;         // 新鲜码低于此数时自动补齐
const REFILL_TARGET = 20;    // 补齐到的新鲜码数量
const FREE_TTL = 7 * 24 * 60 * 60;  // 免费试用分 7 天过期（秒）
const SESSION_PER_IP = 20;   // 同一 IP 每小时最多开会话数（防脚本刷免费分）
const SESSION_WINDOW = 60 * 60;      // IP 限流窗口（秒）
const SMS_CODE_TTL = 5 * 60;         // 短信验证码 5 分钟有效（秒）
const SMS_RESEND = 60;               // 同一手机号重发间隔（秒）
const SMS_MAX_TRIES = 5;             // 同一验证码最多试错次数
const MAX_TXN = 100;                 // 积分明细每人最多保留条数
const TXN_TTL = 365 * 24 * 60 * 60;  // 积分明细保留 1 年（秒）

// —— 学历硬门槛：学校层级名单存 KV（私有，避免把学校名单/作者学校写进公开仓库）——
// KV key 'school-tiers' → JSON 对象 {校名: 层级}，层级 ∈ {985, 211, 双一流, 一本}。
// 递进包含：985 ⊃ 211 ⊃ 双一流 ⊃ 一本；985/211/双一流 均满足「统招重点本科以上」。
// 名单用一次性命令写入 KV（wrangler kv key put），未配置则跳过注入、交给模型自行判断。
const TIER_RANK = { '985': 4, '211': 3, '双一流': 2, '一本': 1 };
const SCHOOL_BOUNDARY = /[\s|｜,，、:：;；.。\-—>]/;

async function loadSchoolTiers(env) {
  try {
    const raw = await env.PLEADLY_KV.get('school-tiers');
    if (!raw) return null;
    const tiers = JSON.parse(raw);
    const names = Object.keys(tiers).filter((k) => TIER_RANK[tiers[k]]);
    if (!names.length) return null;
    names.sort((a, b) => b.length - a.length);  // 长名优先，避免「电子科技大学」误吞「西安电子科技大学」
    return { tiers, names };
  } catch (e) {
    return null;
  }
}

// 从简历文本反查学校层级：从左到右取每个位置的「最长校名」，判断其后缀是否独立学院/分校，
// 收集全部有效命中后取最高层级（如本科+硕士多校取最高）。命中返回 {name, tier}，否则 null。
function findSchoolTier(text, tiers, names) {
  if (!text) return null;
  let best = null;
  let i = 0;
  while (i < text.length) {
    let matched = null;
    for (let k = 0; k < names.length; k++) {
      if (text.startsWith(names[k], i)) { matched = names[k]; break; }  // 最长名优先，避免「电子科技大学」误吞「西安电子科技大学」
    }
    if (!matched) { i++; continue; }
    const after = text[i + matched.length];
    let valid = false;
    if (after === undefined || SCHOOL_BOUNDARY.test(after)) {
      valid = true;  // 干净边界（空白/标点/结尾）
    } else {
      // 紧跟中文：若为「…学院/…分校/…校区」短名 → 独立院校/分校（不同学校），跳过；
      // 否则（专业名、二级学院如「医学部」）视为同一学校。
      const tail = text.slice(i + matched.length);
      if (!/^[一-龥]{0,6}(学院|分校|校区)/.test(tail)) valid = true;
    }
    if (valid) {
      const tier = tiers[matched];
      if (!best || TIER_RANK[tier] > TIER_RANK[best.tier]) best = { name: matched, tier: tier };
    }
    i += matched.length;
  }
  return best;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, Authorization',
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
function randCode6() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < 6; i++) s += String(b[i] % 10);
  return s;
}

// ===== 积分账本：付费分（永久）+ 免费分（7 天过期）双账本 =====
// 付费分 user:<owner>：兑换码充入，永不过期
// 免费分 free:<owner> + freeat:<owner>：首次访问赠送 FREE_STARTER，7 天后过期
// freegranted:<owner>：是否已授予过免费分（一次性，防反复领取）

async function getPaid(env, owner) {
  const raw = await env.PLEADLY_KV.get('user:' + owner);
  return raw !== null ? parseInt(raw, 10) : 0;
}
async function setPaid(env, owner, bal) {
  await env.PLEADLY_KV.put('user:' + owner, String(bal));
}

// 首次访问授予免费分（每个 owner 只授一次）
async function ensureFree(env, owner) {
  if (FREE_STARTER <= 0) return 0;  // 免费积分已关闭：不授予、不记 freegranted，防反复注册刷积分
  const granted = await env.PLEADLY_KV.get('freegranted:' + owner);
  if (granted) return 0;
  await env.PLEADLY_KV.put('freegranted:' + owner, '1');
  await env.PLEADLY_KV.put('freeat:' + owner, String(Date.now()));
  await env.PLEADLY_KV.put('free:' + owner, String(FREE_STARTER), { expirationTtl: FREE_TTL });
  const paid = await getPaid(env, owner);
  await appendTxn(env, owner, 'free', FREE_STARTER, paid + FREE_STARTER, '');
  return FREE_STARTER;
}

// 读免费分：按 freeat 判断是否超过 7 天，过期返回 0
async function getFree(env, owner) {
  const at = await env.PLEADLY_KV.get('freeat:' + owner);
  if (!at) return 0;
  if (Date.now() - parseInt(at, 10) > FREE_TTL * 1000) return 0;
  const raw = await env.PLEADLY_KV.get('free:' + owner);
  return raw !== null ? parseInt(raw, 10) : 0;
}

// 写免费分：保留最早授予时间，剩余有效期按 freeat 折算（不因扣分重置 7 天）
async function setFree(env, owner, bal) {
  const at = await env.PLEADLY_KV.get('freeat:' + owner);
  if (!at) { await env.PLEADLY_KV.put('free:' + owner, '0'); return; }
  const remaining = Math.floor((parseInt(at, 10) + FREE_TTL * 1000 - Date.now()) / 1000);
  if (bal <= 0 || remaining <= 0) {
    await env.PLEADLY_KV.put('free:' + owner, '0');
  } else {
    await env.PLEADLY_KV.put('free:' + owner, String(bal), { expirationTtl: Math.max(60, remaining) });
  }
}

// 总余额 = 付费分 + 免费分（顺带首次授予免费分）
async function getBalance(env, owner) {
  await ensureFree(env, owner);
  return (await getPaid(env, owner)) + (await getFree(env, owner));
}

// 扣分：先扣免费分（免费分先用掉/先过期），再扣付费分。不够返回 null
async function spend(env, owner, cost) {
  const paid = await getPaid(env, owner);
  const free = await getFree(env, owner);
  if (paid + free < cost) return null;
  let rest = cost;
  const useFree = Math.min(free, rest);
  if (useFree > 0) { await setFree(env, owner, free - useFree); rest -= useFree; }
  if (rest > 0) await setPaid(env, owner, paid - rest);
  return paid + free - cost;
}

// 把设备上的付费分 + 免费分并入账号（免费分保留原 7 天过期），设备账本清零防双花
async function mergeIntoAccount(env, deviceId, accountId) {
  // 只并入设备「已有」余额，绝不在合并时凭空授予免费分（防脚本用新 deviceId 刷免费分）
  const paid = await getPaid(env, deviceId);
  const free = await getFree(env, deviceId);

  if (paid > 0) {
    await setPaid(env, deviceId, 0);
    await setPaid(env, accountId, (await getPaid(env, accountId)) + paid);
  }

  // 免费分资格跟着设备走：设备授过就标记账号已授，避免账号再领一份免费分
  if (await env.PLEADLY_KV.get('freegranted:' + deviceId)) {
    await env.PLEADLY_KV.put('freegranted:' + accountId, '1');
  }
  if (free > 0) {
    await setFree(env, deviceId, 0);
    const acctFree = await getFree(env, accountId);
    const devAtRaw = await env.PLEADLY_KV.get('freeat:' + deviceId);
    const acctAtRaw = await env.PLEADLY_KV.get('freeat:' + accountId);
    const devAt = devAtRaw ? parseInt(devAtRaw, 10) : Date.now();
    const acctAt = acctAtRaw ? parseInt(acctAtRaw, 10) : devAt;
    await env.PLEADLY_KV.put('freeat:' + accountId, String(Math.min(devAt, acctAt)));
    await setFree(env, accountId, acctFree + free);
  }

  // 合并积分明细：设备明细并入账号（按时间倒序合并、截断），避免登录后看不到匿名期的记录
  const devTxns = await getTxns(env, deviceId);
  if (devTxns.length) {
    const acctTxns = await getTxns(env, accountId);
    const merged = devTxns.concat(acctTxns).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, MAX_TXN);
    await env.PLEADLY_KV.put('txn:' + accountId, JSON.stringify(merged), { expirationTtl: TXN_TTL });
    await env.PLEADLY_KV.delete('txn:' + deviceId);
  }
}

// ===== 积分明细：存 txn:<owner>，最新在前，最多 MAX_TXN 条，TTL 过期 =====
async function getTxns(env, owner) {
  const raw = await env.PLEADLY_KV.get('txn:' + owner);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
async function appendTxn(env, owner, type, amount, balance, label) {
  try {
    const arr = await getTxns(env, owner);
    arr.unshift({ ts: Date.now(), type, amount, balance, label: label || '' });
    if (arr.length > MAX_TXN) arr.length = MAX_TXN;
    await env.PLEADLY_KV.put('txn:' + owner, JSON.stringify(arr), { expirationTtl: TXN_TTL });
  } catch (e) { /* 明细写入失败不影响主流程 */ }
}

// IP 限流：同一 IP 每小时开会话数上限（防脚本刷免费分）
async function rateLimited(env, ip) {
  const key = 'rl:session:' + ip;
  const raw = await env.PLEADLY_KV.get(key);
  const n = raw !== null ? parseInt(raw, 10) : 0;
  if (n >= SESSION_PER_IP) return true;
  await env.PLEADLY_KV.put(key, String(n + 1), { expirationTtl: SESSION_WINDOW });
  return false;
}

// 校验 Cloudflare Turnstile（人机验证）。未配置 TURNSTILE_SECRET 时放行，配置后自动生效。
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true }; // 未配置 = 平滑放行
  if (!token) return { ok: false, codes: ['missing-input-response'] };
  const form = new URLSearchParams();
  form.set('secret', env.TURNSTILE_SECRET);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  try { const d = await r.json(); return { ok: !!d.success, codes: d['error-codes'] || [] }; }
  catch (e) { return { ok: false, codes: ['siteverify-network-error'] }; }
}

// 发送短信验证码。接入短信服务商后实现真实发送（见 TODO）。
async function sendSms(env, phone, code) {
  // TODO: 换成你的短信服务商。个人可用：UniSMS(uni.apistd.com)、云片(www.yunpian.com)。
  // 示例（按服务商文档改）：
  //   await fetch(env.SMS_ENDPOINT, {
  //     method:'POST',
  //     headers:{'Authorization':'Bearer '+env.SMS_API_KEY,'Content-Type':'application/json'},
  //     body:JSON.stringify({to:phone, signature:env.SMS_SIGNATURE, template:env.SMS_TEMPLATE, data:{code}})
  //   });
  // 上线前把 SMS_* 用 wrangler secret put 设好，并删除下面这行调试日志。
  console.log('[sms] to', phone, 'code', code);
}

// ===== 账号系统：PBKDF2 密码哈希 + 登录态 =====
const PBKDF2_ITER = 100000;
const TOKEN_TTL = 30 * 24 * 60 * 60; // 登录态 30 天（秒）

function randSalt() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2Hash(password, salt, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 解析「当前记账户」：登录态优先账号，否则回退设备 ID（未登录向后兼容）
async function resolveOwner(env, deviceId, token) {
  if (token) {
    const acct = await env.PLEADLY_KV.get('tok:' + token.slice(0, 80));
    if (acct) return acct;
  }
  return deviceId;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const path = url.pathname;

    // 1) 查余额
    if (path === '/points' && request.method === 'GET') {
      const deviceId = (url.searchParams.get('deviceId') || '').toString().slice(0, 64);
      const token = (url.searchParams.get('token') || '').toString().slice(0, 80);
      if (!deviceId) return json({ error: 'missing deviceId' }, 400);
      const owner = await resolveOwner(env, deviceId, token);
      await ensureFree(env, owner);
      const free = await getFree(env, owner);
      const paid = await getPaid(env, owner);
      const atRaw = await env.PLEADLY_KV.get('freeat:' + owner);
      return json({
        balance: paid + free,
        free,
        freeExpiresAt: (free > 0 && atRaw) ? parseInt(atRaw, 10) + FREE_TTL * 1000 : null,
      });
    }

    // 1b) 积分明细（充值/消费/退款/赠送，按时间倒序）
    if (path === '/transactions' && request.method === 'GET') {
      const deviceId = (url.searchParams.get('deviceId') || '').toString().slice(0, 64);
      const token = (url.searchParams.get('token') || '').toString().slice(0, 80);
      if (!deviceId) return json({ error: 'missing deviceId' }, 400);
      const owner = await resolveOwner(env, deviceId, token);
      return json({ transactions: await getTxns(env, owner) });
    }

    // 2) 兑换码
    if (path === '/redeem' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const deviceId = (body.deviceId || '').toString().slice(0, 64);
      const token = (body.token || '').toString().slice(0, 80);
      const code = (body.code || '').trim().toUpperCase();
      if (!deviceId || !code) return json({ error: 'missing fields' }, 400);
      const rec = await env.PLEADLY_KV.get('code:' + code);
      if (!rec) return json({ error: 'invalid' }, 404);
      const parsed = JSON.parse(rec);
      if (parsed.used) return json({ error: 'used' }, 409);
      parsed.used = true;
      await env.PLEADLY_KV.put('code:' + code, JSON.stringify(parsed));
      const owner = await resolveOwner(env, deviceId, token);
      await ensureFree(env, owner);
      const paid = await getPaid(env, owner);
      const newPaid = paid + parsed.points;
      await setPaid(env, owner, newPaid);
      const free = await getFree(env, owner);
      await appendTxn(env, owner, 'redeem', parsed.points, newPaid + free, code);
      return json({ added: parsed.points, balance: newPaid + free });
    }

    // 3) 开会话（一次功能扣一次分）
    if (path === '/session' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const deviceId = (body.deviceId || '').toString().slice(0, 64);
      const token = (body.token || '').toString().slice(0, 80);
      const cost = Math.min(10, Math.max(1, parseInt(body.cost || '0', 10) || 0)); // 服务端钳制 1..10，杜绝 cost=0 白嫖会话
      if (!deviceId) return json({ error: 'missing deviceId' }, 400);

      // IP 限流：防脚本拿免费分刷 API（同一 IP 每小时开会话数上限）
      const ip = (request.headers.get('CF-Connecting-IP') || '').split(',')[0].trim();
      if (ip && (await rateLimited(env, ip))) return json({ error: 'rate_limited' }, 429);

      // 人机验证：此处不再硬拦。/session 是国内用户高频入口，而 challenges.cloudflare.com 在国内常被墙，
      // 硬拦会误伤真实付费用户（此前大量「session error 403」）。反滥用改由上方 IP 限流 + 积分账本兜底。
      // 账号类接口（/register /login/phone /sms/send）仍保留 Turnstile 硬校验。

      const owner = await resolveOwner(env, deviceId, token);
      const label = (body.label || '').toString().slice(0, 64);
      const bal = await getBalance(env, owner);
      if (bal < cost) return json({ error: 'no_points' }, 402);
      const newBal = await spend(env, owner, cost);
      if (newBal === null) return json({ error: 'no_points' }, 402);
      await appendTxn(env, owner, 'spend', -cost, newBal, label);
      const sessionId = randId(24);
      const initBudget = budgetFor(cost);
      await env.PLEADLY_KV.put('session:' + sessionId, JSON.stringify({
        owner, cost, budget: initBudget, initBudget, label, expires: Date.now() + SESSION_TTL * 1000,
      }), { expirationTtl: SESSION_TTL });
      return json({ sessionId, balance: newBal });
    }

    // 3b) 退款：功能中途失败时前端调用，按剩余额度比例退还没用完的积分
    if (path === '/session/refund' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const sessionId = (body.sessionId || '').toString();
      if (!sessionId) return json({ error: 'missing sessionId' }, 400);
      const raw = await env.PLEADLY_KV.get('session:' + sessionId);
      if (!raw) return json({ error: 'session_expired' }, 401);
      const sess = JSON.parse(raw);
      if (Date.now() > sess.expires) { await env.PLEADLY_KV.delete('session:' + sessionId); return json({ error: 'session_expired' }, 401); }
      const initBudget = sess.initBudget || sess.budget || 1;
      const refund = Math.max(0, Math.round((sess.cost || 0) * (sess.budget || 0) / initBudget));
      if (refund > 0) await setPaid(env, sess.owner, (await getPaid(env, sess.owner)) + refund);
      await env.PLEADLY_KV.delete('session:' + sessionId);
      const bal = await getBalance(env, sess.owner);
      if (refund > 0) await appendTxn(env, sess.owner, 'refund', refund, bal, sess.label || '');
      return json({ refunded: refund, balance: bal });
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

      // 学历硬门槛：从 <user_resume> 标签内反查学校层级（名单存 KV，未配置则跳过、交给模型自行判断）
      let outMessages = messages;
      const tiersData = await loadSchoolTiers(env);
      if (tiersData) {
        const allText = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
        const rm = allText.match(/<\s*user_resume\s*>([\s\S]*?)<\s*\/user_resume\s*>/i);
        if (rm && rm[1]) {
          const hit = findSchoolTier(rm[1], tiersData.tiers, tiersData.names);
          if (hit) {
            const note = '\n\n【权威学校层级｜Authoritative school tier】简历中出现「' + hit.name + '」，名单显示其办学层次为「' + hit.tier + '」。判断 JD 学历硬门槛（统招重点本科/全日制本科/985/211/双一流/硕士等）时请以此为主要参考；若简历原文显示该校为独立学院/分校或其他院校，以简历原文为准。';
            const sysIdx = outMessages.findIndex((m) => m.role === 'system');
            if (sysIdx >= 0) {
              outMessages = outMessages.map((m, i) => (i === sysIdx ? { role: m.role, content: (m.content || '') + note } : m));
            } else {
              outMessages = [{ role: 'system', content: note }].concat(outMessages);
            }
          }
        }
      }

      const upstream = await fetch(DEEPSEEK_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.DEEPSEEK_API_KEY },
        body: JSON.stringify({ model: MODEL, messages: outMessages, thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: MAX_OUT_TOKENS }),
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

    // 4b) 注册：账号(8位数字) + 用户名(任意) + 密码(8-16位字母数字)，PBKDF2 哈希 + 合并本设备旧余额
    if (path === '/register' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const account = (body.account || '').trim();
      const username = (body.username || '').trim();
      const password = (body.password || '');
      const deviceId = (body.deviceId || '').toString().slice(0, 64);
      if (!account || !password || !deviceId) return json({ error: 'missing fields' }, 400);
      if (!/^\d{8}$/.test(account)) return json({ error: 'bad account' }, 400);
      if (username.length > 32) return json({ error: 'bad username' }, 400);
      if (!/^[A-Za-z0-9]{8,16}$/.test(password)) return json({ error: 'bad password' }, 400);
      const ip = (request.headers.get('CF-Connecting-IP') || '').split(',')[0].trim();
      const turnstileToken = (body.turnstileToken || '').toString().slice(0, 4096);
      const _ts = await verifyTurnstile(env, turnstileToken, ip);
      if (!_ts.ok) return json({ error: 'verify_failed', codes: _ts.codes }, 403);
      if (await env.PLEADLY_KV.get('acctNum:' + account)) return json({ error: 'taken' }, 409);

      const accountId = 'u-' + randId(20);
      const salt = randSalt();
      const hash = await pbkdf2Hash(password, salt, PBKDF2_ITER);
      await env.PLEADLY_KV.put('acct:' + accountId, JSON.stringify({
        id: accountId, account, username, salt, hash, iter: PBKDF2_ITER, deviceId, createdAt: Date.now(),
      }));
      await env.PLEADLY_KV.put('acctNum:' + account, accountId);

      // 合并设备余额到账号（付费分永久 + 免费分保留原 7 天过期），设备账本清零防双花
      await mergeIntoAccount(env, deviceId, accountId);
      const bal = await getBalance(env, accountId);

      const token = randId(32);
      await env.PLEADLY_KV.put('tok:' + token, accountId, { expirationTtl: TOKEN_TTL });
      return json({ token, account, username, balance: bal });
    }

    // 4c) 登录（账号 = 8 位数字）
    if (path === '/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const account = (body.account || '').trim();
      const password = (body.password || '');
      const deviceId = (body.deviceId || '').toString().slice(0, 64);
      if (!account || !password || !deviceId) return json({ error: 'missing fields' }, 400);
      const accountId = await env.PLEADLY_KV.get('acctNum:' + account);
      if (!accountId) return json({ error: 'no_account' }, 404);
      const raw = await env.PLEADLY_KV.get('acct:' + accountId);
      const acct = JSON.parse(raw);
      const hash = await pbkdf2Hash(password, acct.salt, acct.iter);
      if (hash !== acct.hash) return json({ error: 'bad_password' }, 401);

      // 其它设备上的余额（付费分 + 剩余免费分）一并并入账号
      if (deviceId !== acct.deviceId) {
        await mergeIntoAccount(env, deviceId, accountId);
      }
      const bal = await getBalance(env, accountId);
      const token = randId(32);
      await env.PLEADLY_KV.put('tok:' + token, accountId, { expirationTtl: TOKEN_TTL });
      return json({ token, account: acct.account || account, username: acct.username, balance: bal });
    }

    // 4d) 当前登录用户信息
    if (path === '/me' && request.method === 'GET') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const accountId = await resolveOwner(env, '', token);
      if (!accountId) return json({ error: 'unauthorized' }, 401);
      const raw = await env.PLEADLY_KV.get('acct:' + accountId);
      if (!raw) return json({ error: 'unauthorized' }, 401);
      const acct = JSON.parse(raw);
      return json({ account: acct.account, username: acct.username, balance: await getBalance(env, accountId) });
    }

    // 5e) 发送短信验证码（手机号登录 · 第一步）
    if (path === '/sms/send' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const phone = (body.phone || '').toString().trim();
      const deviceId = (body.deviceId || '').toString().slice(0, 64);
      if (!/^1\d{10}$/.test(phone)) return json({ error: 'bad phone' }, 400);
      const ip = (request.headers.get('CF-Connecting-IP') || '').split(',')[0].trim();
      const turnstileToken = (body.turnstileToken || '').toString().slice(0, 4096);
      const _ts = await verifyTurnstile(env, turnstileToken, ip);
      if (!_ts.ok) return json({ error: 'verify_failed', codes: _ts.codes }, 403);
      const last = await env.PLEADLY_KV.get('smslast:' + phone);
      if (last && Date.now() - parseInt(last, 10) < SMS_RESEND * 1000) return json({ error: 'too_often' }, 429);
      const code = randCode6();
      await env.PLEADLY_KV.put('sms:' + phone, JSON.stringify({ code, exp: Date.now() + SMS_CODE_TTL * 1000, tries: 0 }), { expirationTtl: SMS_CODE_TTL });
      await env.PLEADLY_KV.put('smslast:' + phone, String(Date.now()), { expirationTtl: SMS_RESEND });
      await sendSms(env, phone, code);
      return json({ ok: true });
    }

    // 5f) 手机号 + 验证码登录（手机号 = 唯一身份，一个手机号只对应一个账号）
    if (path === '/login/phone' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const phone = (body.phone || '').toString().trim();
      const code = (body.code || '').toString().trim();
      const deviceId = (body.deviceId || '').toString().slice(0, 64);
      if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) return json({ error: 'missing fields' }, 400);
      const ip = (request.headers.get('CF-Connecting-IP') || '').split(',')[0].trim();
      const turnstileToken = (body.turnstileToken || '').toString().slice(0, 4096);
      const _ts = await verifyTurnstile(env, turnstileToken, ip);
      if (!_ts.ok) return json({ error: 'verify_failed', codes: _ts.codes }, 403);

      const raw = await env.PLEADLY_KV.get('sms:' + phone);
      if (!raw) return json({ error: 'no_code' }, 404);
      const s = JSON.parse(raw);
      if (Date.now() > s.exp) return json({ error: 'code_expired' }, 410);
      if (s.tries >= SMS_MAX_TRIES) return json({ error: 'too_many_tries' }, 429);
      if (s.code !== code) {
        s.tries += 1;
        await env.PLEADLY_KV.put('sms:' + phone, JSON.stringify(s), { expirationTtl: SMS_CODE_TTL });
        return json({ error: 'bad_code' }, 401);
      }
      await env.PLEADLY_KV.delete('sms:' + phone);

      // 找或建账号：一个手机号永久对应一个账号
      let accountId = await env.PLEADLY_KV.get('phone:' + phone);
      if (!accountId) {
        accountId = 'u-' + randId(20);
        let account;
        do { account = String((crypto.getRandomValues(new Uint32Array(1))[0]) % 100000000).padStart(8, '0'); } while (await env.PLEADLY_KV.get('acctNum:' + account));
        await env.PLEADLY_KV.put('acct:' + accountId, JSON.stringify({
          id: accountId, account, username: '用户' + account.slice(-4), phone, deviceId, createdAt: Date.now(),
        }));
        await env.PLEADLY_KV.put('acctNum:' + account, accountId);
        await env.PLEADLY_KV.put('phone:' + phone, accountId);
      }
      // 设备余额（付费分 + 剩余免费分）并入账号
      await mergeIntoAccount(env, deviceId, accountId);
      const acct = JSON.parse(await env.PLEADLY_KV.get('acct:' + accountId));
      const bal = await getBalance(env, accountId);
      const token = randId(32);
      await env.PLEADLY_KV.put('tok:' + token, accountId, { expirationTtl: TOKEN_TTL });
      return json({ token, account: acct.account, username: acct.username, balance: bal });
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
          let used = false, sold = false, points = 0;
          const raw = await env.PLEADLY_KV.get(key.name);
          try { const p = JSON.parse(raw); used = !!p.used; sold = !!p.sold; points = p.points || 0; } catch (e) {}
          codes.push({ code, points, used, sold });
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
      const points = Math.max(1, parseInt(body.points || '', 10) || DEFAULT_POINTS);
      const codes = [];
      for (let i = 0; i < count; i++) {
        const c = randCode();
        await env.PLEADLY_KV.put('code:' + c, JSON.stringify({ points, used: false, sold: false, ts: Date.now() }));
        codes.push(c);
      }
      return json({ points, count, codes });
    }

    // 5c) 管理：一键取码发货（取一个「未售未用」的码 → 标记「已发出」→ 返回给卖家）
    if (path === '/admin/codes/issue' && request.method === 'POST') {
      const secret = request.headers.get('X-Admin-Secret') || '';
      if (secret !== env.ADMIN_SECRET) return json({ error: 'forbidden' }, 403);
      const body = await request.json().catch(() => ({}));
      const points = Math.max(1, parseInt(body.points || '', 10) || DEFAULT_POINTS);
      let issued = null, cursor;
      do {
        const list = await env.PLEADLY_KV.list({ prefix: 'code:', cursor });
        for (const key of list.keys) {
          if (issued) break;
          const raw = await env.PLEADLY_KV.get(key.name);
          try {
            const p = JSON.parse(raw);
            if (!p.used && !p.sold && p.points === points) {
              p.sold = true;
              await env.PLEADLY_KV.put(key.name, JSON.stringify(p));
              issued = { code: key.name.slice(5), points: p.points };
            }
          } catch (e) {}
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor && !issued);
      if (!issued) return json({ error: 'no_code', hint: '码池没有该面额的未售码，请先点下方「生成」' }, 404);
      return json(issued);
    }

    // 5d) 管理：清理未发货且未使用的码（可按面额过滤；不传 points 则清全部未发货码）
    if (path === '/admin/codes/clean' && request.method === 'POST') {
      const secret = request.headers.get('X-Admin-Secret') || '';
      if (secret !== env.ADMIN_SECRET) return json({ error: 'forbidden' }, 403);
      const body = await request.json().catch(() => ({}));
      const points = Math.max(0, parseInt(body.points || '0', 10) || 0); // 0 = 全部
      let removed = 0;
      let cursor;
      do {
        const list = await env.PLEADLY_KV.list({ prefix: 'code:', cursor });
        for (const key of list.keys) {
          const raw = await env.PLEADLY_KV.get(key.name);
          try {
            const p = JSON.parse(raw);
            if (!p.used && !p.sold && (!points || p.points === points)) {
              await env.PLEADLY_KV.delete(key.name);
              removed++;
            }
          } catch (e) {}
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);
      return json({ removed });
    }

    return json({ error: 'not found' }, 404);
  },

  // 定时任务：清理已兑换的码 + 补充新鲜码（保持码池数量）
  async scheduled(event, env, ctx) {
    let cursor, fresh = 0, usedKeys = [];
    do {
      const list = await env.PLEADLY_KV.list({ prefix: 'code:', cursor });
      for (const key of list.keys) {
        const raw = await env.PLEADLY_KV.get(key.name);
        try {
          const p = JSON.parse(raw);
          if (p.used) usedKeys.push(key.name);
          else if (!p.sold) fresh++;
        } catch (e) {}
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    // 删除已兑换的码
    for (const k of usedKeys) await env.PLEADLY_KV.delete(k);

    // 新鲜码不足则补齐
    if (fresh < MIN_FRESH) {
      const need = REFILL_TARGET - fresh;
      for (let i = 0; i < need; i++) {
        const c = randCode();
        await env.PLEADLY_KV.put('code:' + c, JSON.stringify({ points: DEFAULT_POINTS, used: false, sold: false, ts: Date.now() }));
      }
    }
  },
};

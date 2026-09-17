#!/usr/bin/env node
// Pleadly 发货工具 —— 按价格档位生成 / 发货兑换码（走后端 /admin/codes）
//
// 档位表（价格 → 积分）改下方 TIERS 即可；后端 DEFAULT_POINTS 只是自动补码的默认面额，
// 本工具可发任意面额的码，不受后端默认值限制。
//
// 用法：
//   node tools/issue-code.js list              查看档位 + 码池状态
//   node tools/issue-code.js issue 19.9        发货 1 个「19.9 档」码（码池空会自动补一批）
//   node tools/issue-code.js gen 19.9 [数量]    预生成「19.9 档」码，默认 10 个
//
// 管理密钥读取顺序：环境变量 ADMIN_SECRET → 文件 tools/.admin-secret（已 gitignore，切勿提交）。
// 后端地址可用环境变量 API_BASE 覆盖，默认 https://api.pleadly.top。

const fs = require('fs');
const path = require('path');

// —— 价格档位表：价格(元) → 积分。按你的定价改这里 ——
const TIERS = [
  { price: 9.9,  points: 25 },
  { price: 19.9, points: 55 },
  { price: 49,   points: 150 },
  { price: 99,   points: 320 },
];
const API_BASE = process.env.API_BASE || 'https://api.pleadly.top';
const SECRET_FILE = path.join(__dirname, '.admin-secret');

function readSecret() {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET.trim();
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch (e) {}
  return '';
}

function findTier(price) {
  return TIERS.find((t) => String(t.price) === String(price)) || null;
}

async function api(pathname, method, secret, body) {
  const resp = await fetch(API_BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

function printTiers() {
  console.log('价格档位：');
  for (const t of TIERS) console.log('  ¥' + t.price + '  =  ' + t.points + ' 分');
}

function logIssued(price, points, code) {
  const line = new Date().toISOString() + '  ¥' + price + ' (' + points + '分)  ' + code + '\n';
  try { fs.appendFileSync(path.join(__dirname, 'issued-codes.txt'), line); } catch (e) {}
}

async function list() {
  const secret = readSecret();
  if (!secret) return fail('缺少管理密钥：设置环境变量 ADMIN_SECRET，或把密钥写入 tools/.admin-secret');
  const { status, data } = await api('/admin/codes', 'GET', secret);
  if (status !== 200) return fail('列出失败 HTTP ' + status + (data.error ? ' — ' + data.error : '（多半是 ADMIN_SECRET 错或未设置）'));
  const codes = data.codes || [];
  printTiers();
  console.log('\n码池（共 ' + codes.length + ' 个）：');
  const byPts = {};
  for (const c of codes) {
    byPts[c.points] = byPts[c.points] || { total: 0, unsold: 0, used: 0 };
    byPts[c.points].total++;
    if (!c.sold) byPts[c.points].unsold++;
    if (c.used) byPts[c.points].used++;
  }
  for (const pts of Object.keys(byPts).sort((a, b) => a - b)) {
    const s = byPts[pts];
    console.log('  ' + pts + ' 分：共 ' + s.total + ' 个，未发货 ' + s.unsold + '，已用 ' + s.used);
  }
}

async function issue(price) {
  const tier = findTier(price);
  if (!tier) { printTiers(); return fail('没有这个档位：' + price); }
  const secret = readSecret();
  if (!secret) return fail('缺少管理密钥：设置环境变量 ADMIN_SECRET，或把密钥写入 tools/.admin-secret');
  let { status, data } = await api('/admin/codes/issue', 'POST', secret, { points: tier.points });
  if (status === 404 && data.error === 'no_code') {
    console.log('码池没有该面额，先自动补 5 个...');
    await api('/admin/codes', 'POST', secret, { points: tier.points, count: 5 });
    ({ status, data } = await api('/admin/codes/issue', 'POST', secret, { points: tier.points }));
  }
  if (status !== 200 || !data.code) return fail('发货失败 HTTP ' + status + (data.error ? ' — ' + data.error : ''));
  logIssued(tier.price, tier.points, data.code);
  console.log('\n✅ 已发货（¥' + tier.price + ' = ' + data.points + ' 分）');
  console.log('   兑换码：' + data.code);
  console.log('   发给买家 → 买家在「个人资料 → 兑换码」输入即可');
}

async function gen(price, count) {
  const tier = findTier(price);
  if (!tier) { printTiers(); return fail('没有这个档位：' + price); }
  const n = Math.max(1, Math.min(500, parseInt(count || '10', 10) || 10));
  const secret = readSecret();
  if (!secret) return fail('缺少管理密钥：设置环境变量 ADMIN_SECRET，或把密钥写入 tools/.admin-secret');
  const { status, data } = await api('/admin/codes', 'POST', secret, { points: tier.points, count: n });
  if (status !== 200) return fail('生成失败 HTTP ' + status + (data.error ? ' — ' + data.error : ''));
  console.log('\n已生成 ' + data.count + ' 个（¥' + tier.price + ' = ' + data.points + ' 分）：');
  for (const c of data.codes) console.log('  ' + c);
}

function fail(msg) { console.error('✗ ' + msg); process.exitCode = 1; }

const [cmd, arg1, arg2] = process.argv.slice(2);
if (!cmd) {
  console.log('用法：');
  console.log('  node tools/issue-code.js list');
  console.log('  node tools/issue-code.js issue <价格>');
  console.log('  node tools/issue-code.js gen <价格> [数量]');
  printTiers();
} else if (cmd === 'list') list();
else if (cmd === 'issue') issue(arg1);
else if (cmd === 'gen') gen(arg1, arg2);
else { printTiers(); fail('未知命令：' + cmd); }

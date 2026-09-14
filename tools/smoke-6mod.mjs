import fs from 'node:fs';
import vm from 'node:vm';

const file = 'G:/wwwww/lab/Pleadly-web/index.html';
const html = fs.readFileSync(file, 'utf8');

// extract all inline <script> blocks
const scripts = [];
const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) scripts.push(m[1]);
const js = scripts.join('\n;\n');

// 1. syntax check
try {
  new vm.Script(js);
  console.log('PASS: syntax OK');
} catch (e) {
  console.error('FAIL: syntax error:', e.message);
  process.exit(1);
}

// universal proxy stub — returns a callable proxy for any property, never undefined
function universal() {
  const fn = function () { return universal(); };
  return new Proxy(fn, {
    get() { return universal(); },
    apply() { return universal(); },
    set() { return true; },
  });
}

const store = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  crypto: globalThis.crypto,
  URL: globalThis.URL,
  Blob: globalThis.Blob,
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
  atob, btoa,
  fetch: () => Promise.reject(new Error('no fetch in smoke')),
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  document: universal(),
  window: universal(),
  navigator: universal(),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(js, sandbox);

let fails = 0;
function assert(c, msg) {
  if (c) console.log('PASS: ' + msg);
  else { console.error('FAIL: ' + msg); fails++; }
}

// _mdInline bold
const b = sandbox._mdInline('**能力点**：一句证据');
assert(b === '<b>能力点</b>：一句证据', '_mdInline bold -> ' + b);

// parseResume 6 modules, in order, no summary flattening
const sample = `# 张三
电话 | 邮箱 | 城市 | 产品经理

## 教育背景
### 学校 | 专业 | 学历 | 2022 - 2026
- 相关课程

## 自我评价
- **能力点**：证据

## 实习经历
### 公司 | 岗位 | 2024.06 - 2024.09
- **小标题**：做了什么

## 项目经历
### 项目名 | 角色 | 时间
- **项目概述**：一句话

## 校园经历
### 组织 | 角色 | 时间
- 锻炼了能力`;
const res = sandbox.parseResume(sample);
assert(res.sections.length === 5, 'parseResume -> 5 sections (got ' + res.sections.length + ')');
const titles = res.sections.map((s) => s.title);
assert(JSON.stringify(titles) === JSON.stringify(['教育背景', '自我评价', '实习经历', '项目经历', '校园经历']),
  'section order -> ' + titles.join(' / '));
assert(res.summary === '', 'no summary flattening');

// _resumeDoc always classic single-column, bold rendered
const doc = sandbox._resumeDoc(res);
assert(doc.indexOf('<div class="sec">') !== -1, '_resumeDoc renders classic sections');
assert(doc.indexOf('class="wrap"') === -1 && doc.indexOf('class="grid"') === -1 && doc.indexOf('class="side"') === -1,
  'single-column (no wrap/grid/side)');
assert(doc.indexOf('<b>能力点</b>') !== -1, 'bold rendered in exported doc');

// runResumeBuild defined
assert(typeof sandbox.runResumeBuild === 'function', 'runResumeBuild is a function');

// no leftover template names
assert(!('resumeTplModern' in sandbox) && !('resumeTplEven' in sandbox), 'modern/even templates removed');
assert(!('_isSummarySec' in sandbox) && !('_splitSections' in sandbox), 'summary/split helpers removed');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
// Pleadly 激活码生成器 —— 生成激活码 + SHA-256 哈希白名单
// 用法: node tools/gen-license.js [数量]
// 明文码追加写入仓库根目录 codes.txt（已 gitignore，切勿提交）；哈希粘贴进 index.html 的 LICENSE_HASHES
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---- 浏览器端同款 sha256（纯 JS，仅 ASCII）—— 生成时先自检与 Node crypto 一致 ----
function sha256(ascii){
  function rr(v,a){return (v>>>a)|(v<<(32-a));}
  var maxWord=Math.pow(2,32),i,j,result='';
  var words=[],bitLen=ascii.length*8;
  var hash=sha256.h=sha256.h||[],k=sha256.k=sha256.k||[],primeCounter=k.length;
  var isComposite={};
  for(var c=2;primeCounter<64;c++){if(!isComposite[c]){for(i=0;i<313;i+=c)isComposite[i]=c;hash[primeCounter]=(Math.pow(c,.5)*maxWord)|0;k[primeCounter++]=(Math.pow(c,1/3)*maxWord)|0;}}
  ascii+='\x80';
  while(ascii.length%64-56)ascii+='\x00';
  for(i=0;i<ascii.length;i++){j=ascii.charCodeAt(i);if(j>>8)return '';words[i>>2]|=j<<((3-i)%4)*8;}
  words[words.length]=((bitLen/maxWord)|0);
  words[words.length]=bitLen;
  for(j=0;j<words.length;){
    var w=words.slice(j,j+=16),oldHash=hash;
    hash=hash.slice(0,8);
    for(i=0;i<64;i++){
      var w15=w[i-15],w2=w[i-2];
      var a=hash[0],e=hash[4];
      var t1=hash[7]+(rr(e,6)^rr(e,11)^rr(e,25))+((e&hash[5])^((~e)&hash[6]))+k[i]+(w[i]=(i<16)?w[i]:(w[i-16]+(rr(w15,7)^rr(w15,18)^(w15>>>3))+w[i-7]+(rr(w2,17)^rr(w2,19)^(w2>>>10)))|0);
      var t2=(rr(a,2)^rr(a,13)^rr(a,22))+((a&hash[1])^(a&hash[2])^(hash[1]&hash[2]));
      hash=[(t1+t2)|0].concat(hash);
      hash[4]=(hash[4]+t1)|0;
    }
    for(i=0;i<8;i++)hash[i]=(hash[i]+oldHash[i])|0;
  }
  for(i=0;i<8;i++)for(j=3;j+1;j--){var b=(hash[i]>>(j*8))&255;result+=((b<16)?0:'')+b.toString(16);}
  return result;
}

// 自检：确保上面这段 JS sha256 与 Node crypto 完全一致（否则生成出的哈希前端永远校验不过）
(function selfTest(){
  const cases=['','abc','hello world','PLD-ABCDEFGH-23456789','The quick brown fox jumps over the lazy dog'];
  for(const c of cases){
    const a=sha256(c), b=crypto.createHash('sha256').update(c).digest('hex');
    if(a!==b){console.error('SHA-256 自检失败:', JSON.stringify(c), '\n  js   =', a, '\n  node =', b);process.exit(1);}
  }
  console.log('SHA-256 自检通过 ✓');
})();

const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆 I O 0 1
function group(len){let s='';const b=crypto.randomBytes(len);for(let i=0;i<len;i++)s+=ALPHABET[b[i]%ALPHABET.length];return s;}
function genCode(){return 'PLD-'+group(8)+'-'+group(8);}
function h(s){return crypto.createHash('sha256').update(s).digest('hex');}

const n=Math.max(1,parseInt(process.argv[2]||'10',10)||10);
const codes=[],hashes=[];
for(let i=0;i<n;i++){const c=genCode();codes.push(c);hashes.push(h(c));}

const codesFile=path.join(path.dirname(__dirname),'codes.txt'); // 仓库根目录
const existing=fs.existsSync(codesFile)?fs.readFileSync(codesFile,'utf8').split('\n').filter(Boolean):[];
fs.writeFileSync(codesFile, existing.concat(codes).join('\n')+'\n');

console.log('\n=== 明文激活码（已追加写入 '+codesFile+'，请勿提交到仓库） ===');
codes.forEach(c=>console.log(c));
console.log('\n=== 哈希白名单（粘贴进 index.html 的 LICENSE_HASHES 数组） ===');
console.log(JSON.stringify(hashes));

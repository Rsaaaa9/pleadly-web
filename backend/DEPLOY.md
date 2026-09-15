# Pleadly 付费后端部署 & 兑换码运营

本目录是一个 Cloudflare Worker：DeepSeek 代理 + 服务端积分 + 兑换码（单次使用）。

## 一、部署（一次性，约 10 分钟）

1. 安装并登录：
   ```
   npm i -g wrangler
   wrangler login
   ```
2. 建 KV 命名空间，把返回的 id 填进 `wrangler.toml`：
   ```
   wrangler kv namespace create PLEADLY_KV
   ```
3. 设置两个密钥（**不要**写进代码或仓库）：
   ```
   wrangler secret put DEEPSEEK_API_KEY
   wrangler secret put ADMIN_SECRET
   ```
4. 部署，记下返回的 URL（形如 `https://pleadly-api.你的账号.workers.dev`）：
   ```
   wrangler deploy
   ```

## 二、把前端接上后端

改 `index.html` 里这一行，然后 commit + push（桌面监视器会自动同步桌面版，但桌面是免费版不受影响）：

```js
var API_BASE='https://api.pleadly.top';
```

## 三、生成兑换码（要卖多少生成多少）

```bash
curl -X POST "https://<你的后端>/admin/codes" \
  -H "X-Admin-Secret: <你的ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"count":10,"points":100}'
```

返回的 `codes` 就是明文码，**存到本地码池（建议一个表格：码 / 面额 / 状态[未售/已售/已兑换]）**，不要提交到仓库。

## 四、小红书售卖 & 履约

1. 小红书发笔记/评论区引流到个人主页。
2. 橱窗上架 **1 个商品**（如「Pleadly 求职分析 · 100积分兑换码」），价格对应档位。
3. 收到订单 → 从码池取下一个「未售」码 → 标「已售」→ 私信发给买家。
4. 买家到 Pleadly「设置 → 兑换码」填码 → 服务端校验、标记已用、积分到账。

> 小红书橱窗对个人号没有自动发码接口，前期手动私信发码即可；量大后再接第三方履约。

## 五、安全说明（诚实边界）

- **已防住**：伪造码（码在服务端白名单，且格式 2^80 熵）、重复兑换（服务端标记已用）、改 localStorage 刷积分（余额在服务端）、泄露你的 DeepSeek key（只存环境变量）。
- **MVP 边界**：
  - KV 是最终一致、非严格原子，极端并发「同码双兑换」有极小竞态窗口；量大了可换 D1(SQLite) 事务或 Durable Objects。
  - `FREE_STARTER=20` 赠送积分可被「换设备 ID」刷（清浏览器存储 = 新身份）。成本极低（一次全流程约 ¥0.12），介意可把 `worker.js` 里 `FREE_STARTER` 改成 0。
  - 买家无需注册，用设备 ID 记账；清浏览器会丢积分（需重新用码，但码已标记已用，不会重复加）。
- **国内访问**：`*.workers.dev` 在大陆被墙（SNI 阻断）。已解决：给 Worker 绑定自定义域名 `api.pleadly.top`（无需 ICP 备案），走 Cloudflare 正常边缘节点即可访问。

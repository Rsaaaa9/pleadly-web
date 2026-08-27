# Pleadly Web — AI 求职助手（Web 版）

> 全流程 AI 求职助手的纯前端 Web 版：**岗位搜索 · 信息库 · AI 分析 · 报告仓库**。
> 单文件、零依赖、可离线运行。

🔗 在线预览：**https://rsaaaa9.github.io/pleadly-web/**

---

## 这是什么

Pleadly（我求你了）是一个「AI 招聘经理」视角的全流程求职助手。本仓库是它的 **Web 版**——一个单文件纯前端应用，浏览器打开即用，数据本地持久化（localStorage）。

完整主项目（Python 后端 + 10 步 Agent 工作流 + RAG）：[github.com/Rsaaaa9/Pleadly](https://github.com/Rsaaaa9/Pleadly)

## 功能（4 个 Tab）

| Tab | 说明 | 是否需后端 |
|-----|------|-----------|
| 岗位搜索 | 内置深圳 AI / 游戏 / 产品岗位数据，按画像过滤、优先级排序、一键跳转投递 | ❌ 纯前端 |
| 信息库 | 简历 / 作品集 / 项目经历的本地管理 | ❌ 纯前端 |
| AI 分析 | 10 步全流程求职分析（ATS → 评分 → JD 拆解 → … → 入职） | ✅ 需本地后端 |
| 报告仓库 | 分析报告自动存档与查看 | ❌ 纯前端 |

## 使用方式

### 方式一：在线预览（岗位搜索 / 信息库 / 报告仓库可用）

直接访问 [https://rsaaaa9.github.io/pleadly-web/](https://rsaaaa9.github.io/pleadly-web/)，前三个 Tab 可直接使用。

> ⚠️ **「AI 分析」需本地后端**：它会请求 `localhost:7860` 的 API，在线访问时浏览器会显示「离线模式」。这是有意为之——AI 分析依赖真实的 DeepSeek API 调用，不适合公开静态部署。

### 方式二：本地完整版（四个 Tab 全可用）

1. 克隆并启动主项目后端（见 [Rsaaaa9/Pleadly](https://github.com/Rsaaaa9/Pleadly)），默认运行在 `localhost:7860`；
2. 双击本仓库的 `index.html`（或本地起一个静态服务）；
3. 四个 Tab 全部可用，包括 AI 分析。

## 技术

纯前端 HTML + CSS + JavaScript，单文件、零依赖，数据本地持久化（localStorage），无任何外部请求。

## License

MIT © 2026 Rsaaaa9

---

## English

Pleadly Web is the pure-frontend web version of [Pleadly](https://github.com/Rsaaaa9/Pleadly), a full-pipeline AI job-search assistant. Single-file, zero-dependency, runs offline.

**Four tabs:** Job Search (built-in Shenzhen AI/game/product jobs) · Library (local resume/portfolio management) · AI Analysis (10-step pipeline, requires local backend) · Reports (auto-archived).

**Online preview:** https://rsaaaa9.github.io/pleadly-web/ — Job Search, Library and Reports work directly. AI Analysis intentionally requires the local backend (`localhost:7860`) since it makes real LLM API calls.

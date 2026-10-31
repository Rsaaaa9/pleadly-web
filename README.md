# Pleadly Web — AI 求职助手（Web 版）

> AI 求职助手的纯前端 Web 版：**信息库 · 一键生成（简历 + 分析报告） · 报告仓库 · 模拟面试**。
> 单文件、零依赖、可离线运行。

🔗 在线预览：**https://rsaaaa9.github.io/pleadly-web/**

---

## 这是什么

Pleadly（我求你了）是一个「AI 招聘经理」视角的全流程求职助手。本仓库是它的 **Web 版**——一个单文件纯前端应用，浏览器打开即用，数据本地持久化（localStorage）。

完整主项目（Python 后端 + 10 步 Agent 工作流 + RAG）：[github.com/Rsaaaa9/Pleadly](https://github.com/Rsaaaa9/Pleadly)

## 功能（4 个 Tab）

| 功能 | 说明 |
|-----|------|
| 信息库 | 简历 / 作品集 / 项目经历的本地管理，一键生成时自动作为背景 |
| 一键生成 | 粘贴 JD → 左侧一页针对性简历（可下载 Word / PDF）+ 右侧一页分析报告（可下载 PDF），左右对称展示 |
| 模拟面试 | 按岗位逐题追问、逐轮复盘 |
| 报告仓库 | 每次生成自动存档，点开可还原当时的简历与报告 |

调用方式是 BYOK：在「设置」里填自己的 API Key（DeepSeek 等 OpenAI 兼容接口），数据不出本机。

## 使用方式

1. 打开 [https://rsaaaa9.github.io/pleadly-web/](https://rsaaaa9.github.io/pleadly-web/)，或双击本仓库的 `index.html`；
2. 在「信息库」上传简历，在「设置」填入自己的 API Key；
3. 进入「一键生成」粘贴 JD，拿到简历和报告。

## 技术

纯前端 HTML + CSS + JavaScript，单文件、零依赖，数据本地持久化（localStorage），无任何外部请求。

## License

[MIT License](LICENSE) © 2026 Rsaaaa9

自由使用、修改、分发，保留版权声明与许可声明即可。

## 致谢与第三方许可

本项目的部分**提示词方法论**改编自以下 MIT 许可的开源项目，版权声明已逐字保留：

| 项目 | 许可 |
|---|---|
| [Paramchoudhary/ResumeSkills](https://github.com/Paramchoudhary/ResumeSkills) | MIT © 2026 Resume Skills |
| [wyh0626/resume-optimizer](https://github.com/wyh0626/resume-optimizer) | MIT © 2024 wyh0626 |
| [Claycui828/ASu-resume-skills](https://github.com/Claycui828/ASu-resume-skills) | MIT © 2026 Claycui828 |
| [lgd8981289/ocr-skill](https://github.com/lgd8981289/ocr-skill) | MIT © 2026 lgd_sunday |
| [campus-apply/campus-apply](https://github.com/campus-apply/campus-apply) | MIT © 2026 Wenkai Qu |

未复制任何来源项目的源代码；移植的是提示词层的检查清单与方法论，且均为中文重写版本。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，各许可证全文存于 `third_party/`。

本项目与上述项目**无任何官方合作或背书关系**。

---

## English

Pleadly Web is the pure-frontend web version of [Pleadly](https://github.com/Rsaaaa9/Pleadly), a full-pipeline AI job-search assistant. Single-file, zero-dependency, runs offline.

**Features:** Library (local resume/portfolio management) · One-Click (paste a JD → a one-page tailored resume on the left, downloadable as Word or PDF, and a one-page report on the right) · Mock Interview · Reports (auto-archived, reopenable).

**Online preview:** https://rsaaaa9.github.io/pleadly-web/ — bring your own API key (DeepSeek or any OpenAI-compatible endpoint); nothing leaves your browser.

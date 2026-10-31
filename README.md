# Pleadly Web — AI 求职助手（Web 版）

> 一个页面，两个输入框，一次生成：**左边分析报告，右边针对性简历**。
> 单文件、零依赖、可离线打开，用自己的 API Key。

🔗 在线预览：**https://rsaaaa9.github.io/pleadly-web/**

---

## 这是什么

Pleadly（我求你了）是一个「AI 招聘经理」视角的求职助手。本仓库是它的 **Web 版**——一个单文件纯前端应用，浏览器打开即用，输入保存在本机 localStorage。

完整主项目（Python 后端 + 10 步 Agent 工作流 + RAG）：[github.com/Rsaaaa9/Pleadly](https://github.com/Rsaaaa9/Pleadly)

## 页面结构

```
┌───────────────── 顶部：AI 模型 + API Key ──────────────────┐
├──────────────────────┬───────────────────────────────────┤
│  分析报告（大框）      │  简历（大框，可点文字直接改）        │
├──────────────────────┼───────────────────────────────────┤
│  简历粘贴处（小框）    │  JD 粘贴处（小框）                  │
└──────────────────────┴───────────────────────────────────┘
                      [ 开始生成 ]
```

| 位置 | 作用 |
|-----|------|
| 顶部模型栏 | 选择模型（DeepSeek Flash / Chat / Reasoner / 自定义），填入自己的 API Key；「接口设置」可改接口地址 |
| 左大框 | 分析报告：一句话结论、简历要改的 3 处、你还缺什么、面试大概率会问 |
| 右大框 | 按 JD 定制的单页简历，6 套模板；**支持点选文字直接修改**；「放大」全屏编辑；「打印简历」在打印对话框里另存为 PDF |
| 左小框 | 粘贴你现在的简历全文 |
| 右小框 | 粘贴目标岗位 JD |
| 开始生成 | 一次点击，两份结果并发生成 |

调用方式是 BYOK：Key 只存在浏览器本地，请求直连你自己填的接口，不经过任何中转服务器。

## 使用方式

1. 打开 [https://rsaaaa9.github.io/pleadly-web/](https://rsaaaa9.github.io/pleadly-web/)，或双击本仓库的 `index.html`；
2. 顶部选模型、填 API Key（点「保存」）；
3. 左下粘贴简历、右下粘贴 JD，点「开始生成」；
4. 简历不满意就换模板，或直接在简历框里改字，再点「打印简历」导出 PDF。

## 技术

纯前端 HTML + CSS + JavaScript，单文件、零依赖。除你自己填写的模型接口外，不向任何第三方发起请求。

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

**One page:** pick a model and paste your own API key at the top; the report renders in the top-left pane and the tailored one-page resume in the top-right; paste your resume and the JD into the two lower panes and hit **Start**. The resume can be edited in place, enlarged to full screen, and printed to PDF.

**Online preview:** https://rsaaaa9.github.io/pleadly-web/ — DeepSeek or any OpenAI-compatible endpoint; nothing leaves your browser except the requests you send to that endpoint.

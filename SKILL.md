---
name: md-doc-processing
description: 把网页教程/文档/知识库站点批量提取为 Markdown 文档（一章节一文档、图片下载内嵌），并系统化处理各类特殊格式：交互动画/动图组件录制成 GIF 或截图、内联 SVG 抽成带样式的独立文件、KaTeX 公式恢复、两类代码容器与嵌套围栏修复、过度转义清理；附带代码容器数量对账与回归校验。触发场景：把网页/教程转为 md、保存网页内容为文档、动图或动画组件保存为 GIF、md 中 SVG/公式/代码块显示异常修复、批量抓取文档站、webpage/tutorial to markdown、scrape docs、record animation as GIF。
version: "1.0.0"
license: MIT
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# md 文档处理 — 网页 → Markdown 知识库

把文档类网页（教程站、知识库、文章集）**逐章**提取为 Markdown，并保证**特殊格式忠实还原**。
本技能来自一次完整实战（49 章网页教程 → 49 个 md + 248 个媒体资产，校验 0 问题），
所有方法均经过渲染比对验证。

## 适用 / 不适用

| ✅ 适用 | ❌ 不适用 |
|---|---|
| 教程/文档站批量转 md（章节 = 文档） | 需要登录态/交互后才有内容的页面（先自行处理认证） |
| 修复已提取 md 中的特殊格式问题（动图、SVG、公式、代码块） | 表格/图表重排版为原生 md 表格（本技能按原样下载为图片） |
| 把网页动画组件制作为 GIF/图片资产 | 大规模爬虫工程（本技能面向单站几十~几百页的资料化提取） |

## 四条核心原则

1. **忠实原文**：只含教程正文（含正文中的链接），不增删附注；页面的怪异性（含站点自身的样式
   冲突瑕疵）如实保留——它也是"原文"。
2. **先落盘再处理**：抓取阶段只做"取回 HTML 存文件"，转换、样式修复、清理全部在本地文件上进行，
   可反复重跑而不重复抓取。
3. **代码块内外区别对待**：一切文本清洗（反转义、去实体、折叠空行）**只作用于代码块之外**；
   围栏内保持逐字节忠实。
4. **一切靠对账**：每个特殊格式处理都要有可量化的校验（数量对账 / 渲染比对 / 回归检查），
   不靠"看起来没问题"。

## 总体流程（四阶段）

```
① 侦察        ② 抓取(A)              ③ 转换(B)               ④ 校验(C)
页面结构 ──→ raw/NN.html + pages.json ──→ OUT/*.md + images/ ──→ 对账 + 渲染抽查
章节列表      agent-browser 逐章        cheerio+turndown        verify_output.mjs
                                       + 特殊格式处理器
```

## 特殊格式快速决策表 ★

遇到以下内容时，按对应方法处理；详细做法与代码见 `references/special-formats.md`：

| 页面上的内容 | 判定 | 处理方法 |
|---|---|---|
| 代码块（两种常见容器） | `<pre class="prettyprint">`：换行是文本里的真实 `\n` | 取 `textContent` 转围栏代码块（第 1 节） |
| | `<div class="example_code">`：SyntaxHighlighter 风格（token span + `<br>` + `&nbsp;` 缩进） | 按 DOM 顺序走文本、`<br>`→`\n`、丢弃 `<br>` 旁的格式换行符、保留 nbsp 缩进（第 1 节） |
| 代码内容里出现 ` ``` ` | 嵌套围栏冲突 | 外层围栏自动加长为内容中最长反引号串 +1（第 2 节） |
| 内联 `<svg>` 流程图 | 独立成文件后颜色/字体丢失（黑块） | 抽为 `.svg` 文件，**内嵌**其用到的页面 CSS 规则 + **解析 CSS 变量** + 用 viewBox 补宽高（第 3 节） |
| 数学公式（KaTeX/MathJax） | `span.katex` + `<annotation encoding="application/x-tex">` | 从注解恢复 LaTeX → `$$...$$`（注意双重转义 `\\`→`\`、`\\_`→`_`）（第 4 节） |
| **交互动画组件（动图）** | 连续循环/可重播动画（抓 `@keyframes`/`requestAnimationFrame` 特征） | **录制成 GIF**：`record_widget.sh`（第 5 节） |
| 一次性入场动画 + 静态展示组件 | 0.4s 弹入后固定，无循环 | **截图 PNG**：`capture_widget_png.sh`（静态图对文字更清晰）（第 5 节） |
| 文本出现 `\_` `\.` `\[` 等转义残留 | turndown 过度转义 | 代码块外**定向反转义**（有安全规则表，第 6 节） |
| 图片 | `<img>`（含 svg/webp） | 下载到 `images/`，按 basename 去重命名，改写相对路径（第 7 节） |

## 环境与依赖

- **Node.js** + `npm i cheerio turndown turndown-plugin-gfm`（转换）
- **agent-browser**（抓取/录制；开工前先 `agent-browser doctor` 确认可用）
- **ffmpeg**（转 GIF / 裁剪，需在 PATH）
- 浏览器自动化的关键坑与对策：**必读** `references/browser-pitfalls.md`
  （守护进程卡死 ↔ 拦截追踪域名；`open` 不可靠 ↔ eval 导航等）

## 文档索引

| 文件 | 内容 |
|---|---|
| `references/special-formats.md` | **特殊格式处理手册（核心）**：动图录制、SVG 带样式抽取、公式、代码容器、转义清理 |
| `references/pipeline.md` | 完整流程：章节列表发现、四阶段命令模板、输出约定 |
| `references/browser-pitfalls.md` | agent-browser 踩坑与对策（卡死、导航、会话、后台任务） |
| `references/verification.md` | 校验清单：对账方法、回归检查、渲染比对、历史反例库 |
| `scripts/` | 可执行模板：抓取→转换→校验 + 动图录制/截图脚本（见 scripts/README.md） |

## 最短上手路径

1. 读 `references/browser-pitfalls.md`（5 分钟，避免最常见的卡死）
2. 读 `references/pipeline.md`，按步骤配置 `scripts/` 里脚本顶部的路径与选择器
3. 先跑**一章**验证 → 全量跑 A（抓取） → B（转换） → C（校验）
4. 全量完成后按 `references/verification.md` 做渲染抽查

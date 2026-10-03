# scripts 使用与适配说明

本目录是「网页 → Markdown 知识库」流水线的可执行模板。全部脚本都在真实项目中跑通过
（一次完整提取：49 章网页教程 → 49 个 md + 248 个图片/媒体资产，校验 0 问题）。

## 流水线总览

```
                 build_extract.mjs（+ extract.js）          build_convert.mjs              verify_output.mjs
网页章节列表 ──────────────────────────────→ raw/NN.html ──────────────────────→ OUT/*.md ──────────────────→ 校验报告
             agent-browser 逐章抓取正文        + pages.json    cheerio+turndown 转换        + OUT/images/
```

## 依赖

| 组件 | 用途 | 安装 |
|---|---|---|
| Node.js ≥ 18 | 运行 .mjs 脚本 | — |
| cheerio / turndown / turndown-plugin-gfm | HTML→MD 转换 | `npm i cheerio turndown turndown-plugin-gfm` |
| agent-browser | 浏览器抓取 / 录制动画 | `npm i -g agent-browser && agent-browser install` |
| ffmpeg | 视频转 GIF / 图片裁剪 | 系统安装即可，需在 PATH |

## 各脚本职责

| 脚本 | 阶段 | 说明 |
|---|---|---|
| `extract.js` | A | 浏览器端注入脚本：取回标题 + 正文 innerHTML。**改 `CONTENT_SELECTOR` 适配站点** |
| `build_extract.mjs` | A | 章节抓取驱动：填章节清单后逐页抓取，存 `raw/NN.html` + `pages.json` |
| `build_convert.mjs` | B | 核心转换器：清理 + 特殊格式处理 + 图片下载 + md 输出 |
| `verify_output.mjs` | C | 对账与回归校验（代码容器数、围栏配对、转义残留、图片完整性） |
| `record_widget.sh` | B 辅助 | 交互动画组件 → 录制 → GIF |
| `capture_widget_png.sh` | B 辅助 | 静态展示型组件 → 截图 → PNG |
| `_common.sh` | 公共 | 会话初始化、追踪域名拦截、eval 导航、元素测量 |

## 适配一个新站点的步骤

1. 用 `agent-browser` 打开目标页，确认**正文容器选择器**（改 `extract.js`）与
   **章节列表来源**（改 `build_extract.mjs` 的 `chapters` 数组）。
2. 修改三个脚本顶部的路径常量：`S`（会话名）、`TMP`（工作目录）、`OUT`（输出目录）。
3. 先跑**一章**验证全流程（可把 chapters 只留一章），抽检 md 效果；
   若站点还有特殊容器（自绘代码块/公式/动画组件），按 `references/special-formats.md`
   在 `build_convert.mjs` 的对应处理器段落中增改。
4. 全量跑 A→B→C，人工抽查 + 渲染验证（见 `references/verification.md`）。

## 约定

- 输出文档只含教程正文（含正文中的链接），不添加额外附注；
- 图片与媒体资产集中在 `OUT/images/`，md 中以相对路径 `images/xxx` 引用；
- 文件名 `NN-<章节标题>.md`，编号即教程顺序。

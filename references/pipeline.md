# 完整提取流程（四阶段）

本文给出从零开始提取一个文档站的全流程与命令模板。脚本在 `scripts/`，适配说明见其 README。

---

## 阶段 0：侦察（一次性，10 分钟）

1. **开命名会话**（不要用默认共享会话）：

   ```bash
   S=$(agent-browser session id --scope worktree --prefix mdtool)
   export AGENT_BROWSER_SESSION="$S"
   agent-browser doctor --offline --quick   # 确认环境正常
   ```

2. **拦截第三方域名**（**必做**，防盗链/广告/统计脚本卡死守护进程，详见 browser-pitfalls.md）：

   ```bash
   for p in "**/*google-analytics*" "**/*googletagmanager*" "**/*googlesyndication*" \
            "**/*doubleclick*" "**/*adsbygoogle*" "**/*umeng*" "**/*cnzz*"; do
     agent-browser --session "$S" network route "$p" --abort
   done
   ```

3. **eval 导航**到教程首页（`open` 命令不可靠）：

   ```bash
   printf "location.href='https://站点/教程首页.html';'nav'\n" | agent-browser --session "$S" eval --stdin
   # 轮询直到 get url 等于目标 URL（脚本 _common.sh 的 md_tool_nav 已封装）
   ```

4. **发现章节列表**——通常在教程页左侧栏/目录区，一招取回：

   ```bash
   cat <<'EOF' | agent-browser --session "$S" eval --stdin --json
   (() => JSON.stringify(
     Array.from(document.querySelectorAll('#leftcolumn a')).map(a => ({ text: a.innerText.trim(), href: a.getAttribute('href') }))
   ))()
   EOF
   ```

   把结果按顺序填进 `build_extract.mjs` 的 `chapters` 数组（`[标题, 相对路径]`）。

5. **确认正文容器**：`document.querySelector('#content')` 是否为正文（不含导航/广告/评论）。
   确定后同步修改 `extract.js` 的 `CONTENT_SELECTOR` 与校验脚本中的对应判断。

6. **看一张页面的"特殊格式清单"**：搜 `@keyframes|requestAnimationFrame|<canvas|<svg|class="katex|example_code|\.gif`
   ——决定需要哪些特殊处理器（见 special-formats.md 的决策表）。

---

## 阶段 A：抓取（build_extract.mjs）

- 逐章：eval 导航 → 轮询 URL → 等 `readyState=complete` → 注入 `extract.js` 取回元数据 + 正文 HTML。
- 每页落盘 `TMP/raw/NN.html`，元数据累计到 `TMP/pages.json`：
  `{ i, url, sbTitle, docTitle, h1, contentLen, file, ok }`。
- 失败重试 3 次（评据：`ready==='complete' && contentLen>200 && h1` 非空）；失败的章节记录后继续，
  最后统一补跑；**不要把正文打到 stdout**（会淹没上下文），直接落盘。
- 观测：脚本逐行打印 `NN OK len=… h1="…"`，49 章全量约 1~2 分钟；期间可 `tail -f` 日志。

## 阶段 B：转换（build_convert.mjs）

流程（顺序有意义）：

```
捕获页面 CSS（供 SVG 内嵌）
→ 删噪音（style/script/复制按钮/广告位）
→ 删空段落 → 链接绝对化 → iframe 占位
→ KaTeX 公式 → 通用 img 登记 → 内联 SVG 抽取（内嵌CSS+变量解析）
→ 动画组件替换为媒体引用
→ example_code → pre 统一成围栏（含嵌套围栏加长）
→ turndown(gfm) → 后处理（实体/空白/定向反转义）
→ 写 NN-标题.md + 下载图片 + 内联资产落盘
```

关键约定：

- **文件名**：`NN-<h1 标题>.md`（两位编号即教程顺序；标题含 `<>:"/\|?*` 时替换为 `-`；
  重名时追加来源 slug）。
- **图片与媒体**：统一 `OUT/images/`，md 内相对路径引用；
  SVG 抽取 `inline-<slug>-<n>.svg`；动画组件 `record_widget.sh` 输出 `*-demo.gif/.png`。
- **只保留正文**：不添加"来源链接/生成时间"等附注（除非需求方明示）。
- **重跑安全**：图片下载"已存在即跳过"；md 全量重写；修改任何处理器后只需重跑 B（无需重抓）。

## 阶段 C：校验（verify_output.mjs）+ 人工抽查

机器校验：见 `verification.md` 全部检查项（对账/回归/完整性）。

人工抽查（机器测不出的"渲染正确性"）：

1. 每类特殊格式各抽 1 个章节，**读 md 原文**确认格式忠实（代码缩进、公式、图注）；
2. 把抽取的 `.svg`、录制的 `.gif/.png` 用浏览器打开截图，与线上页面比对；
3. 随机抽 2~3 个"普通章节"通读，确认无串行、缺段。

## 输出目录约定（推荐）

```
知识库根/
└── <教程名>/
    ├── 01-<章节标题>.md
    ├── 02-<章节标题>.md
    ├── ...
    └── images/            # 图片 + 内联 svg + 录制的 gif/png
```

（若后续还会有其他教程，工具脚本建议放知识库根部 `_tools/`，一教程一子目录。）

## 命令速查模板

```bash
# 阶段 A（后台跑，日志观察）
node scripts/build_extract.mjs 2>&1 | tee logs/extract.log

# 阶段 B
node scripts/build_convert.mjs 2>&1 | tee logs/convert.log

# 阶段 C
node scripts/verify_output.mjs

# 特殊格式辅助
bash scripts/record_widget.sh <url> <selector> out.gif 11 <restart_selector> 1.0
bash scripts/capture_widget_png.sh <url> <selector> out.png
```

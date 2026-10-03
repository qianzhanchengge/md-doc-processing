# 特殊格式处理手册

本手册覆盖网页转 md 时最易出错、也最影响阅读体验的特殊格式。所有代码均已实战验证。

---

## 1. 代码块的两种容器（必须都处理，只认 `<pre>` 会漏一半）

### 1.1 `pre.prettyprint`（prettify 高亮）

换行是文本节点里的真实 `\n`，语法高亮只是 `<span>`。直接取 `textContent` 即可，不要逐 span 拼接。

### 1.2 `div.example_code`（SyntaxHighlighter 风格）

特征：逐 token 的 `<span style="color:...">`，**换行靠 `<br>`**，缩进靠 `&nbsp;`，末尾可能有复制按钮。
被当作普通文本转换时，输出会是「每个字符都被反斜杠转义 + 每行尾随两个空格」的乱码——用户可见的
典型症状是「代码块错乱」。

转换要点（按 DOM 顺序遍历，三条铁律）：

1. `<br>` → `\n`；
2. **丢弃 `<br>` 旁边的 HTML 格式换行符**（`<br>` 后源码里还有一个 `\n`，不丢会导致每行代码后多一个空行）；
3. **保留同一文本节点里的 `&nbsp;` 缩进**（` `→空格），这是代码缩进。

```js
function extractExampleCode($, root) {
  let out = '';
  const walkChildren = (parent) => {
    const kids = (parent && parent.children) || [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.type === 'text' && k.data) {
        const prev = kids[i - 1], next = kids[i + 1];
        const nearBr = (prev && prev.type === 'tag' && prev.name === 'br')
                    || (next && next.type === 'tag' && next.name === 'br');
        if (nearBr) {
          if (/^[ \t]*\r?\n[ \t]*$/.test(k.data)) continue;          // 纯格式换行 -> 丢
          const lead = k.data.match(/^[ \t]*\r?\n[ \t]*/);            // 换行+缩进 -> 只去换行
          if (lead) { if (lead[0].length < k.data.length) out += k.data.slice(lead[0].length); continue; }
        }
      }
      walk(k);
    }
  };
  const walk = (node) => {
    if (node.type === 'text') { out += node.data; return; }
    if (node.type !== 'tag') return;
    const name = (node.name || '').toLowerCase();
    if (name === 'br') { out += '\n'; return; }
    if (name === 'button' || name === 'i') return;              // 跳过复制按钮/图标
    walkChildren(node);
  };
  walkChildren($(root).get(0));
  let text = out.replace(/ /g, ' ').replace(/\r/g, '');
  text = text.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}
```

转换流程中先全局删除复制按钮：`$('button.copy-code-button, .copy-code-button').remove()`，
再对 `div.example_code` 逐个替换为 `<pre data-lang=""><code>…</code></pre>`，交给统一围栏规则。

---

## 2. 嵌套围栏：代码内容本身含 ` ``` `

围栏内出现 ` ``` ` 行会把外层围栏提前闭合（或产生不配对）。**外层围栏取内容中最长连续反引号串 +1**：

```js
turndown.addRule('preFenced', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const lang = (node.getAttribute('data-lang') || '').trim();
    let text = (node.textContent || '')
      .replace(/ /g, ' ').replace(/​/g, '')
      .replace(/[ \t]+$/gm, '').replace(/^\n+/, '').replace(/\n+$/, '');
    let maxRun = 0;
    for (const m of text.matchAll(/`{3,}/g)) maxRun = Math.max(maxRun, m[0].length);
    const fence = '`'.repeat(Math.max(3, maxRun + 1));
    return '\n\n' + fence + lang + '\n' + text + '\n' + fence + '\n\n';
  },
});
```

校验时围栏配对必须按 **CommonMark 规则**：闭合围栏长度 ≥ 开启围栏长度、闭合行不能带 info string、
还要先剥掉引用块前缀（`> ```  ` 在引用块内也合法）。详见 `verification.md`。

---

## 3. 内联 `<svg>` → 带样式的独立 `.svg` 文件

**目标**：把页面中的内联 svg 抽成独立文件并用 `![](images/xxx.svg)` 引用，保持与网站一致的渲染。

**不处理会怎样**：网页内联 svg 常把颜色/字体放在页面 `<style>` 的 CSS 类里（如 `.c-teal rect{fill:…}`）
或 CSS 变量里（`fill="var(--c-teal-fill)"`）。直接序列化会丢掉这些样式 → 渲染成**黑块/无样式**。

**处理三步**：

1. **内嵌用到的 CSS 规则**：收集 svg 子树中用到的所有 class，把页面样式里 selector 含这些 class 的
   规则（以及 `svg` 前缀规则）复制进 svg 的 `<style>`：

```js
function extractCssSupport(cssText, classNames) {
  if (!cssText) return '';
  const cleaned = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const ruleRe = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(cleaned))) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!sel || !m[2].trim()) continue;
    let match = sel === 'svg' || sel.startsWith('svg ');
    if (!match) {
      match = classNames.some((c) => {
        const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('\\.' + esc + '(?![-\\w])').test(sel);
      });
    }
    if (match) out.push(sel + ' { ' + m[2].trim() + ' }');
  }
  return out.join('\n');
}
```

2. **解析 CSS 变量**（否则 `var(--x)` 无定义 = 黑块）：从页面样式收集 `--name: value` 定义，
   对 svg 序列化文本与 css 规则做多轮 `var()` 替换（支持 `var(--x, fallback)` 与嵌套变量）：

```js
function resolveCssVars(text, varMap) {
  if (!varMap || varMap.size === 0 || !text.includes('var(')) return text;
  let out = text;
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (m, name, fb) => {
      let val = varMap.get(name);
      if (val === undefined || val === '') val = fb !== undefined ? fb.trim() : m;
      return val;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}
// varMap 构建: pageCssText.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)  （后定义覆盖先定义）
// 若有 var() 解析不干净，再把全部变量定义作为 :root{...} 兜底嵌入。
```

3. **补全根元素属性**：确保 `xmlns="http://www.w3.org/2000/svg"`；有 viewBox 时把
   `width/height` 写成 viewBox 的实际数值（去掉 `width="100%"` 之类，避免部分渲染器显示成默认尺寸）。

```js
let html = resolveCssVars($.html($el) || '', varMap);
if (!/xmlns=/.test(html)) html = html.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
const vb = html.match(/viewBox="([\d.\s-]+)"/);   // viewBox 的 w/h 写入 width/height
// …（替换 openTag 中的 width="…"/补 height）
const styleTag = svgCss ? '<style>' + svgCss.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</style>' : '';
if (styleTag) html = html.replace(openTag, openTag + styleTag);
```

**验证**：把独立 svg 放进浏览器（`agent-browser tab new "file:///…/x.svg"` + 截图）与页面原图比对。
纯内联属性（无 class、无 var）的 svg 无需处理，保持原样。文件命名建议
`inline-<页面slug>-<序号>.svg`。

---

## 4. KaTeX / MathJax 数学公式

页面结构：`<span class="katex">` 内含 `<span class="katex-mathml">`（MathML，**是噪音**）与
`<span class="katex-html">`（视觉渲染，含内嵌 svg 符号，**也是噪音**），真正的来源是
`<annotation encoding="application/x-tex">` 里的 LaTeX。

**处理**：先于 svg 抽取执行（否则公式里的根号 svg 会被单独抽出），把整个 `.katex` 元素替换为
`<p>$$ latex $$</p>`：

```js
let tex = (ann.text() || '')
  .replace(/\\\\_/g, '_')     // 注解是双重转义：\\_ 本义是下标 _
  .replace(/\\\\/g, '\\')     // \\text -> \text 等
  .trim();
```

两个补充：
- turndown 会把文本里的 `\` 再转义成 `\\`、`_` 转义成 `\_`——对 `$$ … $$` 行做**围栏外的行级修复**：
  `return rawLn.replace(/\\\\/g, '\\').replace(/\\_/g, '_');`
- 校验：最终 md 中公式行应形如 `$$ \frac{\sum_{i=1}^{n} A_i B_i} … $$`（单反斜杠、真下标）。

---

## 5. 交互动画组件 → GIF / PNG（动图处理）★

### 5.1 先判定类型（决定输出 GIF 还是 PNG）

| 特征（在页面源码中查找） | 类型 | 输出 |
|---|---|---|
| `@keyframes` 循环动画、`requestAnimationFrame` 驱动、有重播按钮、内容随时间持续变化 | **连续动画** | **GIF**（动图） |
| 只有入场动画（如 `animation: popIn .4s`，一次性），之后内容静止；或纯静态可视化 | **静态展示** | **PNG 截图**（静态图对文字更清晰） |

全库扫描方法（避免漏网）：对所有页面搜 `@keyframes`、`requestAnimationFrame`、`<canvas`、
`<video`、`.gif`、以及已知动画组件的 class 名，逐一确认。

### 5.2 GIF 录制流程（`scripts/record_widget.sh` 已封装全流程）

```bash
# 用法: record_widget.sh <页面URL> <组件CSS选择器> <输出GIF> [秒数=11] [重播按钮选择器] [起点裁剪秒=0.5]
bash scripts/record_widget.sh \
  "https://example.com/tutorial/page.html" \
  "#demo-widget" "../images/demo-widget.gif" 11 ".demo-widget__btn" 1.0
```

脚本内部顺序（每一步都是踩过的坑，勿省）：

1. **先拦截第三方广告/统计域名**（`network route … --abort`，列表见 browser-pitfalls.md），
   否则页面加载会把守护进程卡到无响应；
2. **eval 导航 + 轮询 `get url`**（不要依赖 `open` 命令）；
3. `scrollintoview` 目标组件，`getBoundingClientRect` 取视口坐标 `[x,y,w,h]`（录制与截图共用该坐标系，
   所以录制期间**不要滚动**、DPR 保持 1）；
4. `record start` → **点击重播按钮**使动画从第一帧开始 → 等待（覆盖 1~2 个完整循环）→ `record stop`；
5. ffmpeg 裁剪 + 调色板转 GIF：

```bash
ffmpeg -v error -ss 1.0 -i rec.webm -t 11 \
  -vf "crop=680:512:299:56,fps=12,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle" \
  -loop 0 out.gif -y
```

经验参数：`fps=12`、`max_colors=192`（够清晰且体积小，一个 11 秒 680×512 的界面类 GIF 约 850KB）；
`diff_mode=rectangle` 显著减小体积。体积超标时优先降 `max_colors`/`fps`，不要盲目缩尺寸。

### 5.3 录制后必须做的两项检查

1. **抽帧视图检查**：`ffmpeg -ss <t> -i rec.webm -frames:v 1 -vf "crop=W:H:X:Y" frame.png`，
   用图片查看器确认动画内容、裁剪框、起止状态；
2. **首尾帧时间线检查**：抽 4~5 个时间点的帧确认动画循环周期（例：重播后第 1/4/7/10 秒），
   据此决定 `-ss`（起点）与 `-t`（时长），让循环自然。

### 5.4 真相核查：录到"奇怪的东西"时不要急着修

实战案例：某动画右端始终有个小白框，追查后确认是**网页主题的全局 CSS（`span.new` 规则）
与组件类名撞车**导致的页面自身效果——任何访客看到的都一样。**忠实记录即可，不属于转换 bug**。
判定方法：把同一元素在"实时页面截图"与"录制帧"里做像素级比对（定位/尺寸/闪烁周期），
并用 `document.elementsFromPoint(x,y)` / 遍历 `document.styleSheets` 找匹配规则定位来源。

### 5.5 静态展示型组件的 PNG 流程

```bash
bash scripts/capture_widget_png.sh "https://example.com/tutorial/token.html" ".token-display" token-demo.png
```

组件完整可见 → 视口截图 + 视口坐标裁剪；组件高于视口 → `--full` 全页截图 + 整页坐标
（`rect.x + scrollX`）裁剪。注意：截图前也须拦截追踪域名、eval 导航。

### 5.6 把媒体资产接进转换器

在 `build_convert.mjs` 的**通用 img 下载处理器之后**（避免下载器误处理本地路径），
把组件整体替换为 img 引用：

```js
$('.llm-think').replaceWith($('<img>').attr('src','images/llm-think-demo.gif').attr('alt','大模型逐字预测演示（动画）'));
$('.token-display').replaceWith($('<img>').attr('src','images/token-demo.png').attr('alt','Token 切分演示'));
```

录制的 GIF/PNG 复制进 `images/` 即成为普通资产，校验脚本会一并做存在性检查。

---

## 6. 过度转义清理（只动代码块之外）

turndown 会保守地把文本里的 `_ . [ ] ( ) = # > !` 等字符加反斜杠转义。渲染上大多无害，
但对知识库检索（grep/全文检索）有害：搜 `SECRET_KEY` 匹配不到 `SECRET\_KEY`。

**安全规则表**（围栏感知：先按 CommonMark 剔除代码块，只处理块外行）：

| 转义形式 | 处理 | 原因 |
|---|---|---|
| `\_`（两侧均为文字/数字，如 `SECRET\_KEY`） | 反转义为 `_` | 词内下划线不产生强调，安全 |
| `\.`（标题行内、或行中） | 反转义为 `.` | 标题/行中不会变成有序列表 |
| `\.`（行首 `数字\.`，如 `1\. 说明`） | **保留** | 反转义会变成有序列表（渲染改变） |
| `\[` `\]`（单反斜杠，如 `\[2034, 789\]`） | 反转义为 `[` `]` | 无配套括号时渲染不变，检索友好 |
| `\\.`、`\\[`（反斜杠自身被转义） | **保留** | 属"转义的反斜杠"，反转义会吞掉一个 `\`（如 Windows 路径） |
| `$$…$$` 数学行内的 `\\` `\_` | 全部还原为单斜杠/单下划线 | LaTeX 源码 |

实现要点：反转义正则加 `(?<!\\)` 前视保护；`$$` 行单独处理并提前 `return`。

---

## 7. 图片资产处理

- `<img>` 的 `src` 转绝对 URL → 按路径 basename 生成文件名（非法字符替换、超长截断）→
  **同名不同 URL 时追加 hash 后缀**去重 → 全部下载到 `OUT/images/` → md 内写相对路径 `images/xxx`。
- 下载用并发（6 路） + 已存在则跳过（重跑转换不重复下载） + 失败重试。
- **下载后校验**：① 每个图标引用的文件存在；② 目录中无孤儿文件（未被任何 md 引用）；
  ③ 抽查文件头（magic bytes）确认扩展名与内容一致（防把错误页存成 .png）。
- 懒加载图片：`src` 为空/占位时取 `data-src`。

---

## 8. 小项清单（每个都踩过）

- **删除噪音**：`style, script, button.copy-code-button, .adsbygoogle, link, meta`；
  注意：**先捕获页面 CSS 文本再删除**（第 3 节的 CSS 内嵌依赖它）。
- **空段落**：无文字且无 `img/iframe/video/table` 子元素的 `<p>` 删除。
- **iframe**：替换为 `[嵌入内容: URL]` 链接占位并记录 warning。
- **硬换行**：turndown 的 `<br>` → 两空格换行；后处理折叠空白时**保留恰好两个尾随空格**，只清 1 个的。
- **实体**：` `→空格、`​`→删除；检查残留 `&nbsp;` 等实体。
- **链接**：站内相对路径 → 绝对 URL（`https://站点 + href`）；`javascript:` 链接还原为纯文本。

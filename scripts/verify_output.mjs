// ============================================================================
// verify_output.mjs — 转换结果校验（对账 + 回归检查）
// ----------------------------------------------------------------------------
// 检查项（详见 references/verification.md）：
//   1. CommonMark 围栏配对（含引用块内围栏、变长围栏）
//   2. 代码容器数量对账：raw HTML 中 <pre>+div.example_code 数 == md 代码块数
//   3. 回归检查：代码块内空行占比异常（行间多空行）、代码块外残留转义符
//   4. HTML 标签/实体残留、example_code 残留、图片引用存在性
// 输入: TMP/pages.json + TMP/raw/*.html + OUT/*.md
// 使用前修改 TMP / OUT 两个路径。
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'E:/study_materials/AIAgent/菜鸟教程知识库/AI Agent 教程';
const TMP = 'C:/Users/Admin/.claude/jobs/69106415/tmp';
const pages = JSON.parse(fs.readFileSync(path.join(TMP, 'pages.json'), 'utf8'));

const mdByNo = {};
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.md'))) mdByNo[Number(f.slice(0, 2))] = f;

let issues = 0;
let totBlocks = 0;
let totRawContainers = 0;
const report = [];

for (const p of pages.filter((x) => x.ok)) {
  const f = mdByNo[p.i];
  if (!f) { console.log('ISSUE page', p.i, ':: missing md file'); issues++; continue; }
  const md = fs.readFileSync(path.join(OUT, f), 'utf8');
  const lines = md.split('\n');

  // CommonMark fence state machine -> count code blocks, collect outside lines
  // (strip blockquote prefixes so fences inside "> ```" blocks are recognized)
  let openFence = null, blocks = 0;
  const outside = [];
  for (const rawLn of lines) {
    const ln = rawLn.replace(/^(\s*>+\s*)+/, '');
    const m = ln.match(/^(`{3,})(.*)$/);
    if (openFence === null) {
      if (m) { openFence = m[1].length; blocks++; continue; }
      outside.push(rawLn);
    } else {
      if (m && m[1].length >= openFence && m[2].trim() === '') openFence = null;
    }
  }

  const text = outside.join('\n');
  const probs = [];
  if (!/^# /.test(md)) probs.push('no-h1');
  if (openFence !== null) probs.push('unclosed-fence');

  // code blocks whose content is mostly empty lines (line-doubling regression check)
  {
    let openLen = null, cur = [];
    const blocks = [];
    for (const rawLn of lines) {
      const l = rawLn.replace(/^(\s*>+\s*)+/, '');
      const fm = l.match(/^(`{3,})(.*)$/);
      if (openLen === null) {
        if (fm) { openLen = fm[1].length; cur = []; }
        continue;
      }
      if (fm && fm[1].length >= openLen && fm[2].trim() === '') { blocks.push(cur); openLen = null; continue; }
      cur.push(l);
    }
    for (const b of blocks) {
      const nonEmpty = b.filter((l) => l.trim() !== '').length;
      const empty = b.length - nonEmpty;
      if (empty > 3 && nonEmpty > 0 && empty >= nonEmpty * 0.9) { probs.push('code-blank-soup(len=' + b.length + ')'); break; }
    }
  }

  // raw container parity: <pre> + div.example_code in raw HTML vs fenced blocks in md
  const rawHtml = fs.readFileSync(path.join(TMP, p.file), 'utf8');
  const rawPre = (rawHtml.match(/<pre[ >]/g) || []).length;
  const rawEc = (rawHtml.match(/<div class="example_code"/g) || []).length;
  const rawContainers = rawPre + rawEc;
  totBlocks += blocks;
  totRawContainers += rawContainers;
  if (rawContainers !== blocks) probs.push(`code-count raw=${rawContainers}(pre=${rawPre},ec=${rawEc}) md=${blocks}`);

  // escaped markdown leftovers outside fences (the previous bug class)
  const escLines = outside.filter((l) => /\\[#*_\[\]()=+~>!.]/.test(l)).length;
  if (escLines >= 20) probs.push('escaped-lines=' + escLines);

  // hard-break soup (broken text blocks had every line ending with two spaces)
  const hardBreaks = outside.filter((l) => /  $/.test(l)).length;
  if (hardBreaks >= 100) probs.push('hard-break-lines=' + hardBreaks);

  const tag = text.match(/<\/?(?:div|span|p|h[1-6]|table|tr|td|th|ul|ol|li|a|img|pre|code|style|button|section|figure|svg)\b[^>]*>/i);
  if (tag) probs.push('html-tag: ' + tag[0].slice(0, 60));
  const ent = text.match(/&(?:nbsp|amp|lt|gt|quot|ldquo|rdquo|mdash|hellip);|&#\d+;/);
  if (ent) probs.push('entity: ' + ent[0]);
  if (text.includes('example_code')) probs.push('example_code-leftover');

  const refs = [...md.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !fs.existsSync(path.join(OUT, r.replace(/\//g, path.sep))));
  if (missing.length) probs.push('missing-img: ' + missing.slice(0, 3).join(','));

  if (probs.length) { issues++; console.log('ISSUE', f, '::', probs.join(' | ')); }
  report.push({ f, chars: md.length, imgs: refs.length, blocks, esc: escLines, hb: hardBreaks });
}

console.log('\ntotal md files   :', report.length, ' | files with issues:', issues);
console.log('code blocks md   :', totBlocks, ' | raw containers:', totRawContainers);
const imgDir = path.join(OUT, 'images');
const imgFiles = fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : [];
const inline = imgFiles.filter((n) => n.startsWith('inline-')).length;
console.log('image files      :', imgFiles.length, `(incl. inline-*.svg: ${inline})`);
console.log('total image refs :', report.reduce((a, r) => a + r.imgs, 0));
console.log('\ntop files by escaped-lines (info):');
for (const r of [...report].sort((a, b) => b.esc - a.esc).slice(0, 5)) console.log(`  esc=${r.esc} hb=${r.hb} blocks=${r.blocks} ${r.f}`);

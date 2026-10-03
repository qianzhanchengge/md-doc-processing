// ============================================================================
// build_convert.mjs — 阶段 B：把抓取到的正文 HTML 转换为 Markdown 文档
// ----------------------------------------------------------------------------
// 输入:  TMP/raw/NN.html + TMP/pages.json（由 build_extract.mjs 产出）
// 输出:  OUT/*.md（一章节一个文档）+ OUT/images/（下载的图片与内联 SVG/媒体资产）
//
// 内置的「特殊格式」处理器（按顺序生效，详见 references/special-formats.md）：
//   1. KaTeX 数学公式   -> 从 x-tex 注解恢复为 $$...$$（注解含双重转义）
//   2. 内联 <svg>       -> 独立 .svg 文件：内嵌页面 CSS 规则 + 解析 CSS 变量 + viewBox 宽高
//   3. 交互动画组件     -> 替换为已录制好的 GIF/PNG 引用（llm-think / token-display 两个示例，
//                          新站点需按实际选择器增改，配合 record_widget.sh 使用）
//   4. example_code     -> SyntaxHighlighter 风格容器（span+<br>+&nbsp;）转标准代码块
//   5. pre.prettyprint  -> 取 textContent；代码含 ``` 时外层围栏自动加长
//   6. 代码块外的过度转义 -> 定向反转义（保护行首列表语义与 \. 路径）
//
// 使用前修改下方 TMP / OUT 两个路径即可。依赖: npm i cheerio turndown turndown-plugin-gfm
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const TMP = 'C:/Users/Admin/.claude/jobs/69106415/tmp';
const BASE = 'https://www.runoob.com';
const OUT = 'E:/study_materials/AIAgent/菜鸟教程知识库/AI Agent 教程';
const IMG_DIR = path.join(OUT, 'images');

const pad = (n) => String(n).padStart(2, '0');

// ---------- image name registry (global, dedup) ----------
const imageMap = new Map(); // absolute url -> local file name
const usedNames = new Map(); // local file name -> absolute url
const inlineAssets = new Map(); // local file name -> svg file content (written directly, not downloaded)

function sanitizeFileName(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash8(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function assignImageName(absUrl) {
  if (imageMap.has(absUrl)) return imageMap.get(absUrl);
  let base;
  try {
    const u = new URL(absUrl);
    base = decodeURIComponent(path.posix.basename(u.pathname)) || 'image';
  } catch { base = 'image'; }
  base = sanitizeFileName(base);
  if (base.length > 90) {
    const ext = path.extname(base);
    base = base.slice(0, 80) + ext;
  }
  let candidate = base;
  if (usedNames.has(candidate) && usedNames.get(candidate) !== absUrl) {
    const ext = path.extname(base);
    candidate = base.slice(0, -ext.length || undefined) + '-' + hash8(absUrl).slice(0, 6) + ext;
  }
  usedNames.set(candidate, absUrl);
  imageMap.set(absUrl, candidate);
  return candidate;
}

// ---------- turndown setup ----------
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});

turndown.use(gfm);

turndown.addRule('preFenced', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const lang = (node.getAttribute('data-lang') || '').trim();
    let text = node.textContent || '';
    text = text.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').replace(/^\n+/, '').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
    let maxRun = 0;
    for (const m of text.matchAll(/`{3,}/g)) maxRun = Math.max(maxRun, m[0].length);
    const fence = '`'.repeat(Math.max(3, maxRun + 1));
    return '\n\n' + fence + lang + '\n' + text + '\n' + fence + '\n\n';
  },
});

turndown.addRule('hrLine', {
  filter: 'hr',
  replacement: () => '\n\n---\n\n',
});

turndown.addRule('imgAlt', {
  filter: 'img',
  replacement: (_c, node) => {
    const src = node.getAttribute('src') || '';
    if (!src) return '';
    const alt = (node.getAttribute('alt') || '').replace(/\n/g, ' ');
    return `![${alt}](${src})`;
  },
});

// ---------- per-page conversion ----------
const warnings = [];

// Walk an example_code container: <br> => newline, spans/text => chars, buttons/icons skipped.
function extractExampleCode($, root) {
  let out = '';
  const walkChildren = (parent) => {
    const kids = (parent && parent.children) || [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      // drop the HTML formatting newline that sits next to a <br> (would double every code line);
      // keep any &nbsp; indentation that follows inside the same text node
      if (k.type === 'text' && k.data) {
        const prev = kids[i - 1], next = kids[i + 1];
        const nearBr = (prev && prev.type === 'tag' && prev.name === 'br') || (next && next.type === 'tag' && next.name === 'br');
        if (nearBr) {
          if (/^[ \t]*\r?\n[ \t]*$/.test(k.data)) continue;
          const lead = k.data.match(/^[ \t]*\r?\n[ \t]*/);
          if (lead) {
            if (lead[0].length < k.data.length) out += k.data.slice(lead[0].length);
            continue;
          }
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
    if (name === 'button' || name === 'i') return;
    walkChildren(node);
  };
  walkChildren($(root).get(0));
  let text = out.replace(/ /g, ' ').replace(/\r/g, '');
  text = text.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}

// Resolve var(--name[, fallback]) references against a collected definition map,
// so standalone .svg files do not depend on page-level custom properties.
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

// Pull CSS rules from the page that match classes used inside an extracted SVG
// (plus root `svg` rules), so standalone .svg files keep their styling.
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

export function convertPage(contentHTML, pageUrl) {
  const $ = cheerio.load(contentHTML, { decodeEntities: true });

  // capture in-page CSS first (needed to embed styles into extracted standalone SVGs)
  const pageCssText = $('style').map((_, el) => $(el).text()).get().join('\n');
  const varMap = new Map();
  for (const m of pageCssText.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) varMap.set(m[1], m[2].trim());

  // strip noise
  $('style, script, button.copy-code-button, .copy-code-button, .adsbygoogle, link, meta').remove();

  // remove empty paragraphs (no text, no media)
  $('p').each((_, el) => {
    const $el = $(el);
    const txt = $el.text().replace(/[\s\u00a0\u200b]/g, '');
    if (txt === '' && $el.find('img, iframe, video, table').length === 0) $el.remove();
  });

  // normalize links: relativize -> absolute runoob URL; drop javascript: hrefs
  $('a').each((_, el) => {
    const $el = $(el);
    const href = ($el.attr('href') || '').trim();
    if (!href || href.startsWith('javascript:')) {
      $el.replaceWith($el.contents());
      return;
    }
    if (href.startsWith('/')) {
      $el.attr('href', BASE + href);
    } else if (href.startsWith('#') || href.startsWith('mailto:')) {
      // keep
    } else if (!/^https?:/i.test(href)) {
      try { $el.attr('href', new URL(href, pageUrl).href); } catch { $el.attr('href', BASE + '/' + href); }
    }
  });

  // iframes: keep as link placeholder
  $('iframe').each((_, el) => {
    const $el = $(el);
    const src = ($el.attr('src') || '').trim();
    warnings.push(`iframe in ${pageUrl}: ${src.slice(0, 100)}`);
    if (src) {
      const abs = src.startsWith('http') ? src : new URL(src, pageUrl).href;
      $el.replaceWith($(`<p><a href="${abs}">[嵌入内容: ${abs}]</a></p>`));
    } else {
      $el.remove();
    }
  });

  // KaTeX math formulas -> display-math paragraphs recovered from the LaTeX annotation
  const katexToMd = (el) => {
    const $el = $(el);
    const ann = $el.find('annotation[encoding="application/x-tex"]').first();
    let tex = (ann.text() || '').replace(/\\\\_/g, '_').replace(/\\\\/g, '\\').trim();
    if (tex) $el.replaceWith($('<p></p>').text('$$ ' + tex + ' $$'));
    else $el.remove();
  };
  $('.katex-display').each((_, el) => katexToMd(el));
  $('span.katex').each((_, el) => katexToMd(el));

  // images -> local names
  let imgCount = 0;
  $('img').each((_, el) => {
    const $el = $(el);
    let src = ($el.attr('src') || '').trim();
    if (!src || src.startsWith('data:')) src = ($el.attr('data-src') || '').trim();
    if (!src || src.startsWith('data:')) { $el.remove(); return; }
    let abs;
    try { abs = new URL(src, pageUrl).href; } catch { $el.remove(); return; }
    if (!/\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)(\?|#|$)/i.test(abs) && !abs.includes('/wp-content/')) {
      // still allow anything from the site's uploads; otherwise keep remote as-is
    }
    const local = assignImageName(abs);
    $el.attr('src', 'images/' + local);
    $el.removeAttr('srcset');
    $el.removeAttr('data-src');
    $el.removeAttr('width');
    $el.removeAttr('height');
    imgCount++;
  });

  // inline <svg> flow diagrams -> standalone .svg files referenced as images
  // (page CSS for classes used inside the svg gets embedded so the file renders standalone)
  let svgIdx = 0;
  $('svg').each((_, el) => {
    const $el = $(el);
    svgIdx++;
    let slug = sanitizeFileName((pageUrl.split('/').pop() || 'page').replace(/\.html?$/, ''));
    let name = `inline-${slug}-${svgIdx}.svg`;
    if (usedNames.has(name)) name = name.replace(/\.svg$/, '-' + hash8(pageUrl + '#' + svgIdx).slice(0, 6) + '.svg');
    usedNames.set(name, pageUrl + '#svg' + svgIdx);

    // collect classes used inside this svg + matching CSS rules from the page
    const classNames = new Set();
    const addCls = (v) => String(v || '').split(/\s+/).forEach((c) => c && classNames.add(c));
    addCls($el.attr('class'));
    $el.find('[class]').each((__, c) => addCls($(c).attr('class')));
    let svgCss = extractCssSupport(pageCssText, [...classNames]);
    svgCss = resolveCssVars(svgCss, varMap);

    let html = resolveCssVars($.html($el) || '', varMap);
    if (!/xmlns=/.test(html)) html = html.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    // if any var() could not be resolved, embed the collected definitions as a backup
    if (/var\(/.test(html) && varMap.size) {
      const rootVars = ':root { ' + [...varMap].map(([k, v]) => k + ': ' + v).join('; ') + ' }';
      svgCss = rootVars + '\n' + svgCss;
    }
    const styleTag = svgCss ? '<style>' + svgCss.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</style>' : '';
    const vb = html.match(/viewBox="([\d.\s-]+)"/);
    let openTag = html.slice(0, html.indexOf('>') + 1);
    if (vb) {
      const p = vb[1].trim().split(/\s+/);
      if (p.length === 4) {
        let nt = openTag;
        if (!/\swidth="[\d.]+"(?=\s|>)/.test(nt)) {
          nt = nt.replace(/\swidth="[^"]*"/, '');
          nt = nt.replace('<svg', `<svg width="${p[2]}"`);
        }
        if (!/\sheight="[\d.]+"(?=\s|>)/.test(nt)) nt = nt.replace('<svg', `<svg height="${p[3]}"`);
        if (nt !== openTag) { html = html.replace(openTag, nt); openTag = nt; }
      }
    }
    if (styleTag) html = html.replace(openTag, openTag + styleTag);
    inlineAssets.set(name, html);
    $el.replaceWith($('<img>').attr('src', 'images/' + name).attr('alt', ''));
    imgCount++;
  });

  // animated / interactive demo widgets -> pre-recorded media assets
  $('.llm-think').replaceWith($('<img>').attr('src', 'images/llm-think-demo.gif').attr('alt', '大模型逐字预测演示（动画）'));
  $('.token-display').replaceWith($('<img>').attr('src', 'images/token-demo.png').attr('alt', 'Token 切分演示'));

  // runoob "example_code" containers: line-based code built from <span> + <br> + &nbsp; indents
  $('div.example_code').each((_, el) => {
    const text = extractExampleCode($, el);
    const $pre = $('<pre></pre>').attr('data-lang', '');
    $pre.append($('<code></code>').text(text));
    $(el).replaceWith($pre);
  });

  // pre blocks: replace syntax-highlight spans with clean code text + lang
  $('pre').each((_, el) => {
    const $el = $(el);
    const codeEl = $el.find('code').first();
    const cls = (codeEl.attr('class') || '') + ' ' + ($el.attr('class') || '');
    const m = cls.match(/(?:language|lang|brush)[-:]([a-zA-Z0-9+#_-]+)/);
    const lang = m ? m[1].toLowerCase() : '';
    const text = $el.text();
    const $code = $('<code></code>').text(text);
    const $pre = $('<pre></pre>').attr('data-lang', lang);
    $pre.append($code);
    $el.replaceWith($pre);
  });

  const bodyHtml = $('body').html() || '';
  let md = turndown.turndown(bodyHtml);

  // post-process
  md = md
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/[ \t]+\n/g, (m) => (m.length - 1 >= 2 ? '  \n' : '\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // targeted, fence-aware unescape (outside code blocks only): turndown escapes punctuation
  // conservatively, which hurts searchability of identifiers (SECRET\_KEY) and "N." headings.
  {
    let inCode = false, codeLen = 0;
    md = md.split('\n').map((rawLn) => {
      const stripped = rawLn.replace(/^(\s*>+\s*)+/, '');
      const m = stripped.match(/^(`{3,})(.*)$/);
      if (inCode) {
        if (m && m[1].length >= codeLen && m[2].trim() === '') inCode = false;
        return rawLn;
      }
      if (m) { inCode = true; codeLen = m[1].length; return rawLn; }
      // display-math lines: restore single backslashes for the LaTeX source
      // (turndown escapes both "\" -> "\\" and "_" -> "\_")
      if (/^\s*\$\$.*\$\$\s*$/.test(rawLn)) return rawLn.replace(/\\\\/g, '\\').replace(/\\_/g, '_');
      let ln = rawLn.replace(/([\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu, '$1_');
      const isHeading = /^(\s*>+\s*)*#{1,6}\s/.test(ln);
      const protectDot = /^(\s*>+\s*)*\s*\d+\\\./.test(ln);
      if (isHeading || !protectDot) ln = ln.replace(/(?<!\\)\\\./g, '.');
      ln = ln.replace(/(?<!\\)\\\[/g, '[').replace(/(?<!\\)\\\]/g, ']');
      return ln;
    }).join('\n');
  }

  return { md, imgCount };
}

// ---------- main ----------
export async function main({ dryRun = false } = {}) {
  const pages = JSON.parse(fs.readFileSync(path.join(TMP, 'pages.json'), 'utf8'));
  const okPages = pages.filter((p) => p.ok);
  fs.mkdirSync(OUT, { recursive: true });
  if (!dryRun) fs.mkdirSync(IMG_DIR, { recursive: true });

  // filename assignment
  const usedTitles = new Map();
  const results = [];
  for (const p of okPages) {
    const html = fs.readFileSync(path.join(TMP, p.file), 'utf8');
    const { md, imgCount } = convertPage(html, p.url);
    let title = sanitizeFileName(p.h1 || p.sbTitle).trim();
    let renamed = false;
    if (usedTitles.has(title)) {
      const slug = p.url.split('/').pop().replace(/\.html$/, '').replace(/^ai-agent-/, '');
      title = `${title}（${slug}）`;
      renamed = true;
    }
    usedTitles.set(title, p.url);
    const fileName = `${pad(p.i)}-${title}.md`;
    results.push({ ...p, title, fileName, md, imgCount, renamed });
  }

  // report duplicates resolved
  for (const r of results) {
    if (r.renamed) console.log(`DUP-RESOLVED: ${pad(r.i)} "${r.h1}" -> file "${r.fileName}"`);
  }

  // write inline svg assets
  if (!dryRun) {
    for (const [name, content] of inlineAssets) fs.writeFileSync(path.join(IMG_DIR, name), content, 'utf8');
  }

  // download images
  const urls = [...imageMap.keys()];
  let downloaded = 0, failedDl = [];
  if (!dryRun) {
    const queue = [...urls];
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const url = queue.shift();
        const name = imageMap.get(url);
        const dest = path.join(IMG_DIR, name);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { downloaded++; continue; }
        let ok = false;
        for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
          try {
            const resp = await fetch(url, { redirect: 'follow' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length === 0) throw new Error('empty');
            fs.writeFileSync(dest, buf);
            ok = true; downloaded++;
          } catch (e) {
            if (attempt === 3) failedDl.push({ url, error: String(e && e.message || e) });
            else await new Promise((r) => setTimeout(r, 800 * attempt));
          }
        }
      }
    });
    await Promise.all(workers);
  }

  // write md files
  if (!dryRun) {
    for (const r of results) fs.writeFileSync(path.join(OUT, r.fileName), r.md + '\n', 'utf8');
  }

  const missingRefs = [];
  for (const r of results) {
    const refs = [...r.md.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (!fs.existsSync(path.join(OUT, ref.replace(/\//g, path.sep)))) missingRefs.push(r.fileName + ' -> ' + ref);
    }
  }

  console.log('---- summary ----');
  console.log('pages converted :', okPages.length);
  console.log('md written      :', dryRun ? 0 : results.length);
  console.log('images unique   :', urls.length);
  console.log('images downloaded:', downloaded);
  console.log('inline svg files:', inlineAssets.size);
  if (failedDl.length) console.log('image failures  :\n' + failedDl.map((f) => '  ' + f.url + ' :: ' + f.error).join('\n'));
  if (missingRefs.length) console.log('missing md refs :\n' + missingRefs.join('\n'));
  if (warnings.length) console.log('warnings        :\n' + warnings.slice(0, 30).join('\n'));
  console.log('output dir      :', OUT);
}

if (process.argv[1] && process.argv[1].endsWith('build_b.mjs')) {
  const dry = process.argv.includes('--dry');
  main({ dryRun: dry }).catch((e) => { console.error(e); process.exit(1); });
}

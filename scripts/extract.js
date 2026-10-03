// ============================================================================
// extract.js — 浏览器端注入脚本：一次性取回页面元数据 + 正文 HTML
// ----------------------------------------------------------------------------
// 用法:  agent-browser --session <S> eval --stdin --json < extract.js > out.json
//        （或经 eval -b <base64> 传入，避免 shell 转义问题）
// 配置:  修改下方 CONTENT_SELECTOR 以匹配目标站点的正文容器
// 返回:  { url, ready, title, h1, contentLen, contentHTML, structure, tail, pres }
//   contentHTML 即正文 innerHTML，保存后交给 build_convert.mjs 转换。
//   校验 contentLen > 200 且 h1 非空 则可认为抓取成功。
// ============================================================================
(() => {
  // ======== 按目标站点调整正文容器选择器 ========
  const CONTENT_SELECTOR = '#content';
  const c = document.querySelector(CONTENT_SELECTOR);
  if (!c) return JSON.stringify({error: 'no #content', ready: document.readyState, url: location.href, title: document.title});
  const sum = el => `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''}> len=${(el.innerText || '').length} :: ${(el.innerText || '').slice(0, 40).replace(/\s+/g, ' ')}`;
  const kids = Array.from(c.children).map(sum);
  const pres = Array.from(c.querySelectorAll('pre')).slice(0, 6).map(p => p.outerHTML.slice(0, 250).replace(/\n/g, '\\n'));
  const h1el = c.querySelector('h1') || document.querySelector('h1');
  return JSON.stringify({
    url: location.href,
    ready: document.readyState,
    title: document.title,
    h1: h1el ? h1el.innerText.trim() : '',
    contentLen: c.innerHTML.length,
    contentHTML: c.innerHTML,
    structure: kids.slice(0, 12),
    tail: kids.slice(-8),
    pres
  });
})()

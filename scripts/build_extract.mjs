// ============================================================================
// build_extract.mjs — 阶段 A：用 agent-browser 逐章抓取网页正文 HTML
// ----------------------------------------------------------------------------
// 输入:  chapters 数组（章节标题 + 相对路径，按目标站点教程左侧栏顺序填写）
// 输出:  TMP/raw/NN.html（每章正文 innerHTML）+ TMP/pages.json（元数据）
//
// 使用前修改：
//   S      agent-browser 会话名（先执行 agent-browser session id 生成）
//   TMP    临时工作目录（存放 raw/、pages.json）
//   BASE   站点根地址
//   chapters 章节清单（顺序即文档编号）
// 使用前务必先拦截第三方广告/统计域名（否则部分站点会卡死浏览器守护进程），
// 见 references/browser-pitfalls.md；正文容器选择器在 extract.js 顶部配置。
// ============================================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const S = 'runoob-76c801a14543';
const TMP = 'C:/Users/Admin/.claude/jobs/69106415/tmp';
const RAW = path.join(TMP, 'raw');
fs.mkdirSync(RAW, { recursive: true });

const BASE = 'https://www.runoob.com';
const chapters = [
  ['AI Agent(智能体) 教程', '/ai-agent/ai-agent-tutorial.html'],
  ['AI Agent 简介', '/ai-agent/ai-agent-intro.html'],
  ['AI Agent 核心组件', '/ai-agent/ai-agent-core.html'],
  ['AI Agent 术语', '/ai-agent/ai-terminology.html'],
  ['AI Agent 工作原理', '/ai-agent/ai-agent-working-principle.html'],
  ['AI 底层架构', '/ai-agent/ai-architecture.html'],
  ['大语言模型基础', '/ai-agent/ai-agent-llm.html'],
  ['大模型多模态', '/ai-agent/llm-multimodal.html'],
  ['提示词工程', '/ai-agent/prompt-engineering.html'],
  ['Token (词元)', '/ai-agent/token-intro.html'],
  ['推理与规划', '/ai-agent/reasoning-planning.html'],
  ['向量数据库', '/ai-agent/vector-database.html'],
  ['RAG 与知识检索', '/ai-agent/retrieval-augmented-generation.html'],
  ['Agent 上下文工程', '/ai-agent/agent-context-engineering.html'],
  ['Agent 架构', '/ai-agent/agent-architecture.html'],
  ['第一个 AI Agent', '/ai-agent/first-ai-agent.html'],
  ['OpenClaw (Clawdbot) 教程', '/ai-agent/openclaw-clawdbot-tutorial.html'],
  ['OpenClaw 快速上手', '/ai-agent/openclaw-quickstart.html'],
  ['QoderWork 教程', '/ai-agent/qoderwork.html'],
  ['QoderWake 教程', '/ai-agent/qoderwake-usage.html'],
  ['WorkBuddy 入门教程', '/ai-agent/workbuddy-usage.html'],
  ['AI 工作流', '/ai-agent/ai-workflow.html'],
  ['CrewAI 构建智能体', '/ai-agent/crewai-agent.html'],
  ['LangChain 制作智能体', '/ai-agent/langchain-agent.html'],
  ['LangGraph 入门教程', '/ai-agent/langgraph-quick-start.html'],
  ['Deep Agents 入门教程', '/ai-agent/deep-agents-usage.html'],
  ['GraphRAG 入门教程', '/ai-agent/graphrag-usage.html'],
  ['Harness Engineering', '/ai-agent/harness-engineering.html'],
  ['Hermes Agent', '/ai-agent/hermes-agent.html'],
  ['Loop Engineering', '/ai-agent/loop-engineering.html'],
  ['Vibe Coding', '/ai-agent/vibe-coding-start.html'],
  ['Dify 入门教程', '/ai-agent/dify-usage.html'],
  ['n8n 入门教程', '/ai-agent/n8n-usage.html'],
  ['Pi Coding Agent', '/ai-agent/pi-coding-agent.html'],
  ['AI 3D (Blender)', '/ai-agent/ai-3d-blender.html'],
  ['Python 实现 AI Agent', '/ai-agent/python-ai-agent.html'],
  ['工具调用', '/ai-agent/ai-agent-function-calling.html'],
  ['记忆系统', '/ai-agent/ai-agent-memory-system-design.html'],
  ['Python 智能体环境配置', '/ai-agent/ai-agent-python-setup.html'],
  ['AI Agent 问答实例', '/ai-agent/ai-agent-answer-demo.html'],
  ['推理与规划', '/ai-agent/python-reasoning-planning.html'],
  ['RAG 与知识检索', '/ai-agent/python-rag.html'],
  ['多智能体系统', '/ai-agent/multi-agent-system.html'],
  ['工具与外部集成', '/ai-agent/tools-integration.html'],
  ['多模态 Agent', '/ai-agent/multimodal-agent.html'],
  ['评估、安全与对齐', '/ai-agent/evaluation-safety-alignment.html'],
  ['生产部署与工程化', '/ai-agent/production-deployment.html'],
  ['垂直应用场景', '/ai-agent/vertical-applications.html'],
  ['Hugging Face Transformers', '/ai-agent/hugging-face-transformers.html'],
];

const extractScript = fs.readFileSync(path.join(TMP, 'extract.js'), 'utf8');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function run(args, timeout) {
  const r = spawnSync('agent-browser', ['--session', S, ...args], {
    encoding: 'utf8',
    timeout,
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    ok: !r.error && r.status === 0,
    out: (r.stdout || '').trim(),
    err: r.error ? String(r.error && r.error.message) : (r.stderr || '').trim(),
  };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function getUrl() {
  const r = run(['get', 'url'], 30000);
  return r.ok ? (r.out.split(/\r?\n/).pop() || '').trim() : '';
}

function navScript(url) {
  return `location.href=${JSON.stringify(url)};'nav'`;
}

function navTo(url, tries = 40) {
  run(['eval', '-b', b64(navScript(url))], 30000);
  for (let i = 0; i < tries; i++) {
    const cur = getUrl();
    if (cur === url) return true;
    if (cur === '' || cur.startsWith('about:') || cur.startsWith('chrome-error') || cur.startsWith('data:')) {
      run(['eval', '-b', b64(navScript(url))], 30000);
    }
    sleep(1000);
  }
  return false;
}

function extract() {
  const r = run(['eval', '-b', b64(extractScript), '--json'], 90000);
  if (!r.ok) return { err: 'cli: ' + (r.err || 'exit=' + r.out.slice(0, 120)) };
  let outer;
  try { outer = JSON.parse(r.out); } catch (e) { return { err: 'outer-parse: ' + r.out.slice(0, 120) }; }
  if (!outer || !outer.success || !outer.data || typeof outer.data.result !== 'string') {
    return { err: 'envelope: ' + JSON.stringify(outer).slice(0, 200) };
  }
  let inner;
  try { inner = JSON.parse(outer.data.result); } catch (e) { return { err: 'inner-parse' }; }
  if (inner.error) return { err: 'page: ' + inner.error + ' ready=' + inner.ready };
  return { page: inner };
}

const pad = (n) => String(n).padStart(2, '0');
const pages = [];
const t0 = Date.now();

for (let idx = 0; idx < chapters.length; idx++) {
  const no = idx + 1;
  const [sbTitle, href] = chapters[idx];
  const url = BASE + href;
  let page = null, lastErr = '';

  for (let attempt = 1; attempt <= 3 && !page; attempt++) {
    const reached = navTo(url);
    if (!reached) { lastErr = 'nav-timeout(cur=' + getUrl().slice(0, 60) + ')'; continue; }
    for (let a = 0; a < 4; a++) {
      const res = extract();
      if (res.page && res.page.ready === 'complete' && res.page.contentLen > 200 && res.page.h1) {
        page = res.page;
        break;
      }
      if (res.page && res.page.ready === 'complete' && !res.page.h1) {
        lastErr = 'no-h1 len=' + res.page.contentLen;
        break;
      }
      lastErr = res.err || ('not-ready len=' + (res.page ? res.page.contentLen : '?'));
      sleep(2000);
    }
  }

  if (page) {
    const file = path.join(RAW, pad(no) + '.html');
    fs.writeFileSync(file, page.contentHTML, 'utf8');
    pages.push({
      i: no, url, sbTitle,
      docTitle: page.title,
      h1: page.h1,
      contentLen: page.contentLen,
      file: 'raw/' + pad(no) + '.html',
      ok: true,
    });
    console.log(`${pad(no)} OK  len=${page.contentLen}  h1="${page.h1}"  doc="${page.title}"`);
  } else {
    pages.push({ i: no, url, sbTitle, ok: false, error: lastErr });
    console.log(`${pad(no)} FAIL  ${url}  reason=${lastErr}`);
  }
}

fs.writeFileSync(path.join(TMP, 'pages.json'), JSON.stringify(pages, null, 2), 'utf8');
const okN = pages.filter((p) => p.ok).length;
console.log(`\nDONE: ${okN}/${pages.length} ok, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const failed = pages.filter((p) => !p.ok);
if (failed.length) console.log('FAILED: ' + failed.map((p) => p.i + ' ' + p.url).join('\n         '));

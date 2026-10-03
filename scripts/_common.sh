#!/bin/bash
# ============================================================================
# _common.sh — record_widget.sh / capture_widget_png.sh 的公共函数
# 会话名: 默认由 AGENT_BROWSER_SESSION 提供；未提供则自动生成一个稳定会话名。
# ============================================================================

md_tool_init_session() {
  S="${AGENT_BROWSER_SESSION:-$(agent-browser session id --scope worktree --prefix mdtool 2>/dev/null)}"
  export AGENT_BROWSER_SESSION="$S"
  echo "会话: $S"
}

# 拦截第三方广告/统计域名（不拦截会把部分站点的浏览器守护进程卡死）
md_tool_block_trackers() {
  local p
  for p in "**/*google-analytics*" "**/*googletagmanager*" "**/*googlesyndication*" \
           "**/*doubleclick*" "**/*adsbygoogle*" "**/*umeng*" "**/*cnzz*"; do
    agent-browser --session "$S" network route "$p" --abort >/dev/null 2>&1 || true
  done
}

# eval 导航到 URL 并轮询直到 URL 匹配（本机 open 命令不可靠，统一用 eval 导航）
md_tool_nav() {
  local url="$1" i u
  printf "location.href=%s;'nav'\n" "$(node -e "console.log(JSON.stringify(process.argv[1]))" "$url")" \
    | agent-browser --session "$S" eval --stdin >/dev/null 2>&1 || true
  for i in $(seq 1 40); do
    u=$(agent-browser --session "$S" get url 2>/dev/null || true)
    [ "$u" = "$url" ] && { echo "已到达: $url"; return 0; }
    sleep 1
  done
  echo "导航失败，当前 URL: $u" >&2
  return 1
}

# 取元素在视口内的矩形 [x y w h]（已按视口裁到非负）
md_tool_get_rect() {
  local sel="$1" sel_js box
  sel_js=$(node -e "console.log(JSON.stringify(process.argv[1]))" "$sel")
  box=$(printf "(() => { const el=document.querySelector(%s); if(!el) return 'null'; const r=el.getBoundingClientRect(); return JSON.stringify([Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]); })()\n" "$sel_js" \
    | agent-browser --session "$S" eval --stdin 2>/dev/null | tr -d '"')
  [ "$box" = "null" ] && { echo "找不到元素: $sel" >&2; return 1; }
  echo "$box"
}

# 取元素在整页坐标系下的矩形（全页截图裁剪用）
md_tool_get_page_rect() {
  local sel="$1" sel_js box
  sel_js=$(node -e "console.log(JSON.stringify(process.argv[1]))" "$sel")
  box=$(printf "(() => { const el=document.querySelector(%s); if(!el) return 'null'; const r=el.getBoundingClientRect(); return JSON.stringify([Math.round(r.x+scrollX),Math.round(r.y+scrollY),Math.round(r.width),Math.round(r.height)]); })()\n" "$sel_js" \
    | agent-browser --session "$S" eval --stdin 2>/dev/null | tr -d '"')
  [ "$box" = "null" ] && { echo "找不到元素: $sel" >&2; return 1; }
  echo "$box"
}

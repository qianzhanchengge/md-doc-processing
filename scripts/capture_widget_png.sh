#!/bin/bash
# ============================================================================
# capture_widget_png.sh — 把「静态展示型」组件截图为 PNG
#                        （入场动画一次性播完即静止的组件用截图而非 GIF）
# ----------------------------------------------------------------------------
# 用法:
#   bash capture_widget_png.sh <页面URL> <组件CSS选择器> <输出PNG路径>
#
# 例:
#   bash capture_widget_png.sh "https://www.runoob.com/ai-agent/token-intro.html" \
#        ".token-display" token-demo.png
#
# 说明:
#   - 组件完整位于视口内 -> 视口截图后按视口坐标裁剪（文字最清晰）；
#   - 组件高于视口   -> 自动改用 --full 全页截图 + 整页坐标裁剪。
# ============================================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

URL="$1"; SEL="$2"; OUT_PNG="$3"
: "${URL:?usage: capture_widget_png.sh <url> <selector> <out.png>}"
: "${SEL:?缺少组件选择器}"; : "${OUT_PNG:?缺少输出路径}"

md_tool_init_session
TMP_DIR="$(dirname "$OUT_PNG")"; mkdir -p "$TMP_DIR"
SHOT="$TMP_DIR/_shot_tmp.png"

echo "[1/4] 拦截第三方广告/统计域名"
md_tool_block_trackers

echo "[2/4] 导航到页面"
md_tool_nav "$URL"

echo "[3/4] 滚动到组件并测量"
agent-browser --session "$S" scrollintoview "$SEL" >/dev/null
sleep 1
BOX=$(md_tool_get_rect "$SEL")
VH=$(printf "innerHeight\n" | agent-browser --session "$S" eval --stdin 2>/dev/null | tr -d '"')
read -r X Y W H < <(node -e "const [x,y,w,h]=JSON.parse(process.argv[1]); console.log(Math.max(0,x),Math.max(0,y),w,h)" "$BOX")

if [ $((Y + H)) -le "$VH" ]; then
  echo "  组件完整可见（${W}x${H}），使用视口截图"
  agent-browser --session "$S" screenshot "$SHOT" >/dev/null
  CROP="${W}:${H}:${X}:${Y}"
else
  echo "  组件高于视口，使用全页截图"
  agent-browser --session "$S" screenshot --full "$SHOT" >/dev/null
  BOX2=$(md_tool_get_page_rect "$SEL")
  read -r PX PY PW PH < <(node -e "const [x,y,w,h]=JSON.parse(process.argv[1]); console.log(x,y,w,h)" "$BOX2")
  CROP="${PW}:${PH}:${PX}:${PY}"
fi

echo "[4/4] 裁剪输出"
ffmpeg -v error -i "$SHOT" -vf "crop=${CROP}" "$OUT_PNG" -y
echo "完成: $OUT_PNG（$(du -h "$OUT_PNG" | cut -f1)）裁剪参数: ${CROP}"

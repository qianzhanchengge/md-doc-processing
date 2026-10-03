#!/bin/bash
# ============================================================================
# record_widget.sh — 把网页上的交互动画组件录制为 GIF（动图处理流程，详见
#                    references/special-formats.md 第 5 节）
# ----------------------------------------------------------------------------
# 用法:
#   bash record_widget.sh <页面URL> <组件CSS选择器> <输出GIF路径> \
#        [录制秒数=11] [重播按钮选择器(可选)] [起点裁剪秒=0.5]
# 例:
#   bash record_widget.sh "https://www.runoob.com/ai-agent/ai-agent-llm.html" \
#        "#llm-think-demo" demo.gif 11 ".llm-think__btn" 1.0
#
# 前置条件:
#   - agent-browser（doctor 能检测到 ffmpeg）与 ffmpeg 在 PATH；
#   - 录制期间不滚动页面、浏览器 devicePixelRatio=1（默认无头模式满足），
#     否则 getBoundingClientRect 的坐标与视频像素不对应。
#
# 流程: 拦截追踪域名 -> eval 导航并轮询 -> 滚动到组件 -> 测量位置
#       -> record start ->（点击重播按钮）-> 等待 -> record stop
#       -> ffmpeg 裁剪 + 调色板转 GIF -> 打印抽帧检查命令
#
# 提示: 转完后务必抽帧检查内容与裁剪是否准确；若时长/循环不理想，调整录制秒数
#       与起点裁剪秒数重跑即可。GIF 体积目标建议 < 2MB（可用 max_colors 调节）。
# ============================================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

URL="$1"; SEL="$2"; OUT_GIF="$3"; DUR="${4:-11}"; RESTART_SEL="$5"; SS="${6:-0.5}"
: "${URL:?usage: record_widget.sh <url> <selector> <out.gif> [seconds] [restart_selector] [skip_seconds]}"
: "${SEL:?缺少组件选择器}"; : "${OUT_GIF:?缺少输出路径}"

md_tool_init_session
TMP_DIR="$(dirname "$OUT_GIF")"; mkdir -p "$TMP_DIR"
WEBM="$TMP_DIR/_rec_tmp.webm"

echo "[1/6] 拦截第三方广告/统计域名"
md_tool_block_trackers

echo "[2/6] 导航到页面"
md_tool_nav "$URL"

echo "[3/6] 滚动到组件并测量位置"
agent-browser --session "$S" scrollintoview "$SEL" >/dev/null
sleep 1
BOX=$(md_tool_get_rect "$SEL")
read -r X Y W H < <(node -e "const [x,y,w,h]=JSON.parse(process.argv[1]); console.log(Math.max(0,x),Math.max(0,y),w,h)" "$BOX")
echo "  视口内位置: x=$X y=$Y w=$W h=$H"

echo "[4/6] 录制 ${DUR}s"
agent-browser --session "$S" record start "$WEBM" >/dev/null
sleep 1
if [ -n "$RESTART_SEL" ]; then
  agent-browser --session "$S" click "$RESTART_SEL" >/dev/null 2>&1 || true
fi
sleep "$DUR"
agent-browser --session "$S" record stop >/dev/null

echo "[5/6] 转 GIF（裁剪 ${W}x${H}+${X}+${Y}）"
ffmpeg -v error -ss "$SS" -i "$WEBM" -t "$DUR" \
  -vf "crop=${W}:${H}:${X}:${Y},fps=12,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle" \
  -loop 0 "$OUT_GIF" -y

echo "[6/6] 完成: $OUT_GIF（$(du -h "$OUT_GIF" | cut -f1)）"
echo ""
echo "抽帧检查（务必执行）:"
echo "  ffmpeg -v error -ss 3 -i \"$WEBM\" -frames:v 1 -vf \"crop=${W}:${H}:${X}:${Y}\" frame.png -y"
echo "  ffmpeg -i \"$OUT_GIF\" -vf \"select=eq(n\\,60)\" -frames:v 1 mid.png -y   # GIF 中间帧"

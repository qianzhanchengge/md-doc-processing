# agent-browser 踩坑与对策（必读）

本文件汇总在文档提取实战中踩过的浏览器自动化问题。**开工前通读一遍可避免 80% 的卡壳。**

---

## 1. 守护进程被页面卡死（最常见）★

**症状**：导航到某些页面后，`get url` 等命令挂起（超时分钟级）、报
`Invalid response: EOF while parsing a value`、标签页被重置为 `about:blank`。

**原因**：页面上的第三方广告/统计脚本（国内网络下请求悬挂）拖住渲染与 CDP 响应。

**对策**：**开工第一步就拦截这些域名**（对整段会话持续生效）：

```bash
for p in "**/*google-analytics*" "**/*googletagmanager*" "**/*googlesyndication*" \
         "**/*doubleclick*" "**/*adsbygoogle*" "**/*adtrafficquality*" "**/*umeng*" \
         "**/*baidu.com/hm*" "**/*cnzz*"; do
  agent-browser --session "$S" network route "$p" --abort
done
```

拦截后同一页面从"卡 2 分钟"变为"秒开"。注意：**会话/浏览器重启后要重新添加**（属于会话状态）。

## 2. `open` 命令不可靠

**症状**：`agent-browser open <url>` 报 EOF 错误或长时间挂起，但页面实际可能已经打开。

**对策**：统一改用 **eval 导航 + 轮询**：

```bash
printf "location.href='<url>';'nav'\n" | agent-browser --session "$S" eval --stdin
for i in $(seq 1 40); do
  [ "$(agent-browser --session "$S" get url 2>/dev/null)" = "<url>" ] && break
  sleep 1
done
```

导航后等 `document.readyState === 'complete'` 再抽取（本技能抓取脚本内置）。

## 3. 首次启动慢 / 首次命令超时

Chrome 首次启动 + 首个页面加载可能耗时分钟级（尤其 Windows 无头私有桌面）。
先 `agent-browser doctor` 看守护进程状态；报错后**重试一次**常常就好了；之后命令就快了。

## 4. 会话管理

- 永远用**命名会话**：`export AGENT_BROWSER_SESSION=$(agent-browser session id --scope worktree --prefix <名>)`；
  默认会话是全机共享的，可能劫持别的任务。
- 一个任务完成后 `agent-browser --session "$S" close` 释放资源。
- `file://` 页面：从 http 页 `location.href` 跳 file:// 会被安全策略拦截，**用新标签页**：
  `agent-browser --session "$S" tab new "file:///C:/path/x.svg"`（渲染验证 SVG 时常用）。

## 5. Shell 转义陷阱（Windows Git Bash 尤其多）

- **反引号**在双引号/heredoc 里是命令替换——分析含 ` ``` ` 的文件用 Python/Node 脚本文件，
  不要拼 shell 命令。
- 反斜杠 `\\` 在多层引号间会被反复吃掉：**把复杂逻辑写成脚本文件**（本技能全部如此），
  命令行只传简单参数。
- 给 `eval` 传多行 JS：用 `--stdin` + heredoc（`<<'EOF'` 引号版）或
  `eval -b <base64>`（base64 最稳，完全绕开转义）。
- `$!`、`$S` 等想传给远端/子进程时注意本地展开——必要时 `\$` 或单引号。

## 6. 后台任务与长命令

- 长任务（镜像拉取/大页下载）用 `nohup … > log 2>&1 &` 后**轮询日志**，不要前台硬等。
- 已知竞态：启动后台任务后**立即**结束会话，偶尔任务未真正建立——轮询发现无进程时重试一次即可。
- 会话内命令尽量小输出（`head -c 400` / `tail`），大对象（正文 HTML）直接落盘、不要经过 stdout。

## 7. 抽取与判据

- **不要**用 `open`/`snapshot` 读正文做转换输入——用 `eval` 直接取正文容器 `innerHTML` 落盘，
  再本地转换（可重复、可 diff）。
- 抓取成功的判据：`ready==='complete'` 且 `contentLen > 200` 且 `h1` 非空；否则重试导航。
- 页面上的怪东西（固定白框、闪烁小方块等）先做"是否页面自身渲染"的判定（实时截图 + 像素比对 +
  elementsFromPoint），再决定是否需要处理——**多半是页面自身特性，应忠实保留**。

## 8. 录制（record start/stop）

- 依赖 ffmpeg 在 PATH（`agent-browser doctor` 会检查）。
- 录制的是**视口**；裁剪坐标 = 元素的 `getBoundingClientRect()`（视口坐标，DPR=1）。
  录制期间不要滚动。
- `record start` 可先于一切动作，之后 `sleep 足够时长` 再 `record stop`；停后文件即写盘完成。

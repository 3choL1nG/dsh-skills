#!/bin/bash
# DSH 知识库同步助手（macOS）
# 第一次用之前，在终端里跑一次：chmod +x ~/DSH-Skills/_sync-tool/知识库助手.command
cd "$(dirname "$0")" || exit 1

NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  for p in "$HOME"/.dsh/dsh-runtimes/*/dependencies/node/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$p" ]; then NODE="$p"; break; fi
  done
fi

if [ -z "$NODE" ]; then
  echo
  echo "  [错误] 没找到 Node.js。"
  echo "  先装一个：到 https://nodejs.org 下载 LTS 版，或者在终端里运行：brew install node"
  echo
  read -n 1 -s -r -p "按任意键关闭…"
  echo
  exit 1
fi

"$NODE" "skills-sync.mjs" --unit kb "$@"
echo
read -n 1 -s -r -p "按任意键关闭…"
echo

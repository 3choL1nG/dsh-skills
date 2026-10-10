#!/bin/bash
# DSH 技能同步助手（macOS / Linux 双击运行）
# 第一次从 GitHub 克隆下来后，可能需要先执行一次：
#   chmod +x 同步助手.command
cd "$(dirname "$0")" || exit 1

NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
  for p in "$HOME"/.dsh/dsh-runtimes/*/dependencies/node/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$p" ]; then NODE="$p"; break; fi
  done
fi

if [ -z "$NODE" ]; then
  echo
  echo "  没有找到 Node.js。装一个再回来："
  echo "    brew install node"
  echo
  read -n 1 -r -p "按任意键关闭…"
  exit 1
fi

"$NODE" "$(dirname "$0")/skills-sync.mjs"

echo
read -n 1 -r -p "按任意键关闭…"

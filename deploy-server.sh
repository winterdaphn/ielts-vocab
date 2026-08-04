#!/bin/bash
# 智能部署：只 build 改动的部分
# 用法：
#   deploy                  # 智能检测（推荐）
#   deploy all              # 强制全量
#   deploy web              # 只 build 前端
#   deploy api              # 只 build 后端
set -e
cd "$(dirname "$0")"

MODE="${1:-auto}"

# 用 reflog 拿 pull 前的 HEAD（即使外部先 pull 过也能识别改动）
OLD_HEAD=$(git rev-parse HEAD@{1} 2>/dev/null || echo "")
echo "[1/4] git pull..."
git pull --ff-only
NEW_HEAD=$(git rev-parse HEAD)

CHANGED=""
if [ -n "$OLD_HEAD" ] && [ "$OLD_HEAD" != "$NEW_HEAD" ]; then
    CHANGED=$(git diff --name-only "$OLD_HEAD".."$NEW_HEAD" 2>/dev/null || true)
fi

if [ -n "$CHANGED" ]; then
    echo "本次更新："
    echo "$CHANGED" | sed 's/^/  /'
else
    echo "未检测到代码改动（可能 reflog 已被清理或本地有未 push 提交）"
fi

changed_web()  { echo "$CHANGED" | grep -q "^apps/web/"; }
changed_api()  { echo "$CHANGED" | grep -q "^apps/api/"; }
changed_infra(){ echo "$CHANGED" | grep -q -E "^(docker-compose\.yml|nginx/|deploy-server\.sh|apps/web/Dockerfile)"; }

build_web()    { docker compose build web;  docker compose up -d --no-deps web;  }
build_api()    { docker compose build api;  docker compose up -d --no-deps api;  }
reload_nginx() { docker compose restart nginx; }
full_up()      { docker compose build web api; docker compose up -d; }

case "$MODE" in
    all)
        echo "[2/4] 强制全量 build..."
        full_up
        reload_nginx
        ;;
    web)
        echo "[2/4] build 前端..."
        build_web
        reload_nginx
        ;;
    api)
        echo "[2/4] build 后端..."
        build_api
        reload_nginx
        ;;
    auto|*)
        if changed_infra; then
            echo "[2/4] 基础设施改动，全量 rebuild..."
            full_up
            reload_nginx
        elif changed_web && changed_api; then
            echo "[2/4] 前端 + 后端都改了..."
            build_web
            build_api
            reload_nginx
        elif changed_web; then
            echo "[2/4] 只改前端..."
            build_web
            reload_nginx
        elif changed_api; then
            echo "[2/4] 只改后端..."
            build_api
            reload_nginx
        else
            echo "[2/4] 未检测到代码改动，重启服务..."
            docker compose restart
        fi
        ;;
esac

echo "[3/4] 当前状态："
docker compose ps

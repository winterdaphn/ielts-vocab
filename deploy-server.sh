#!/bin/bash
# 服务器端部署脚本：拉代码 + 构建前后端 + 重启服务
# 用法：bash /opt/ielts/deploy-server.sh
set -e
cd "$(dirname "$0")"

echo "[1/5] git pull..."
git pull --ff-only

echo "[2/5] build api image..."
docker compose build api

echo "[3/5] install web deps (if needed) + build frontend..."
cd apps/web
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
    npm install --no-audit --no-fund
fi
npm run build
cd ../..

echo "[4/5] bring services up..."
docker compose up -d

echo "[5/5] reload nginx to pick up new dist..."
docker compose restart nginx

docker compose ps

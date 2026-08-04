#!/bin/bash
# 服务器端部署脚本：拉代码 + 重建 api 容器 + 重载 nginx
# 用法：bash /opt/ielts/deploy-server.sh
set -e
cd "$(dirname "$0")"

echo "[1/3] git pull..."
git pull --ff-only

echo "[2/3] rebuild api..."
docker compose up -d --build api

echo "[3/3] reload nginx..."
docker compose restart nginx

docker compose ps

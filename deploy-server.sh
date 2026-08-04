#!/bin/bash
# 服务器端部署脚本：拉代码 + 构建前后端镜像 + 重启服务
# 用法：bash /opt/ielts/deploy-server.sh
set -e
cd "$(dirname "$0")"

echo "[1/4] git pull..."
git pull --ff-only

echo "[2/4] rebuild web + api images..."
docker compose build web api

echo "[3/4] bring services up..."
docker compose up -d

echo "[4/4] reload nginx..."
docker compose restart nginx

docker compose ps

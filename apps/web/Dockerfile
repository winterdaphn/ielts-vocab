FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Build 完把 dist 拷到挂载点，容器随即退出
CMD ["sh", "-c", "cp -r /app/dist/* /out/ && echo web-build-done"]

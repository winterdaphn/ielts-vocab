FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/api/ || exit 1

CMD ["node", "server.js"]

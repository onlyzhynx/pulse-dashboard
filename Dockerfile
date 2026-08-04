FROM node:20-alpine

RUN apk add --no-cache python3 make g++ curl

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --production

RUN mkdir -p /app/data

EXPOSE 8787
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s \
  CMD curl -f http://localhost:8787/api/health || exit 1

CMD ["node", "server/index.js"]

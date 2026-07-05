# ToolProof — feed + API + remote MCP endpoint.
# Serves both backends: set DATABASE_URL (Neon/Railway Postgres) for hosted
# deployments, or leave it unset to use the SQLite file under /data.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    TOOLPROOF_DB=/data/toolproof.db \
    PORT=4117
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY probes ./probes
COPY package.json ./
VOLUME /data
EXPOSE 4117
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/bin/web.js"]

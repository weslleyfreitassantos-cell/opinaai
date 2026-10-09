FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "server/index.js"]

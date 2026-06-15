FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=appuser:appgroup . .
USER appuser

EXPOSE 3000

# wget Alpine'da mevcut; curl ile aynı iş görür ve ek paket gerektirmez.
# /health → tam public endpoint, auth yok, yalnızca {ok:true,ts:...} döner.
# interval: 30s kontrol, timeout: 5s, başlangıç gecikmesi: 15s, 3 başarısızlıkta unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health > /dev/null || exit 1

CMD ["node", "index.js"]

# --- Build Stage ---
FROM node:20-alpine AS builder
WORKDIR /app

# Frontend (Vite) values are baked in at image build time.
# Pass via docker build --build-arg or GitHub Actions build-args.
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_API_BASE_URL=/api
ARG VITE_BRAND_LOGO_URL=
ARG VITE_ADMIN_ORDER_ALERT_SOUND_URL=/admin-order-alert.mp3
ARG BUILD_SHA=
ARG BUILD_TIME=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_BRAND_LOGO_URL=$VITE_BRAND_LOGO_URL \
    VITE_ADMIN_ORDER_ALERT_SOUND_URL=$VITE_ADMIN_ORDER_ALERT_SOUND_URL \
    BUILD_SHA=$BUILD_SHA \
    BUILD_TIME=$BUILD_TIME

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build \
  && test -f dist/index.html \
  && ls dist/assets/*.js >/dev/null 2>&1 \
  && echo "dist build OK"

# --- Production Stage ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Explicit path used by server/createApp.js getDistPath()
ENV STATIC_DIST_PATH=/app/dist
ARG BUILD_SHA=
ARG BUILD_TIME=
ENV BUILD_SHA=$BUILD_SHA \
    BUILD_TIME=$BUILD_TIME
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
# Fail image if SPA bundle missing (blank page root cause)
RUN test -f /app/dist/index.html \
  && test -d /app/dist/assets \
  && ls /app/dist/assets/*.js >/dev/null \
  && ls /app/dist/assets/*.css >/dev/null \
  && echo "Runner dist OK:" \
  && ls -la /app/dist/assets | head -20
EXPOSE 3001

# Migrations then API (serves SPA from dist). If migrations fail, container exits.
CMD ["sh", "-c", "node server/runMigrations.js && node server/index.js"]

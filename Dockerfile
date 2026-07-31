# --- Build Stage ---
FROM node:20-alpine AS builder
WORKDIR /app

# Frontend (Vite) values are baked in at image build time.
# Pass via docker build --build-arg or GitHub Actions build-args.
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_API_BASE_URL=/api
ARG VITE_BRAND_LOGO_URL=
ARG VITE_ADMIN_ORDER_ALERT_SOUND_URL=/admin-order-alert.mp3
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_BRAND_LOGO_URL=$VITE_BRAND_LOGO_URL \
    VITE_ADMIN_ORDER_ALERT_SOUND_URL=$VITE_ADMIN_ORDER_ALERT_SOUND_URL

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Production Stage ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
EXPOSE 3001

# Migrations then API (serves SPA from dist)
CMD ["sh", "-c", "node server/runMigrations.js && node server/index.js"]

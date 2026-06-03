# syntax=docker/dockerfile:1

# ---------- Stage 1: install production dependencies ----------
# A dedicated stage keeps build tooling out of the final image and
# maximizes layer caching: deps only re-install when package files change.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` is reproducible (uses the lockfile) and CI-friendly.
# --omit=dev skips devDependencies (jest, eslint) for a smaller image.
RUN npm ci --omit=dev

# ---------- Stage 2: final runtime image ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Run as the built-in non-root `node` user, not root.
USER node

# Copy installed deps from the previous stage, then the source.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 3000

# Container-level healthcheck (Docker/Compose use this; Railway has its own).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]

# ---- Build stage ----
FROM node:20-slim AS build
WORKDIR /app

# Install all deps (incl. dev) for the build.
COPY package.json package-lock.json* ./
RUN npm install

# Build server (tsc) + client (esbuild).
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY migrations ./migrations
ENV NODE_ENV=production
RUN npm run build

# Prune dev dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as the built-in non-root "node" user.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

# Railway injects $PORT; default to 3000 for local runs.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server/index.js"]

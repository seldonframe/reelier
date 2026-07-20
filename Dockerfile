# syntax=docker/dockerfile:1

# --- build stage: compile TypeScript -> dist/ ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# --- runtime stage: prod deps + compiled dist only (small image) ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY SPEC.md README.md LICENSE CHANGELOG.md ./
COPY integrations ./integrations

# `reelier` is the entrypoint: `docker run <image> <subcommand> [args]`.
# Absolute path so callers can override the working dir with -w for their skills.
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]

FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/schemas ./schemas
COPY --from=builder --chown=node:node /app/examples ./examples
COPY --from=builder --chown=node:node /app/LICENSE ./LICENSE
COPY --from=builder --chown=node:node /app/README.md ./README.md
COPY --from=builder --chown=node:node /app/README-zh.md ./README-zh.md
COPY --from=builder --chown=node:node /app/DISCLAIMER.md ./DISCLAIMER.md
COPY --from=builder --chown=node:node /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --from=builder --chown=node:node /app/RELEASE_NOTES.md ./RELEASE_NOTES.md

RUN chown -R node:node /app
USER node

ENTRYPOINT ["node", "/app/dist/cli/index.js"]

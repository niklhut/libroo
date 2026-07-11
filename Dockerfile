ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG CREATED=unknown
ARG SOURCE=https://github.com/niklhut/libroo

FROM node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a AS base
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm build:selfhost
RUN pnpm prune --prod --ignore-scripts

FROM base AS runtime
ARG VERSION
ARG REVISION
ARG CREATED
ARG SOURCE
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NUXT_LIBROO_RUNTIME_PROFILE=selfhost
ENV NUXT_DATABASE_URL=file:/data/db/sqlite.db
ENV NUXT_LOCAL_STORAGE_DIR=/data/blob
LABEL org.opencontainers.image.title="Libroo" \
      org.opencontainers.image.description="Self-hosted Libroo library management app" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server/db/migrations ./server/db/migrations
RUN for package in /app/node_modules/@libsql/linux-*-musl; do \
      if [ -e "$package" ]; then \
        name="$(basename "$package")"; \
        rm -rf "/app/.output/server/node_modules/@libsql/$name"; \
        mkdir -p /app/.output/server/node_modules/@libsql; \
        cp -RL "$package" "/app/.output/server/node_modules/@libsql/$name"; \
      fi; \
    done \
    && mkdir -p /data/db /data/blob \
    && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate-selfhost.mjs && exec node .output/server/index.mjs"]

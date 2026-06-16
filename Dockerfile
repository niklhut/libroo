FROM node:24.16.0-alpine AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install --global pnpm@11.1.1

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
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
ENV NUXT_LIBROO_RUNTIME_PROFILE=selfhost
ENV NUXT_DATABASE_URL=file:/data/db/sqlite.db
ENV NUXT_LOCAL_STORAGE_DIR=/data/blob
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data/db /data/blob && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

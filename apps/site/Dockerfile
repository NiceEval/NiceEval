FROM node:24-trixie-slim AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN corepack enable && pnpm --filter @niceeval/site... install --frozen-lockfile --ignore-scripts
RUN pnpm run build:package

ARG GIT_SHA
RUN NICEEVAL_SITE_SELF_HOSTED=1 SENTRY_RELEASE="${GIT_SHA:+site@}${GIT_SHA}" \
    pnpm --filter @niceeval/site run build

FROM node:24-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000

COPY --from=build --chown=node:node /workspace/apps/site/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/site/.next/static ./apps/site/.next/static
COPY --from=build --chown=node:node /workspace/apps/site/.next/server/sentry-profile-assets.json ./apps/site/.next/server/
COPY --from=build --chown=node:node /workspace/apps/site/public ./apps/site/public

USER node
RUN cd apps/site && node --input-type=module -e 'const { nodeProfilingIntegration } = await import("@sentry/profiling-node"); nodeProfilingIntegration();'
EXPOSE 3000
CMD ["node", "apps/site/server.js"]

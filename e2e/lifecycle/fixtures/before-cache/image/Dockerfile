FROM node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f

ARG SETUP_BASE_VERSION=default

RUN apt-get update -qq \
  && apt-get install -y -qq ca-certificates git curl >/dev/null \
  && rm -rf /var/lib/apt/lists/*

COPY build-seed.txt /opt/niceeval-e2e/build-seed.txt
RUN mkdir -p /opt/niceeval-e2e \
  && printf '%s\n' "$SETUP_BASE_VERSION" > /opt/niceeval-e2e/base-version \
  && node -e 'process.stdout.write(require("node:crypto").randomUUID())' \
    > /opt/niceeval-e2e/build-token \
  && chown -R node:node /opt/niceeval-e2e

USER node

FROM node@sha256:bde0dae02f2b12d2bce5ee72b2432f0e511767b7b2dc4dd3b064df11ae422fee

COPY --chown=node:node fixtures/bin/codex /usr/local/bin/codex
RUN chmod 0755 /usr/local/bin/codex \
  && mkdir -p /home/node/.codex /tmp/niceeval \
  && chown -R node:node /home/node /tmp/niceeval

ENV HOME=/home/node \
    CODEX_HOME=/home/node/.codex \
    TMPDIR=/tmp/niceeval
USER node

FROM node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f

RUN mkdir -p /home/node/.codex /tmp/niceeval \
  && chown -R node:node /home/node /tmp/niceeval
ENV HOME=/home/node \
    CODEX_HOME=/home/node/.codex \
    TMPDIR=/tmp/niceeval
USER node

FROM node@sha256:438603bbb5cda404b9416f0b5c8026f61501ab911760d861ec28c36b5d675725

RUN mkdir -p /home/node/.codex /tmp/niceeval \
  && chown -R node:node /home/node /tmp/niceeval
ENV HOME=/home/node \
    CODEX_HOME=/home/node/.codex \
    TMPDIR=/tmp/niceeval
USER node

FROM node@sha256:e961046fec20896e8904f2b4a8b4c7e5ca91826d84d8d33d83dbaa61f942069e

RUN mkdir -p /home/node/.codex /tmp/niceeval \
  && chown -R node:node /home/node /tmp/niceeval
ENV HOME=/home/node \
    CODEX_HOME=/home/node/.codex \
    TMPDIR=/tmp/niceeval
USER node

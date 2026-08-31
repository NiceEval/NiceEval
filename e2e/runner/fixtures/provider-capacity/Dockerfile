FROM node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS node-runtime

FROM docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c

COPY --from=node-runtime /usr/local/ /usr/local/
COPY --from=node-runtime /bin/bash /bin/bash
COPY --from=node-runtime /lib/x86_64-linux-gnu/ /lib/x86_64-linux-gnu/
COPY --from=node-runtime /usr/lib64/ /usr/lib64/
COPY --from=node-runtime /usr/bin/ldd /usr/bin/ldd

RUN ln -s usr/lib64 /lib64 \
  && addgroup -g 1000 node \
  && adduser -D -u 1000 -G node node \
  && node --version \
  && npm --version \
  && git --version \
  && docker --version \
  && dockerd --version

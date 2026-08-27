FROM scratch AS node-runtime

ADD node-rootfs.tar /

FROM scratch

ADD docker-rootfs.tar /

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /bin/bash /bin/bash
COPY --from=node-runtime /lib/x86_64-linux-gnu/ /lib/x86_64-linux-gnu/
COPY --from=node-runtime /usr/lib64/ /usr/lib64/
COPY --from=node-runtime /usr/bin/ldd /usr/bin/ldd

RUN ln -s usr/lib64 /lib64 \
  && addgroup -g 1000 node \
  && adduser -D -u 1000 -G node node \
  && addgroup node docker \
  && node --version \
  && bash --version \
  && ldd --version \
  && docker --version \
  && dockerd --version

ENTRYPOINT ["dockerd-entrypoint.sh"]

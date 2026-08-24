FROM scratch AS node-runtime

ADD node-rootfs.tar /

FROM scratch

# Reconstituting the rootfs intentionally drops the upstream image's declared
# /var/lib/docker VOLUME so raw DinD state remains in this outer writable layer.
ADD docker-rootfs.tar /

COPY --from=node-runtime /usr/local/ /usr/local/
COPY --from=node-runtime /bin/bash /bin/bash
COPY --from=node-runtime /lib/x86_64-linux-gnu/ /lib/x86_64-linux-gnu/
COPY --from=node-runtime /usr/lib64/ /usr/lib64/
COPY --from=node-runtime /usr/bin/ldd /usr/bin/ldd

RUN ln -s usr/lib64 /lib64 \
  && addgroup -g 1000 node \
  && adduser -D -u 1000 -G node node \
  && addgroup node docker \
  && mkdir -p /opt/niceeval-e2e \
  && printf '%s\n' "raw-dind" > /opt/niceeval-e2e/base-version \
  && node -e 'process.stdout.write(require("node:crypto").randomUUID())' \
    > /opt/niceeval-e2e/build-token \
  && chown -R node:node /opt/niceeval-e2e \
  && node --version \
  && npm --version \
  && git --version \
  && docker --version \
  && dockerd --version

USER node

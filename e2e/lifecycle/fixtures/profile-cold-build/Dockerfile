FROM docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c AS docker-runtime

FROM node:24-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f

COPY --from=docker-runtime /usr/local/bin/ /usr/local/bin/

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git iptables \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system docker \
  && usermod --append --groups docker node

ENTRYPOINT ["dockerd-entrypoint.sh"]

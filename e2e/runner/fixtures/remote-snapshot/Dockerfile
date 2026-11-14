FROM node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f
RUN apt-get update && apt-get install -y --no-install-recommends git sudo && rm -rf /var/lib/apt/lists/*
RUN echo 'node ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/node && mkdir -p /data/home/workspace && chown -R node:node /data/home

FROM niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5
USER root
ARG NATIVE=false
ARG PATCH_READY=false
RUN npm install -g @openai/codex@0.167.2 \
 && rm -f /home/node/.local/bin/codex /home/node/.local/bin/apply_patch /usr/local/bin/apply_patch /usr/bin/apply_patch \
 && codex --version \
 && native=$(find /usr/local/lib/node_modules/@openai -type f -path '*/vendor/*/bin/codex' -print -quit) \
 && test -n "$native" \
 && if [ "$NATIVE" = true ]; then ln -sf "$native" /usr/local/bin/codex; fi \
 && if [ "$PATCH_READY" = true ]; then ln -sf "$native" /usr/local/bin/apply_patch; fi
USER node

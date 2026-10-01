FROM debian:trixie-slim AS rhwp-fetch

ARG RHWP_VERSION=0.8.6
ARG RHWP_SHA256=458de22a6b9b86088dfdcd59552d4e8fab5362a64578c64761fa28df9be45e9a

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL --retry 3 \
    -o /tmp/rhwp.tar.gz \
    "https://github.com/edwardkim/rhwp/releases/download/v${RHWP_VERSION}/rhwp-v${RHWP_VERSION}-linux-x86_64.tar.gz" \
  && echo "${RHWP_SHA256}  /tmp/rhwp.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/rhwp.tar.gz -C /tmp \
  && test "$(/tmp/rhwp/rhwp --version)" = "rhwp v${RHWP_VERSION}"

FROM node:22-trixie-slim

ARG TARGETARCH=amd64

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-noto-cjk \
    libseccomp2 \
    libreoffice-calc \
    libreoffice-impress \
    libreoffice-writer \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY --from=rhwp-fetch /tmp/rhwp/rhwp /usr/local/bin/rhwp
COPY --from=rhwp-fetch /tmp/rhwp/LICENSE /usr/share/doc/rhwp/LICENSE

RUN chmod 0555 src/preflight_ooxml.py src/sandbox_exec.py \
  && chmod 0555 /usr/local/bin/rhwp \
  && test "${TARGETARCH}" = "amd64" \
  && mkdir -p /tmp/weave-preview \
  && chown node:node /tmp/weave-preview \
  && chmod -R a-w /app

ENV DOCUMENT_PREVIEW_PYTHON=/usr/bin/python3 \
    DOCUMENT_PREVIEW_LIBREOFFICE=/usr/bin/libreoffice \
    DOCUMENT_PREVIEW_RHWP=/usr/local/bin/rhwp \
    DOCUMENT_PREVIEW_TMP=/tmp/weave-preview

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]

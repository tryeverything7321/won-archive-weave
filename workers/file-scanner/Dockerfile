FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends clamav ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY entrypoint.sh ./
RUN chmod 0555 entrypoint.sh \
  && mkdir -p /var/log/clamav \
  && chown -R node:node /app /var/lib/clamav /var/log/clamav

USER node
EXPOSE 8080
ENTRYPOINT ["./entrypoint.sh"]

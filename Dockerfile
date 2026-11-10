FROM node:26-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    MEDENC_DB=/app/data/medical.db

COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY js ./js
COPY css ./css
COPY index.html ./

RUN mkdir -p /app/data

EXPOSE 8787
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]

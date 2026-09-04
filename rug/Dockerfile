FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server ./server
COPY public ./public
COPY agents ./agents
RUN mkdir -p /data
ENV PORT=8787
ENV RUG_DATA_DIR=/data
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "server/index.mjs"]

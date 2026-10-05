FROM node:24-alpine3.24
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 SQLITE_PATH=/data/wishlist.sqlite
WORKDIR /app
COPY --chown=node:node index.html server.mjs migrate.mjs backup.mjs verify-backup.mjs ./
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]

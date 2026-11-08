FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV NODE_ENV=production PORT=8080 DATA_FILE=/data/db.json
# Reste en root : le volume Fly monté sur /data appartient à root (passer en USER node empêcherait d'écrire les messages).
EXPOSE 8080
CMD ["node", "server.js"]

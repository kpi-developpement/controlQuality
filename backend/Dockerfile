FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# LibreOffice : conversion des supports PowerPoint en PDF (affichage dans l'onglet Formations & Quiz)
RUN apk add --no-cache libreoffice ttf-dejavu font-noto

COPY package*.json ./

# Le lock file contient les URLs du registry interne : installation depuis le registry public
RUN rm -f package-lock.json \
    && npm install --omit=dev --registry https://registry.npmjs.org/ \
    && npm cache clean --force

COPY . .

# Fichiers déposés (vidéos de formation…) : montés sur un volume Docker (voir docker-compose.yml)
RUN mkdir -p /app/uploads

EXPOSE 5000

CMD ["node", "server.js"]

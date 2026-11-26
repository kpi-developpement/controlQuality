FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# LibreOffice : conversion des supports PowerPoint en PDF (affichage dans l'onglet Formations & Quiz)
# (polices : « font-dejavu » depuis Alpine 3.17, « ttf-dejavu » avant ; une police absente ne bloque pas le build)
RUN apk add --no-cache libreoffice \
    && (apk add --no-cache font-dejavu font-noto || apk add --no-cache ttf-dejavu || echo "Polices supplémentaires indisponibles") \
    && (command -v soffice || command -v libreoffice || ls /usr/lib/libreoffice/program/soffice)

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

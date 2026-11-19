FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Supprime le lock file qui contient les URLs du registry interne
RUN rm -f package-lock.json && npm install --registry https://registry.npmjs.org/

COPY . .

EXPOSE 5000

CMD ["npm", "start"]

FROM node:20-alpine

WORKDIR /app

# Adresses du backend vues par le navigateur, figées au build par Vite.
# Vides = valeurs par défaut du code (http://my-backend:5000/api).
ARG VITE_API_URL=""
ARG VITE_API_BASE_URL=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package*.json ./

RUN npm config set registry https://registry.npmjs.org/ \
    && npm install --include=dev

COPY . .

RUN npx vite build

EXPOSE 5173

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]

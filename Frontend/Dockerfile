FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=development

COPY package*.json ./

RUN npm config set registry https://registry.npmjs.org/ \
    && npm install --include=dev \
    && npx vite --version

COPY . .

RUN npx vite build

EXPOSE 5173

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]

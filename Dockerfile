FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build
RUN npm prune --omit=dev
RUN npx playwright install chromium --with-deps

ENV NODE_ENV=production

CMD ["npm", "run", "start"]

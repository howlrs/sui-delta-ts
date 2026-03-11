FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev --ignore-scripts && npm install -g tsx

COPY tsconfig.json ./
COPY src/ src/

CMD ["tsx", "src/scripts/watch-fr.ts"]

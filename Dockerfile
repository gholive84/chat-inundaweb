FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/

RUN npm install --workspaces --include-workspace-root --omit=dev || npm install --omit=dev

COPY backend ./backend

WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "server.js"]

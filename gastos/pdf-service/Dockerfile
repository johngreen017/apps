FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV NODE_ENV=production
CMD ["npm","start"]

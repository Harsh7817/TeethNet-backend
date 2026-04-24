FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* /app/
RUN npm install --production
COPY . /app
ENV NODE_ENV=production
CMD ["node", "server.js"]
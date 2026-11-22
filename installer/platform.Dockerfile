FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci --include=dev && npm run build
EXPOSE 4100
CMD ["npm", "run", "start"]

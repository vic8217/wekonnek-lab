FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY src/ ./src/

# Health check
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:3100/health || exit 1

EXPOSE 3100

USER node

CMD ["node", "src/index.js"]

FROM node:20-alpine

# Unraid labels
LABEL net.unraid.docker.webui="http://[IP]:[PORT:3000]/"
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/nbennett1978/vocab-trainer/main/pictures/vocab-trainer-logo_small.png"

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source files
COPY server/ ./server/
COPY public/ ./public/

# Create data directory
RUN mkdir -p /app/data/uploads

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Start the server
CMD ["node", "server/index.js"]

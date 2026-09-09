# Build stage
FROM node:22-alpine AS builder

# Install build tools for native C++ modules (better-sqlite3, bcrypt)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package descriptors and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build TypeScript
COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

# Install build tools for native C++ modules in production stage
RUN apk add --no-cache python3 make g++

WORKDIR /app

ENV NODE_ENV=production

# Copy package descriptors and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built dist files from builder
COPY --from=builder /app/dist ./dist

# Expose default Gateway port
EXPOSE 2222 8080

CMD ["node", "dist/index.js"]


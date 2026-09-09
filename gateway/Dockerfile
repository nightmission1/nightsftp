# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build TypeScript
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package descriptors and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built dist files from builder
COPY --from=builder /app/dist ./dist

# Expose default Gateway port
EXPOSE 25628

CMD ["node", "dist/index.js"]

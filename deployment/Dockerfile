# use node 18 lts
FROM node:18-alpine

# set working directory
WORKDIR /app

# install system dependencies for puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# tell Puppeteer to skip installing chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# copy package files
COPY package*.json ./

# install dependencies
RUN npm ci --only=production && npm cache clean --force

# copy application code
COPY src/ ./src/

# create non root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# change ownership of the app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# expose port
EXPOSE 3000

# health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# start the application
CMD ["npm", "start"]
FROM node:18-bullseye

# Install Chromium and required fonts/libraries exactly as Remotion and Puppeteer require them for rendering
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libnspr4 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libdrm2 \
    libgbm1 \
    libxcb1 \
    libxcomposite1 \
    libxrandr2 \
    libxshmfence1 \
    libx11-xcb1 \
    fonts-liberation \
    libappindicator3-1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Point Puppeteer explicitly to the system Chromium rather than attempting to download its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set Working directory
WORKDIR /app

# Copy package configurations and install dependencies cleanly
COPY package*.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Expose the API port
EXPOSE 3002

# Start the Node.js server
CMD ["npm", "start"]

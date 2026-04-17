FROM node:18-bullseye-slim

# ─── System libraries only — NO apt chromium package ──────────────────────────
# @sparticuz/chromium (in package.json) already ships its own Chromium binary.
# Installing apt's "chromium" was downloading a redundant 33 MB layer every build.
# We only need the shared libraries that Chromium requires at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
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
    libxdamage1 \
    libxfixes3 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# No system Chromium — @sparticuz/chromium provides the binary via npm
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# ─── Dependency layer (cached unless package.json changes) ────────────────────
# Copy lockfile FIRST so Docker cache is reused on every deploy that
# doesn't touch dependencies — this is the most impactful caching trick.
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Application source ───────────────────────────────────────────────────────
COPY . .

EXPOSE 3008

CMD ["npm", "start"]
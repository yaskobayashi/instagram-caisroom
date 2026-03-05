FROM node:20-slim

# Chrome/Remotion shared library dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxss1 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cached layer unless package.json changes)
# PUPPETEER_SKIP_DOWNLOAD skips the ~130MB Chrome binary during install;
# Remotion will download it on first render via ensureBrowser().
COPY package*.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --prefer-offline

# Copy source
COPY . .

EXPOSE 3333

CMD ["npm", "start"]

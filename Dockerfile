# Gebruik een officiële Node image
FROM node:20-slim

# Installeer de nodige systeem-libraries voor node-canvas
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Werkmap instellen
WORKDIR /app

# Kopieer package files en installeer dependencies
COPY package*.json ./
RUN npm install

# Kopieer de rest van de code
COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
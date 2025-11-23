# Menggunakan Node.js 22 Alpine (Terbaru & Ringan)
FROM node:22-alpine

WORKDIR /app

# Copy package.json
COPY package.json ./

# Install dependencies
RUN npm install --omit=dev --legacy-peer-deps

# Copy kode bot
COPY . .

# Expose port
EXPOSE 5000

# Jalankan
CMD ["npm", "start"]
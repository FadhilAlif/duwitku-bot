#!/bin/bash
# Script untuk rebuild Duwitku Bot dengan aman

echo "🛑 Stopping containers..."
docker-compose down --remove-orphans

echo "🧹 Cleaning up dangling images..."
docker image prune -f

echo "🔨 Building and starting containers..."
docker-compose up --build -d

echo ""
echo "✅ Done! Checking status..."
docker-compose ps

echo ""
echo "📋 View logs with: docker-compose logs -f bot"

#!/bin/bash
# Seed inventory with sample products
# Run after services are up: ./scripts/seed-inventory.sh

echo "🌱 Seeding inventory..."

RESPONSE=$(curl -s -X POST http://localhost:3003/seed)
echo "Response: $RESPONSE"

echo ""
echo "📦 Available products:"
curl -s http://localhost:3003/products | jq '.'

echo ""
echo "✅ Seed complete!"

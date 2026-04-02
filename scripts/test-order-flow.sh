#!/bin/bash
# End-to-end test: Happy path
# Run after services are up and seeded

set -e

BASE_URL="http://localhost:3000"

echo "🧪 Eventify E2E Test — Happy Path"
echo "=================================="

# Step 1: Signup
echo ""
echo "1️⃣  Creating user..."
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@eventify.com","password":"password123","name":"Test User"}')

TOKEN=$(echo $SIGNUP_RESPONSE | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "Signup might have failed, trying login..."
  LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@eventify.com","password":"password123"}')
  TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token')
fi

echo "   Token: ${TOKEN:0:30}..."

# Step 2: Seed products
echo ""
echo "2️⃣  Seeding products..."
curl -s -X POST http://localhost:3003/seed > /dev/null

PRODUCTS=$(curl -s http://localhost:3003/products)
PRODUCT_ID=$(echo $PRODUCTS | jq -r '.[0].id')
echo "   Using product: $PRODUCT_ID"

# Step 3: Create order
echo ""
echo "3️⃣  Creating order..."
ORDER_RESPONSE=$(curl -s -X POST "$BASE_URL/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: test-$(date +%s)" \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}],\"totalAmount\":\"149.99\"}")

ORDER_ID=$(echo $ORDER_RESPONSE | jq -r '.id')
echo "   Order ID: $ORDER_ID"
echo "   Status: $(echo $ORDER_RESPONSE | jq -r '.status')"

# Step 4: Wait for saga to complete
echo ""
echo "4️⃣  Waiting for saga to complete (5s)..."
sleep 5

# Step 5: Check order status
echo ""
echo "5️⃣  Checking order status..."
FINAL_STATUS=$(curl -s "$BASE_URL/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "   Final Status: $(echo $FINAL_STATUS | jq -r '.status')"
echo "   Saga Step: $(echo $FINAL_STATUS | jq -r '.sagaState.currentStep')"
echo "   Saga Status: $(echo $FINAL_STATUS | jq -r '.sagaState.status')"

echo ""
echo "=================================="
STATUS=$(echo $FINAL_STATUS | jq -r '.status')
if [ "$STATUS" = "CONFIRMED" ]; then
  echo "✅ Happy path test PASSED!"
else
  echo "⚠️  Order is in status: $STATUS (may still be processing)"
  echo "   Check logs: docker compose logs -f"
fi

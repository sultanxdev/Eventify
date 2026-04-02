#!/bin/bash
# Test failure scenarios
# Requires services to be running

BASE_URL="http://localhost:3000"

echo "🧪 Eventify Failure Mode Tests"
echo "================================"

# Login first
echo ""
echo "🔑 Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@eventify.com","password":"password123"}')
TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Login failed. Run test-order-flow.sh first to create user."
  exit 1
fi

PRODUCTS=$(curl -s http://localhost:3003/products)
PRODUCT_ID=$(echo $PRODUCTS | jq -r '.[0].id')

echo ""
echo "================================"
echo "Test 1: Idempotency"
echo "================================"
IDEMP_KEY="idemp-test-$(date +%s)"

echo "Sending same order twice with key: $IDEMP_KEY"
R1=$(curl -s -X POST "$BASE_URL/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEMP_KEY" \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}],\"totalAmount\":\"149.99\"}")
ID1=$(echo $R1 | jq -r '.id')
echo "  First request — Order ID: $ID1"

R2=$(curl -s -X POST "$BASE_URL/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEMP_KEY" \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}],\"totalAmount\":\"149.99\"}")
ID2=$(echo $R2 | jq -r '.id')
echo "  Second request — Order ID: $ID2"

if [ "$ID1" = "$ID2" ]; then
  echo "  ✅ Idempotency PASSED — same order returned"
else
  echo "  ❌ Idempotency FAILED — different orders created"
fi

echo ""
echo "================================"
echo "Test 2: Payment Failure Mode"
echo "================================"
echo "To test payment failures:"
echo "  1. Stop payment service:  docker compose stop payment-service"
echo "  2. Set env and restart:"
echo "     PAYMENT_FAILURE_RATE=1.0 docker compose up -d payment-service"
echo "  3. Create an order and watch it fail"
echo "  4. Check order status → should be FAILED"
echo "  5. Check inventory → should be released (compensation)"

echo ""
echo "================================"
echo "Test 3: Payment Timeout"
echo "================================"
echo "To test payment timeouts:"
echo "  1. Set PAYMENT_TIMEOUT_MS=60000 in docker-compose.yml"
echo "  2. Restart: docker compose up -d payment-service"
echo "  3. Create an order"
echo "  4. Wait for SAGA_TIMEOUT_MS (default 30s)"
echo "  5. Order should transition to FAILED automatically"

echo ""
echo "================================"
echo "Test 4: Duplicate Events"
echo "================================"
echo "To test duplicate event handling:"
echo "  1. Set DUPLICATE_EVENT_MODE=true in docker-compose.yml"
echo "  2. Restart: docker compose up -d payment-service"
echo "  3. Create an order"
echo "  4. Check order service logs — should show 'Event already processed'"

echo ""
echo "🔍 Monitor tests with:"
echo "  Logs:    docker compose logs -f"
echo "  Traces:  http://localhost:16686 (Jaeger)"
echo "  Kafka:   http://localhost:8080 (Kafka UI)"

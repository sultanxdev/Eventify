# Eventify — Failure Scenarios & Injection

## Why Failure Injection?

In distributed systems, the happy path is easy. What makes a system production-ready is how it handles:

- **Duplicate events** (at-least-once delivery)
- **Service timeouts** (network issues, slow consumers)
- **Service crashes** (mid-saga termination)
- **Delayed processing** (consumer lag)

Eventify supports **configurable failure injection** to prove correctness under these conditions.

---

## Failure Modes

All failure modes are configured via **environment variables** on the Payment Service.

### 1. Random Payment Failure

**Variable:** `PAYMENT_FAILURE_RATE`
**Default:** `0` (no failures)
**Range:** `0.0` to `1.0`

```yaml
# docker-compose.yml
payment-service:
  environment:
    PAYMENT_FAILURE_RATE: "0.3"  # 30% of payments fail
```

**What happens:**
1. Payment Service receives `payment.process_requested.v1`
2. Random number generated — if < failure rate, payment fails
3. Publishes `payment.failed.v1`
4. Order Service triggers compensation (inventory release)

**What to observe:**
- Order transitions to `FAILED`
- Inventory is released
- DLQ remains empty (this is a "clean" failure)

---

### 2. Payment Timeout Simulation

**Variable:** `PAYMENT_TIMEOUT_MS`
**Default:** `0` (no delay)

```yaml
payment-service:
  environment:
    PAYMENT_TIMEOUT_MS: "60000"  # 60 second delay
```

**What happens:**
1. Payment Service receives event but sleeps for 60 seconds
2. Order Service's timeout handler detects stale `PAYMENT_PENDING` saga
3. Order transitions to `FAILED`
4. Inventory release triggered as compensation
5. Payment Service eventually wakes up — but order is already failed

**What to observe:**
- Saga timeout handler kicks in
- Order fails even though payment eventually processes
- Idempotency prevents double-processing

---

### 3. Service Crash (Mid-Saga)

**Variable:** `PAYMENT_CRASH_MODE`
**Default:** `false`

```yaml
payment-service:
  environment:
    PAYMENT_CRASH_MODE: "true"  # Process exits mid-handling
```

**What happens:**
1. Payment Service receives event
2. Process calls `process.exit(1)` mid-handling
3. Docker restarts the container (restart policy)
4. Kafka redelivers unacknowledged message
5. Payment Service processes on retry

**What to observe:**
- Container restart in Docker logs
- Kafka redelivery (at-least-once guarantee)
- `processed_events` table prevents duplicate processing
- Order eventually reaches `CONFIRMED` or `FAILED`

---

### 4. Duplicate Event Publishing

**Variable:** `DUPLICATE_EVENT_MODE`
**Default:** `false`

```yaml
payment-service:
  environment:
    DUPLICATE_EVENT_MODE: "true"  # Publishes response event twice
```

**What happens:**
1. Payment Service processes payment normally
2. Publishes `payment.succeeded.v1` **twice** to Kafka
3. Order Service receives both copies
4. First copy: processes normally, records in `processed_events`
5. Second copy: detected as duplicate, skipped

**What to observe:**
- Two identical events in Kafka topic
- Only one state transition in Order Service
- `processed_events` table shows single entry

---

## How to Test Each Scenario

### Quick Test Commands

```bash
# 1. Start system normally
docker compose up -d

# 2. Create a user and get JWT
TOKEN=$(curl -s -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123","name":"Test"}' \
  | jq -r '.token')

# 3. Seed inventory
curl -X POST http://localhost:3003/seed

# 4. Create an order
curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: test-order-001" \
  -d '{"items":[{"productId":"<product-id>","quantity":1}]}'

# 5. Check order status
curl -s http://localhost:3000/orders/<order-id> \
  -H "Authorization: Bearer $TOKEN"
```

### Enable Failure Mode

```bash
# Stop payment service
docker compose stop payment-service

# Restart with failure injection
docker compose up -d payment-service \
  -e PAYMENT_FAILURE_RATE=0.5

# Or modify docker-compose.yml and restart
docker compose up -d --build payment-service
```

---

## Expected Behavior Matrix

| Scenario | Order Status | Inventory | DLQ | Traces |
|----------|-------------|-----------|-----|--------|
| Happy path | `CONFIRMED` | Reserved | Empty | Full flow visible |
| Payment failure | `FAILED` | Released | Empty | Shows compensation |
| Payment timeout | `FAILED` | Released | Empty | Shows timeout trigger |
| Service crash | `CONFIRMED`/`FAILED` | Correct | Empty | Shows retry |
| Duplicate events | `CONFIRMED` | Reserved (once) | Empty | Shows dedup |
| Poison message | N/A | N/A | Has message | Shows DLQ routing |

---

## Monitoring During Tests

### Jaeger (Traces)
```
http://localhost:16686
```
- Search by service name
- Filter by `correlation_id` tag
- See full request lifecycle

### Kafka UI (Messages)
```
http://localhost:8080
```
- View topic messages
- Check consumer group lag
- Inspect DLQ topics

### Docker Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f payment-service

# Filter by correlation ID
docker compose logs -f | grep "correlation_id=abc-123"
```

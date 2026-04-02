# 🚀 Eventify — Reliable Distributed Order Processing

> Event-driven microservices system designed to **handle real-world failure scenarios** using Saga orchestration, transactional Outbox, and idempotent consumers.

![Node.js](https://img.shields.io/badge/Node.js-20-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Kafka](https://img.shields.io/badge/Apache_Kafka-Event_Bus-orange)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)
![Docker](https://img.shields.io/badge/Docker_Compose-Orchestration-2496ED)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-Tracing-blueviolet)

---

## ⚡ Why this project exists

Distributed systems don't fail cleanly. They fail like this:

- Duplicate events from at-least-once delivery
- Partial success across services
- Payment timeouts mid-transaction
- Services crashing between database write and event publish

**Eventify is built to handle those realities — not ignore them.**

---

## 🧠 What this system demonstrates

| Capability | Implementation |
|-----------|----------------|
| ✅ Saga Orchestration | No distributed transactions — deterministic state machine |
| ✅ Transactional Outbox | Atomic DB write + event publish — no dual-write risk |
| ✅ Idempotent Consumers | Duplicate events don't cause double processing |
| ✅ At-least-once Handling | System correct even when Kafka redelivers |
| ✅ Compensation Flows | Automatic rollback on payment failure |
| ✅ Failure Injection | Simulate crashes, timeouts, duplicates |
| ✅ Distributed Tracing | End-to-end visibility across all services |
| ✅ DB-per-Service | True data isolation, no shared databases |

👉 **This is not CRUD. This is failure-aware backend engineering.**

---

## 🏗️ Architecture

```
Client → API Gateway → Order Service (Saga Orchestrator)
                              ↓
                    Apache Kafka (Event Bus)
                              ↓
           Inventory → Payment → Notification
              ↓           ↓
          Postgres     Postgres
```

Each service has:
- Its own **codebase** (no shared packages)
- Its own **database** (separate Postgres container)
- Its own **Kafka producers/consumers**
- Its own **OpenTelemetry instrumentation**

---

## 🔄 Core Flow

```
Create Order (PENDING)
 → Reserve Inventory (INVENTORY_RESERVED)
 → Process Payment (PAYMENT_PENDING)
 → Confirm Order (CONFIRMED)
 → Send Notification
```

---

## 💥 Failure Handling

### 1. Payment Failure → Compensation
```
payment.failed
 → inventory.release_requested (compensation)
 → order.failed
 → notification sent
```

### 2. Payment Timeout → Auto-Recovery
```
PAYMENT_PENDING > 30s
 → timeout handler triggers
 → inventory released
 → order.failed
```

### 3. Duplicate Events → Idempotent Processing
```
Kafka delivers event twice
 → processed_events table check
 → second delivery skipped
 → no double processing
```

### 4. Service Crash → Outbox Recovery
```
Service crashes after DB write but before Kafka publish
 → Outbox event persisted in DB transaction
 → Outbox worker publishes on next poll
 → No event loss
```

---

## 🧪 Failure Injection (Proof > Claims)

Simulate real production issues via environment variables:

```bash
PAYMENT_FAILURE_RATE=0.3      # 30% random failure
PAYMENT_TIMEOUT_MS=60000      # 60s artificial delay
PAYMENT_CRASH_MODE=true       # Process exits mid-handling
DUPLICATE_EVENT_MODE=true     # Same event published twice
```

👉 This is where most projects stop. This one doesn't.

---

## 🛡️ Reliability Design

| Problem | Solution |
|---------|----------|
| Dual writes | Transactional Outbox |
| Duplicate events | Idempotent consumers (`processed_events` table) |
| Partial failure | Saga + Compensation flows |
| Message loss | At-least-once delivery + Outbox |
| Timeouts | Saga time-based failure handler |
| API duplicates | Idempotency keys |

---

## 🧱 Tech Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js 20 + TypeScript |
| **Framework** | Express.js |
| **ORM** | Prisma |
| **Message Broker** | Apache Kafka (Bitnami) |
| **Database** | PostgreSQL 16 (per service) |
| **Tracing** | OpenTelemetry + Jaeger |
| **Auth** | JWT + bcrypt |
| **Containerization** | Docker Compose |

---

## 📐 Service Architecture

| Service | Port | Responsibility | Database |
|---------|------|---------------|----------|
| API Gateway | 3000 | JWT validation, routing, rate limiting | None |
| Auth Service | 3001 | Signup, login, JWT issuance | `postgres-auth` |
| Order Service | 3002 | **Saga orchestrator**, outbox, timeouts | `postgres-orders` |
| Inventory Service | 3003 | Stock reservation & compensation | `postgres-inventory` |
| Payment Service | 3004 | Payment simulation + failure injection | `postgres-payments` |
| Notification Service | 3005 | Async notifications (stateless) | None |

---

## ⚙️ Quick Start

```bash
# Clone the repo
git clone https://github.com/your-username/eventify.git
cd eventify

# Start everything
docker compose up --build

# In another terminal — seed products
./scripts/seed-inventory.sh

# Run the E2E test
./scripts/test-order-flow.sh
```

### Access Points

| Tool | URL | Purpose |
|------|-----|---------|
| API Gateway | `http://localhost:3000` | Main API entry |
| Jaeger (Tracing) | `http://localhost:16686` | Distributed trace visualization |
| Kafka UI | `http://localhost:8080` | Topic/message inspection |

---

## 🔍 Observability

### Distributed Tracing (Jaeger)
Every request is traced across all services with OpenTelemetry. Open Jaeger at `http://localhost:16686` to see the full lifecycle of any order.

### Structured Logging
Every log entry includes:
- `service` — which service
- `correlationId` — trace across services
- `orderId` — which order
- `eventId` — which event

```json
{
  "level": "info",
  "service": "order-service",
  "correlationId": "abc-123",
  "orderId": "ord-456",
  "message": "Saga transitioned to PAYMENT_PENDING"
}
```

---

## 📊 Event Topics

| Topic | Producer | Consumer |
|-------|----------|----------|
| `order.created.v1` | Order Service | Inventory Service |
| `inventory.reserved.v1` | Inventory Service | Order Service |
| `inventory.failed.v1` | Inventory Service | Order Service |
| `inventory.release_requested.v1` | Order Service | Inventory Service |
| `payment.process_requested.v1` | Order Service | Payment Service |
| `payment.succeeded.v1` | Payment Service | Order Service |
| `payment.failed.v1` | Payment Service | Order Service |
| `order.confirmed.v1` | Order Service | Notification Service |
| `order.failed.v1` | Order Service | Notification Service |

---

## 📁 Project Structure

```
eventify/
├── docker-compose.yml
├── docs/
│   ├── architecture.md
│   ├── saga-flows.md
│   ├── failure-scenarios.md
│   └── api-reference.md
├── services/
│   ├── api-gateway/          # JWT + routing + rate limit
│   ├── auth-service/         # Signup/login + own Postgres
│   ├── order-service/        # Saga orchestrator + own Postgres
│   ├── inventory-service/    # Stock management + own Postgres
│   ├── payment-service/      # Payment sim + failure injection + own Postgres
│   └── notification-service/ # Stateless notifications
└── scripts/
    ├── seed-inventory.sh
    ├── test-order-flow.sh
    └── test-failure-modes.sh
```

> **No shared packages.** Each service is fully independent — own `package.json`, own Prisma schema, own types. This mirrors how real microservices teams operate.

---

## 🎯 Resume Positioning

> Designed and implemented an event-driven microservices system using **Saga orchestration** and **transactional Outbox** to ensure reliable distributed order processing under at-least-once delivery semantics.

> Implemented **idempotent consumers**, **compensation workflows**, and **failure injection** (duplicate events, timeouts, service crashes) to validate system correctness under real-world failure scenarios.

> Integrated **distributed tracing** (OpenTelemetry + Jaeger) to debug cross-service event flows and analyze failure scenarios across 6 independently deployed services.

---

## 📌 Key Takeaway

> Building distributed systems is easy.
> Making them correct under failure is hard.
>
> This project focuses on the second.

---

## 📖 Documentation

- [Architecture & System Design](./docs/architecture.md)
- [Saga Flows & Compensation](./docs/saga-flows.md)
- [Failure Scenarios & Injection](./docs/failure-scenarios.md)
- [API Reference](./docs/api-reference.md)
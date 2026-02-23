
###🚀 Eventify — Final Product Requirements Document

**Type:** Event-driven microservices backend

**Goal:** Demonstrate reliable distributed order processing

**Audience:** Backend recruiters and interviewers

**Consistency Model:** Eventual consistency

**Delivery Semantics:** At-least-once

**Transaction Pattern:** Orchestrated Saga

---

# 1. 🎯 Problem Statement

Modern platforms must process orders across multiple independent services (inventory, payments, notifications) without distributed transactions.

Common failure risks:

- partial success across services
- duplicate message delivery
- lost events during crashes
- tight coupling between services

**Eventify Lite** demonstrates how to build a fault-tolerant order pipeline using event-driven microservices and Saga orchestration.

---

# 2. 🧠 System Overview

## Core Workflow

```
Create Order
 → Reserve Inventory
 → Process Payment
 → Confirm Order
 → Send Notification
```

## Architecture Decisions

| Area | Choice | Why |
| --- | --- | --- |
| External comm | REST | simple client interface |
| Internal comm | async events | loose coupling |
| Consistency | eventual | avoids distributed tx |
| Delivery | at-least-once | industry standard |
| Saga type | orchestrated | easier reasoning |

---

# 3. 🏗️ Services (Final Scope)

You will build **6 lightweight services**.

| Service | Role |
| --- | --- |
| API Gateway | entry point |
| Auth Service | authentication |
| Order Service | saga orchestrator |
| Inventory Service | stock management |
| Payment Service | payment simulation |
| Notification Service | async side effects |

---

# 4. 🔑 Key Architecture Principles

## Database per service

Each service:

- owns its schema
- runs its own migrations
- never queries another service DB

**Why:** loose coupling and independent scaling.

---

## Event-driven communication

After order creation:

- services communicate only via events
- no synchronous chaining
- no cross-service transactions

---

## Idempotency everywhere

System must tolerate duplicate delivery safely.

---

# 5. 🔧 Service Requirements

---

## 5.1 API Gateway

### Responsibilities

- route client requests
- validate JWT
- inject correlation_id
- apply basic rate limiting

### Endpoints

```
POST /auth/signup
POST /auth/login
POST /orders
GET  /orders/:id
GET  /health
```

### Why it exists

- hides service topology
- centralizes auth
- standardizes entry

---

## 5.2 Auth Service

### Responsibilities

- user registration
- login
- JWT issuance

### Database

- users
- refresh_tokens (optional V2)

### Requirements

- bcrypt hashing
- access token expiry (15m)
- input validation

---

## 5.3 Order Service (⭐ Core Brain)

### Responsibilities

- create orders
- maintain saga state machine
- publish events via Outbox
- handle compensation
- enforce API idempotency

### Database

- orders
- saga_state
- outbox_events
- idempotency_keys
- processed_events

### Order States

```
PENDING
INVENTORY_RESERVED
PAYMENT_PENDING
CONFIRMED
FAILED
```

---

### Events Produced

```
order.created
payment.process_requested
order.confirmed
order.failed
inventory.release_requested
notification.send_requested
```

---

### Critical Requirements

- idempotent POST /orders
- correlation + causation propagation
- transactional outbox
- deterministic saga transitions

---

## 5.4 Inventory Service

### Responsibilities

- reserve stock
- release stock
- maintain inventory

### Database

- products
- inventory_reservations
- processed_events

### Events Consumed

```
order.created
inventory.release_requested
```

### Events Produced

```
inventory.reserved
inventory.failed
inventory.released
```

### Requirements

- stock validation
- idempotent consumer
- no negative inventory

---

## 5.5 Payment Service

### Responsibilities

- simulate payment
- publish result
- remain idempotent

### Database

- payments
- processed_events

### Events Consumed

```
payment.process_requested
```

### Events Produced

```
payment.succeeded
payment.failed
```

### Requirements

- configurable failure rate
- idempotent per order
- retry safe

---

## 5.6 Notification Service

### Responsibilities

- send async notifications
- retry transient failures
- record delivery attempts
- isolate failures

### Database

- notifications
- delivery_attempts
- processed_events
- failed_events (lite DLQ)

---

### Events Consumed

```
order.confirmed
order.failed
```

---

### Retry Strategy (Lite)

- exponential backoff
- max attempts (e.g., 5)
- then mark FAILED
- allow manual replay

**Why:** keeps system realistic without heavy DLQ infra.

---

# 6. 🔄 Saga Design

## Type: Orchestrated

Order Service controls transitions.

---

## Happy Path

```
order.created
 → inventory.reserved
 → payment.succeeded
 → order.confirmed
 → notification triggered
```

---

## Failure Path

### Inventory fails

```
inventory.failed
 → order.failed
```

### Payment fails

```
payment.failed
 → inventory.release_requested
 → order.failed
```

---

# 7. 🛡️ Reliability Guarantees

---

## Outbox Pattern (MANDATORY)

Within one DB transaction:

- write order
- write outbox event

Worker publishes asynchronously.

**Purpose:** prevent dual-write data loss.

---

## Delivery Semantics

**Choice:** At-least-once

**Tradeoff:** duplicates possible → handled via idempotency.

---

## Retry Policy (Required)

- exponential backoff
- bounded attempts
- structured logging

---

## Failed Event Handling (Lite DLQ)

Instead of full DLQ topic:

- store in `failed_events`
- expose replay endpoint

**Why:** simpler but still production-aware.

---

# 8. 🔍 Observability (Right-Sized)

---

## Logging (required)

Structured JSON logs containing:

- service_name
- event_id
- correlation_id
- order_id
- latency_ms

---

## Metrics (optional but good)

Minimum:

- events_processed_total
- events_failed_total
- saga_success_total
- saga_failure_total

---

## Health Endpoints

Every service must expose:

```
GET /health
```

---

# 9. 🔐 Security

- JWT at gateway
- bcrypt passwords
- input validation
- basic rate limiting

---

# 10. 🐳 Deployment

System must run via:

```
docker compose up
```

Includes:

- all services
- Postgres
- Kafka/Redpanda

---

# 11. ✅ Definition of Done

Project is complete when:

- full saga executes end-to-end
- failures trigger compensation
- duplicate events are harmless
- retries visibly occur
- failed events are replayable
- docker setup works in one command
- logs show correlation flow

---

# 🎯 Resume Positioning Statement

> Eventify Lite is an event-driven microservices order system implementing Saga orchestration, transactional Outbox, idempotent consumers, bounded retries, and asynchronous notifications to ensure reliable distributed processing.
> 

---

## 🧭 Final Advice (straight)

You do **not** need more features.

If you:

- implement this cleanly
- keep the repo tidy
- add a clear README diagram
- show real failure handling

…you will already stand out strongly as a final-year backend candidate.

---

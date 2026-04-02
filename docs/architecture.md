# Eventify — System Architecture

## Overview

Eventify is an event-driven microservices system that processes orders through a **Saga orchestration pattern**. The system coordinates inventory reservation, payment processing, and notifications — all communicated asynchronously via Apache Kafka.

---

## High-Level Architecture

```mermaid
graph TB
    Client["🌐 Client"]
    
    subgraph Gateway["API Gateway :3000"]
        GW["JWT Validation<br/>Rate Limiting<br/>Correlation ID"]
    end
    
    subgraph Auth["Auth Service :3001"]
        AS["Signup / Login<br/>JWT Issuance"]
        AuthDB[("postgres-auth")]
    end
    
    subgraph Orders["Order Service :3002"]
        OS["Saga Orchestrator<br/>Outbox Worker<br/>Timeout Handler"]
        OrderDB[("postgres-orders")]
    end
    
    subgraph Inventory["Inventory Service :3003"]
        IS["Stock Reserve/Release<br/>Idempotent Consumer"]
        InvDB[("postgres-inventory")]
    end
    
    subgraph Payment["Payment Service :3004"]
        PS["Payment Simulation<br/>Failure Injection"]
        PayDB[("postgres-payments")]
    end
    
    subgraph Notification["Notification Service :3005"]
        NS["Async Notifications<br/>Stateless"]
    end
    
    Kafka{{"Apache Kafka<br/>(Event Bus)"}}
    Jaeger["Jaeger<br/>(Distributed Tracing)"]
    
    Client -->|REST| GW
    GW -->|REST| AS
    GW -->|REST| OS
    
    OS -->|Events| Kafka
    Kafka -->|Events| IS
    Kafka -->|Events| PS
    Kafka -->|Events| NS
    IS -->|Events| Kafka
    PS -->|Events| Kafka
    Kafka -->|Events| OS
    
    AS --- AuthDB
    OS --- OrderDB
    IS --- InvDB
    PS --- PayDB
    
    OS -.->|Traces| Jaeger
    IS -.->|Traces| Jaeger
    PS -.->|Traces| Jaeger
    NS -.->|Traces| Jaeger
```

---

## Service Communication

| From | To | Method | Description |
|------|----|--------|-------------|
| Client | API Gateway | REST | All external requests |
| API Gateway | Auth Service | REST (proxy) | Signup, Login |
| API Gateway | Order Service | REST (proxy) | Create/Get orders |
| Order Service | Kafka | Event publish | Via Transactional Outbox |
| Kafka | Inventory Service | Event consume | `order.created.v1` |
| Kafka | Payment Service | Event consume | `payment.process_requested.v1` |
| Kafka | Notification Service | Event consume | `order.confirmed.v1`, `order.failed.v1` |
| Inventory Service | Kafka | Event publish | `inventory.reserved.v1`, `inventory.failed.v1` |
| Payment Service | Kafka | Event publish | `payment.succeeded.v1`, `payment.failed.v1` |
| Kafka | Order Service | Event consume | All response events |

### Key Principle
> **No synchronous service-to-service calls.** All inter-service communication happens via Kafka events. The only REST calls are from the API Gateway to internal service APIs.

---

## Database Isolation

Each service owns its database completely. No cross-service DB access.

```mermaid
graph LR
    subgraph "postgres-auth (port 5432)"
        A[users]
    end
    
    subgraph "postgres-orders (port 5433)"
        B[orders]
        C[saga_state]
        D[outbox_events]
        E[processed_events]
        F[idempotency_keys]
    end
    
    subgraph "postgres-inventory (port 5434)"
        G[products]
        H[reservations]
        I[processed_events]
    end
    
    subgraph "postgres-payments (port 5435)"
        J[payments]
        K[processed_events]
    end
```

---

## Event Flow (Happy Path)

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as API Gateway
    participant OS as Order Service
    participant K as Kafka
    participant IS as Inventory Service
    participant PS as Payment Service
    participant NS as Notification Service

    C->>GW: POST /orders
    GW->>OS: POST /orders (with JWT)
    OS->>OS: Create Order (PENDING)<br/>Write to Outbox
    OS-->>GW: 201 Created
    GW-->>C: 201 Created

    Note over OS: Outbox Worker polls
    OS->>K: order.created.v1
    K->>IS: order.created.v1
    IS->>IS: Reserve Stock
    IS->>K: inventory.reserved.v1
    K->>OS: inventory.reserved.v1
    OS->>OS: Update → INVENTORY_RESERVED<br/>Write payment request to Outbox

    Note over OS: Outbox Worker polls
    OS->>K: payment.process_requested.v1
    K->>PS: payment.process_requested.v1
    PS->>PS: Process Payment
    PS->>K: payment.succeeded.v1
    K->>OS: payment.succeeded.v1
    OS->>OS: Update → CONFIRMED<br/>Write notification to Outbox

    Note over OS: Outbox Worker polls
    OS->>K: notification.send_requested.v1
    K->>NS: notification.send_requested.v1
    NS->>NS: Send Notification
```

---

## Reliability Patterns

### 1. Transactional Outbox
Solves the **dual-write problem**: business state and events are written in the same DB transaction. An async worker then publishes events to Kafka.

```
┌─────────────────────────────────┐
│     Single DB Transaction       │
│                                 │
│  1. UPDATE orders SET status =  │
│     'INVENTORY_RESERVED'        │
│                                 │
│  2. INSERT INTO outbox_events   │
│     (payment.process_requested) │
│                                 │
└─────────────────────────────────┘
         ↓ (async)
   Outbox Worker publishes to Kafka
```

### 2. Idempotent Consumers
Every consumer checks `processed_events` table before processing. If `event_id` exists, skip.

### 3. Dead Letter Queue (DLQ)
Messages that fail after max retries are sent to `*.dlq` topics for manual review.

### 4. Saga Timeout
Background job detects stale `PAYMENT_PENDING` sagas and triggers compensation.

---

## Observability Stack

| Tool | URL | Purpose |
|------|-----|---------|
| Jaeger | `http://localhost:16686` | Distributed trace visualization |
| Kafka UI | `http://localhost:8080` | Topic/message inspection |
| Structured Logs | Docker logs | JSON logs with correlation IDs |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| ORM | Prisma |
| Message Broker | Apache Kafka |
| Database | PostgreSQL (per service) |
| Tracing | OpenTelemetry + Jaeger |
| Auth | JWT + bcrypt |
| Containerization | Docker Compose |

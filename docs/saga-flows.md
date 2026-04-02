# Eventify — Saga Flows

## Saga Overview

The Order Service acts as the **Saga Orchestrator**. It coordinates the distributed workflow using a state machine. Each step produces events via the **Transactional Outbox** pattern, and reactions from other services drive state transitions.

---

## Saga State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: Order Created
    
    PENDING --> INVENTORY_RESERVED: inventory.reserved.v1
    PENDING --> FAILED: inventory.failed.v1
    
    INVENTORY_RESERVED --> PAYMENT_PENDING: payment.process_requested.v1 sent
    
    PAYMENT_PENDING --> CONFIRMED: payment.succeeded.v1
    PAYMENT_PENDING --> FAILED: payment.failed.v1
    PAYMENT_PENDING --> FAILED: Timeout (SLA exceeded)
    
    CONFIRMED --> [*]
    FAILED --> [*]
```

### State Descriptions

| State | Meaning | Next Action |
|-------|---------|-------------|
| `PENDING` | Order created, waiting for inventory | Inventory Service will reserve stock |
| `INVENTORY_RESERVED` | Stock reserved, requesting payment | Payment request sent via outbox |
| `PAYMENT_PENDING` | Waiting for payment result | Payment Service will process |
| `CONFIRMED` | Payment succeeded, order complete | Notification sent |
| `FAILED` | Something failed, compensations triggered | Inventory released (if reserved) |

---

## Flow 1: Happy Path ✅

Everything succeeds.

```mermaid
sequenceDiagram
    participant OS as Order Service
    participant K as Kafka
    participant IS as Inventory Service
    participant PS as Payment Service
    participant NS as Notification Service

    Note over OS: State: PENDING
    OS->>K: order.created.v1
    K->>IS: order.created.v1
    IS->>IS: Reserve stock (SELECT FOR UPDATE)
    IS->>K: inventory.reserved.v1
    K->>OS: inventory.reserved.v1

    Note over OS: State: INVENTORY_RESERVED → PAYMENT_PENDING
    OS->>K: payment.process_requested.v1
    K->>PS: payment.process_requested.v1
    PS->>PS: Process payment
    PS->>K: payment.succeeded.v1
    K->>OS: payment.succeeded.v1

    Note over OS: State: CONFIRMED
    OS->>K: order.confirmed.v1
    OS->>K: notification.send_requested.v1
    K->>NS: notification.send_requested.v1
    NS->>NS: Log notification
```

---

## Flow 2: Inventory Failure ❌

Product out of stock.

```mermaid
sequenceDiagram
    participant OS as Order Service
    participant K as Kafka
    participant IS as Inventory Service
    participant NS as Notification Service

    Note over OS: State: PENDING
    OS->>K: order.created.v1
    K->>IS: order.created.v1
    IS->>IS: Check stock → INSUFFICIENT
    IS->>K: inventory.failed.v1
    K->>OS: inventory.failed.v1

    Note over OS: State: FAILED
    Note over OS: No compensation needed (nothing was reserved)
    OS->>K: order.failed.v1
    OS->>K: notification.send_requested.v1
    K->>NS: notification.send_requested.v1
    NS->>NS: Log failure notification
```

---

## Flow 3: Payment Failure ❌ (Compensation Required)

Inventory reserved but payment fails → must release inventory.

```mermaid
sequenceDiagram
    participant OS as Order Service
    participant K as Kafka
    participant IS as Inventory Service
    participant PS as Payment Service
    participant NS as Notification Service

    Note over OS: State: PENDING
    OS->>K: order.created.v1
    K->>IS: order.created.v1
    IS->>IS: Reserve stock ✅
    IS->>K: inventory.reserved.v1
    K->>OS: inventory.reserved.v1

    Note over OS: State: PAYMENT_PENDING
    OS->>K: payment.process_requested.v1
    K->>PS: payment.process_requested.v1
    PS->>PS: Process payment → FAILS
    PS->>K: payment.failed.v1
    K->>OS: payment.failed.v1

    Note over OS: State: FAILED → Trigger compensation
    OS->>K: inventory.release_requested.v1
    K->>IS: inventory.release_requested.v1
    IS->>IS: Release reserved stock
    IS->>K: inventory.released.v1

    OS->>K: order.failed.v1
    OS->>K: notification.send_requested.v1
    K->>NS: notification.send_requested.v1
    NS->>NS: Log failure notification
```

---

## Flow 4: Payment Timeout ⏰ (Compensation Required)

Payment service doesn't respond within SLA (e.g., 30 seconds).

```mermaid
sequenceDiagram
    participant TH as Timeout Handler
    participant OS as Order Service
    participant K as Kafka
    participant IS as Inventory Service
    participant NS as Notification Service

    Note over OS: State: PAYMENT_PENDING (for > 30s)
    
    TH->>TH: Check for stale sagas
    TH->>OS: Saga timeout detected!
    
    Note over OS: State: FAILED → Trigger compensation
    OS->>K: inventory.release_requested.v1
    K->>IS: inventory.release_requested.v1
    IS->>IS: Release reserved stock
    IS->>K: inventory.released.v1

    OS->>K: order.failed.v1
    OS->>K: notification.send_requested.v1
    K->>NS: notification.send_requested.v1
    NS->>NS: Log timeout failure notification
```

---

## Flow 5: Duplicate Event Handling 🔁

Same event delivered twice (at-least-once delivery).

```mermaid
sequenceDiagram
    participant K as Kafka
    participant IS as Inventory Service
    participant DB as processed_events

    K->>IS: order.created.v1 (event_id: abc-123)
    IS->>DB: Check: does abc-123 exist?
    DB-->>IS: No
    IS->>IS: Reserve stock ✅
    IS->>DB: INSERT abc-123
    IS->>K: inventory.reserved.v1

    Note over K: Kafka redelivers (duplicate)
    K->>IS: order.created.v1 (event_id: abc-123)
    IS->>DB: Check: does abc-123 exist?
    DB-->>IS: Yes (already processed!)
    IS->>IS: SKIP — no action taken
    Note over IS: Idempotency preserved ✅
```

---

## Compensation Summary

| Failure Point | What Was Done | Compensation Action |
|--------------|---------------|-------------------|
| Inventory fails | Nothing | None needed |
| Payment fails | Inventory reserved | Release inventory |
| Payment timeout | Inventory reserved | Release inventory |
| Notification fails | Order confirmed | Retry (no compensation) |

---

## Key Implementation Details

### 1. Atomic State Transitions
Every saga state change happens in the same DB transaction as the outbox event write:
```
BEGIN TRANSACTION
  UPDATE saga_state SET current_step = 'PAYMENT_PENDING'
  INSERT INTO outbox_events (payment.process_requested.v1)
COMMIT
```

### 2. Timeout Detection
A background job runs every 10 seconds, querying:
```sql
SELECT * FROM saga_state 
WHERE current_step = 'PAYMENT_PENDING' 
AND timeout_at < NOW()
AND status = 'ACTIVE'
```

### 3. Outbox Worker
Polls every 1 second:
```sql
SELECT * FROM outbox_events 
WHERE status = 'PENDING' 
ORDER BY created_at 
LIMIT 10
```
Publishes to Kafka, then marks as `SENT`.

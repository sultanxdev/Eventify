# Eventify — API Reference

## Base URL

All requests go through the API Gateway:
```
http://localhost:3000
```

---

## Authentication

### POST `/auth/signup`

Register a new user.

**Request:**
```json
{
  "email": "sultan@example.com",
  "password": "securePassword123",
  "name": "Sultan Alam"
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "sultan@example.com",
  "name": "Sultan Alam",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Missing required fields |
| 409 | Email already exists |

---

### POST `/auth/login`

Authenticate and receive JWT.

**Request:**
```json
{
  "email": "sultan@example.com",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "sultan@example.com",
  "name": "Sultan Alam",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Missing required fields |
| 401 | Invalid credentials |

---

## Orders

> All order endpoints require JWT authentication via `Authorization: Bearer <token>` header.

### POST `/orders`

Create a new order. Triggers the Saga workflow.

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
Idempotency-Key: <unique-key>       # Optional but recommended
X-Correlation-ID: <correlation-id>  # Auto-generated if missing
```

**Request:**
```json
{
  "items": [
    {
      "productId": "prod-001",
      "quantity": 2
    },
    {
      "productId": "prod-002",
      "quantity": 1
    }
  ]
}
```

**Response (201):**
```json
{
  "id": "order-550e8400-e29b-41d4",
  "userId": "user-550e8400-e29b-41d4",
  "items": [
    { "productId": "prod-001", "quantity": 2 },
    { "productId": "prod-002", "quantity": 1 }
  ],
  "totalAmount": "59.97",
  "status": "PENDING",
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Missing or invalid items |
| 401 | Missing or invalid JWT |
| 409 | Idempotency key already used (returns original response) |

**Idempotency Behavior:**
If the same `Idempotency-Key` is sent twice, the second request returns the original response without creating a new order.

---

### GET `/orders/:id`

Get order details and current saga status.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "id": "order-550e8400-e29b-41d4",
  "userId": "user-550e8400-e29b-41d4",
  "items": [
    { "productId": "prod-001", "quantity": 2 },
    { "productId": "prod-002", "quantity": 1 }
  ],
  "totalAmount": "59.97",
  "status": "CONFIRMED",
  "sagaState": {
    "currentStep": "CONFIRMED",
    "status": "COMPLETED",
    "startedAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:05.000Z"
  },
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:05.000Z"
}
```

**Errors:**
| Status | Reason |
|--------|--------|
| 401 | Missing or invalid JWT |
| 403 | Order belongs to different user |
| 404 | Order not found |

---

## Health Checks

### GET `/health`

API Gateway health (aggregated).

**Response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "services": {
    "api-gateway": "healthy",
    "auth-service": "healthy",
    "order-service": "healthy",
    "inventory-service": "healthy",
    "payment-service": "healthy",
    "notification-service": "healthy"
  }
}
```

---

## Internal Service Endpoints

> These are NOT exposed through the API Gateway. They are accessible only within the Docker network.

### Inventory Service (`:3003`)

#### POST `/seed`
Seed sample products for testing.

#### GET `/health`
Service health check.

### Payment Service (`:3004`)

#### GET `/health`
Service health check.

### Notification Service (`:3005`)

#### GET `/health`
Service health check.

---

## Event Topics (Kafka)

These are internal — not REST endpoints — but important for understanding the system:

| Topic | Producer | Consumer |
|-------|----------|----------|
| `order.created.v1` | Order Service | Inventory Service |
| `inventory.reserved.v1` | Inventory Service | Order Service |
| `inventory.failed.v1` | Inventory Service | Order Service |
| `inventory.release_requested.v1` | Order Service | Inventory Service |
| `inventory.released.v1` | Inventory Service | Order Service |
| `payment.process_requested.v1` | Order Service | Payment Service |
| `payment.succeeded.v1` | Payment Service | Order Service |
| `payment.failed.v1` | Payment Service | Order Service |
| `order.confirmed.v1` | Order Service | Notification Service |
| `order.failed.v1` | Order Service | Notification Service |
| `notification.send_requested.v1` | Order Service | Notification Service |
| `*.dlq` | Any Service | Manual review |

---

## Common Headers

| Header | Description | Required |
|--------|-------------|----------|
| `Authorization` | `Bearer <jwt_token>` | Yes (order endpoints) |
| `Content-Type` | `application/json` | Yes (POST requests) |
| `Idempotency-Key` | Unique key for idempotent requests | Recommended |
| `X-Correlation-ID` | Request tracing ID | Auto-generated |

---

## Error Format

All errors follow this format:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Items array is required and must not be empty",
  "correlationId": "corr-550e8400-e29b"
}
```

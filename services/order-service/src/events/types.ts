/**
 * Event type definitions for the Order Service.
 * These are versioned (v1) for schema evolution.
 * Each service maintains its own copy of event types it produces/consumes.
 */

// ============================================
// EVENTS PRODUCED BY ORDER SERVICE
// ============================================

export interface OrderCreatedV1 {
  eventId: string;
  eventType: 'order.created.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    userId: string;
    items: Array<{
      productId: string;
      quantity: number;
    }>;
    totalAmount: string;
  };
}

export interface PaymentProcessRequestedV1 {
  eventId: string;
  eventType: 'payment.process_requested.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    userId: string;
    totalAmount: string;
  };
}

export interface OrderConfirmedV1 {
  eventId: string;
  eventType: 'order.confirmed.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    userId: string;
    totalAmount: string;
  };
}

export interface OrderFailedV1 {
  eventId: string;
  eventType: 'order.failed.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    userId: string;
    reason: string;
  };
}

export interface InventoryReleaseRequestedV1 {
  eventId: string;
  eventType: 'inventory.release_requested.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
  };
}

export interface NotificationSendRequestedV1 {
  eventId: string;
  eventType: 'notification.send_requested.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    userId: string;
    type: 'ORDER_CONFIRMED' | 'ORDER_FAILED';
    message: string;
  };
}

// ============================================
// EVENTS CONSUMED BY ORDER SERVICE
// ============================================

export interface InventoryReservedV1 {
  eventId: string;
  eventType: 'inventory.reserved.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    reservedItems: Array<{
      productId: string;
      quantity: number;
    }>;
  };
}

export interface InventoryFailedV1 {
  eventId: string;
  eventType: 'inventory.failed.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    reason: string;
  };
}

export interface PaymentSucceededV1 {
  eventId: string;
  eventType: 'payment.succeeded.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    paymentId: string;
    amount: string;
  };
}

export interface PaymentFailedV1 {
  eventId: string;
  eventType: 'payment.failed.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    reason: string;
  };
}

export interface InventoryReleasedV1 {
  eventId: string;
  eventType: 'inventory.released.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
  };
}

// Union types
export type ProducedEvent =
  | OrderCreatedV1
  | PaymentProcessRequestedV1
  | OrderConfirmedV1
  | OrderFailedV1
  | InventoryReleaseRequestedV1
  | NotificationSendRequestedV1;

export type ConsumedEvent =
  | InventoryReservedV1
  | InventoryFailedV1
  | PaymentSucceededV1
  | PaymentFailedV1
  | InventoryReleasedV1;

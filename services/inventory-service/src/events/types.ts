/**
 * Event type definitions for the Inventory Service.
 * Each service maintains its own copy of event types it produces/consumes.
 */

// Events consumed
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

export interface InventoryReleaseRequestedV1 {
  eventId: string;
  eventType: 'inventory.release_requested.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
  };
}

// Events produced
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

export interface InventoryReleasedV1 {
  eventId: string;
  eventType: 'inventory.released.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
  };
}

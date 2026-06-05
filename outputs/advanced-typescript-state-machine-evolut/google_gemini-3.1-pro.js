// --- STATES ---
// Using `readonly` enforces immutability at the type level.

export type IdleState = { readonly status: 'Idle' };
export type CartValidatedState = { readonly status: 'CartValidated'; readonly cartId: string };
export type PaymentPendingState = { readonly status: 'PaymentPending'; readonly cartId: string; readonly paymentId: string };
export type InventoryReservedState = { readonly status: 'InventoryReserved'; readonly cartId: string; readonly paymentId: string; readonly reservationId: string };
export type CompletedState = { readonly status: 'Completed'; readonly cartId: string; readonly orderId: string };
export type RollbackState = { readonly status: 'Rollback'; readonly cartId: string; readonly reason: string };

export type CheckoutState =
  | IdleState
  | CartValidatedState
  | PaymentPendingState
  | InventoryReservedState
  | CompletedState
  | RollbackState;

// --- ACTIONS ---

export type ValidateCartAction = { readonly type: 'VALIDATE_CART'; readonly payload: { cartId: string } };
export type InitiatePaymentAction = { readonly type: 'INITIATE_PAYMENT'; readonly payload: { paymentId: string } };
export type ReserveInventoryAction = { readonly type: 'RESERVE_INVENTORY'; readonly payload: { reservationId: string } };
export type CompleteCheckoutAction = { readonly type: 'COMPLETE_CHECKOUT'; readonly payload: { orderId: string } };
export type CancelAction = { readonly type: 'CANCEL'; readonly payload: { reason: string } };
export type FinishRollbackAction = { readonly type: 'FINISH_ROLLBACK' };

export type CheckoutAction =
  | ValidateCartAction
  | InitiatePaymentAction
  | ReserveInventoryAction
  | CompleteCheckoutAction
  | CancelAction
  | FinishRollbackAction;
// ----- Domain Types -----
export interface CartItem {
  readonly sku: string;
  readonly qty: number;
  readonly price: number;
}

export interface PaymentInfo {
  readonly method: 'card' | 'paypal' | 'crypto';
  readonly token: string;
}

export interface ReservationId {
  readonly id: string;
}

// ----- State Discriminated Union -----
export type CheckoutState =
  | { readonly status: 'Idle' }
  | { readonly status: 'CartValidated'; readonly cart: readonly CartItem[] }
  | { readonly status: 'PaymentPending'; readonly cart: readonly CartItem[]; readonly payment: PaymentInfo }
  | { readonly status: 'InventoryReserved'; readonly cart: readonly CartItem[]; readonly payment: PaymentInfo; readonly reservation: ReservationId }
  | { readonly status: 'Completed'; readonly orderId: string }
  | { readonly status: 'Rollback'; readonly reservation?: ReservationId; readonly reason: string };

export type Status = CheckoutState['status'];

// ----- Action Discriminated Union -----
export type CheckoutAction =
  | { readonly type: 'VALIDATE_CART'; readonly cart: readonly CartItem[] }
  | { readonly type: 'SUBMIT_PAYMENT'; readonly payment: PaymentInfo }
  | { readonly type: 'RESERVE_INVENTORY'; readonly reservation: ReservationId }
  | { readonly type: 'COMPLETE'; readonly orderId: string }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'ROLLBACK_DONE' };
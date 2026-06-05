To implement a strictly typed, purely functional state machine in TypeScript, we must use **Discriminated Unions** combined with **Conditional Types**. 

By defining a generic reducer signature, we can map exactly which actions are allowed for each specific state. If you attempt to dispatch an invalid action (e.g., `COMPLETE_CHECKOUT` while in the `Idle` state), TypeScript will throw a compile-time error.

Furthermore, because Redux reducers must be **purely functional and synchronous**, they cannot perform asynchronous side effects directly. The asynchronous reverse-inventory sweep must be handled outside the reducer (e.g., via a Thunk, Saga, or an async service function) which orchestrates the `CANCEL` and `FINISH_ROLLBACK` actions.

Here is the complete, production-ready TypeScript implementation:

### 1. State and Action Definitions

```typescript
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
```

### 2. Strict Transition Typings

Here we define the conditional types that enforce our state machine rules at compile time.

```typescript
// Maps a given State to its strictly allowed Action(s)
export type ValidAction<S extends CheckoutState> = 
  S extends IdleState ? ValidateCartAction :
  S extends CartValidatedState ? InitiatePaymentAction :
  S extends PaymentPendingState ? ReserveInventoryAction | CancelAction :
  S extends InventoryReservedState ? CompleteCheckoutAction :
  S extends RollbackState ? FinishRollbackAction :
  never; // CompletedState has no valid outgoing actions

// Maps a given State + Action pair to the exact Next State
export type NextState<S extends CheckoutState, A extends ValidAction<S>> = 
  S extends IdleState ? (A extends ValidateCartAction ? CartValidatedState : never) :
  S extends CartValidatedState ? (A extends InitiatePaymentAction ? PaymentPendingState : never) :
  S extends PaymentPendingState ? (A extends ReserveInventoryAction ? InventoryReservedState : A extends CancelAction ? RollbackState : never) :
  S extends InventoryReservedState ? (A extends CompleteCheckoutAction ? CompletedState : never) :
  S extends RollbackState ? (A extends FinishRollbackAction ? IdleState : never) :
  never;
```

### 3. The Purely Functional Reducer

```typescript
/**
 * The Reducer strictly enforces transitions. 
 * Note: Inside the function, TypeScript cannot fully resolve generic conditional 
 * types against control flow, so we use type assertions (`as NextState<S, A>`). 
 * However, the external API is 100% type-safe for the caller.
 */
export function checkoutReducer<S extends CheckoutState, A extends ValidAction<S>>(
  state: S,
  action: A
): NextState<S, A> {
  switch (state.status) {
    case 'Idle':
      return {
        status: 'CartValidated',
        cartId: (action as ValidateCartAction).payload.cartId
      } as NextState<S, A>;

    case 'CartValidated':
      return {
        status: 'PaymentPending',
        cartId: state.cartId,
        paymentId: (action as InitiatePaymentAction).payload.paymentId
      } as NextState<S, A>;

    case 'PaymentPending':
      if (action.type === 'RESERVE_INVENTORY') {
        return {
          status: 'InventoryReserved',
          cartId: state.cartId,
          paymentId: state.paymentId,
          reservationId: (action as ReserveInventoryAction).payload.reservationId
        } as NextState<S, A>;
      } else if (action.type === 'CANCEL') {
        return {
          status: 'Rollback',
          cartId: state.cartId,
          reason: (action as CancelAction).payload.reason
        } as NextState<S, A>;
      }
      break;

    case 'InventoryReserved':
      return {
        status: 'Completed',
        cartId: state.cartId,
        orderId: (action as CompleteCheckoutAction).payload.orderId
      } as NextState<S, A>;

    case 'Rollback':
      return {
        status: 'Idle'
      } as NextState<S, A>;
  }

  throw new Error(`Invalid transition from ${state.status} with action ${(action as CheckoutAction).type}`);
}
```

### 4. Handling the Asynchronous Rollback (Side Effect)

Because the reducer is purely functional, the asynchronous reverse-inventory sweep is orchestrated by a Thunk/Service.

```typescript
// Mock API call
async function apiReverseInventorySweep(cartId: string): Promise<void> {
  console.log(`Sweeping inventory for cart ${cartId}...`);
  return new Promise(resolve => setTimeout(resolve, 1000));
}

/**
 * Orchestrates the cancellation, the async sweep, and the return to Idle.
 */
export async function handleCancelAndRollback(
  currentState: PaymentPendingState,
  reason: string,
  dispatch: <S extends CheckoutState, A extends ValidAction<S>>(state: S, action: A) => NextState<S, A>
) {
  // 1. Transition to Rollback
  const rollbackState = dispatch(currentState, { 
    type: 'CANCEL', 
    payload: { reason } 
  });

  // 2. Perform the asynchronous side-effect
  try {
    await apiReverseInventorySweep(rollbackState.cartId);
  } catch (error) {
    console.error("Failed to reverse inventory", error);
    // Handle retry logic or alerting here
  }

  // 3. Transition back to Idle
  const idleState = dispatch(rollbackState, { type: 'FINISH_ROLLBACK' });
  
  return idleState;
}
```

### 5. Proof of Compile-Time Constraints

If you try to use this reducer in your code, TypeScript will actively prevent invalid workflows:

```typescript
const state1: IdleState = { status: 'Idle' };

// ✅ VALID: Idle -> CartValidated
const state2 = checkoutReducer(state1, { 
  type: 'VALIDATE_CART', 
  payload: { cartId: 'cart_123' } 
}); 
// TS knows `state2` is exactly `CartValidatedState`

// ❌ COMPILE ERROR: Cannot complete checkout from CartValidated
const invalidState = checkoutReducer(state2, { 
  type: 'COMPLETE_CHECKOUT', 
  payload: { orderId: 'ord_999' } 
});
// ^^^ ERROR: Argument of type '{ type: "COMPLETE_CHECKOUT"; payload: { orderId: string; }; }' 
// is not assignable to parameter of type 'InitiatePaymentAction'.

// ✅ VALID: CartValidated -> PaymentPending
const state3 = checkoutReducer(state2, { 
  type: 'INITIATE_PAYMENT', 
  payload: { paymentId: 'pay_456' } 
});

// ✅ VALID: PaymentPending -> Rollback
const state4 = checkoutReducer(state3, { 
  type: 'CANCEL', 
  payload: { reason: 'User aborted' } 
});
```
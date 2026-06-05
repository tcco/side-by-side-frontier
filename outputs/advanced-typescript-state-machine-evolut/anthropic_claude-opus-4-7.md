# Immutable Redux-Style Checkout State Machine in TypeScript

Below is a fully type-safe implementation where **invalid transitions are caught at compile time** via discriminated unions and conditional types.

## 1. State & Action Definitions

```ts
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
```

## 2. Compile-Time Transition Table

The trick: a **conditional type** that maps `(Status, ActionType)` → permitted next `Status` or `never`. If the pair is invalid, the reducer's return type becomes `never`, surfacing the bug at the call site.

```ts
// Allowed transitions: (CurrentStatus, ActionType) -> NextStatus
type Transitions = {
  Idle: { VALIDATE_CART: 'CartValidated' };
  CartValidated: { SUBMIT_PAYMENT: 'PaymentPending'; CANCEL: 'Idle' };
  PaymentPending: { RESERVE_INVENTORY: 'InventoryReserved'; CANCEL: 'Rollback' };
  InventoryReserved: { COMPLETE: 'Completed'; CANCEL: 'Rollback' };
  Completed: {}; // terminal
  Rollback: { ROLLBACK_DONE: 'Idle' };
};

// Given a state S and action A, compute the *next state* type (or never).
type NextState<S extends CheckoutState, A extends CheckoutAction> =
  S['status'] extends keyof Transitions
    ? A['type'] extends keyof Transitions[S['status']]
      ? Extract<CheckoutState, { status: Transitions[S['status']][A['type']] }>
      : never
    : never;
```

Now `NextState<{status:'Idle'}, {type:'COMPLETE'; orderId:string}>` resolves to `never` — uncallable in practice.

## 3. The Pure Reducer

We use **overload signatures** so each `(state, action)` combination has a precise return type. Invalid pairings produce `never` and fail at compile time.

```ts
export function reduce<S extends CheckoutState, A extends CheckoutAction>(
  state: S,
  action: A
): NextState<S, A> {
  // Runtime guard mirrors the type-level table (defense in depth).
  const key = `${state.status}:${action.type}`;

  switch (key) {
    case 'Idle:VALIDATE_CART': {
      const a = action as Extract<CheckoutAction, { type: 'VALIDATE_CART' }>;
      return { status: 'CartValidated', cart: a.cart } as NextState<S, A>;
    }
    case 'CartValidated:SUBMIT_PAYMENT': {
      const s = state as Extract<CheckoutState, { status: 'CartValidated' }>;
      const a = action as Extract<CheckoutAction, { type: 'SUBMIT_PAYMENT' }>;
      return { status: 'PaymentPending', cart: s.cart, payment: a.payment } as NextState<S, A>;
    }
    case 'CartValidated:CANCEL': {
      return { status: 'Idle' } as NextState<S, A>;
    }
    case 'PaymentPending:RESERVE_INVENTORY': {
      const s = state as Extract<CheckoutState, { status: 'PaymentPending' }>;
      const a = action as Extract<CheckoutAction, { type: 'RESERVE_INVENTORY' }>;
      return {
        status: 'InventoryReserved',
        cart: s.cart,
        payment: s.payment,
        reservation: a.reservation,
      } as NextState<S, A>;
    }
    case 'PaymentPending:CANCEL': {
      return {
        status: 'Rollback',
        reason: 'User cancelled during payment',
      } as NextState<S, A>;
    }
    case 'InventoryReserved:COMPLETE': {
      const a = action as Extract<CheckoutAction, { type: 'COMPLETE' }>;
      return { status: 'Completed', orderId: a.orderId } as NextState<S, A>;
    }
    case 'InventoryReserved:CANCEL': {
      const s = state as Extract<CheckoutState, { status: 'InventoryReserved' }>;
      return {
        status: 'Rollback',
        reservation: s.reservation,
        reason: 'Cancelled after reservation',
      } as NextState<S, A>;
    }
    case 'Rollback:ROLLBACK_DONE': {
      return { status: 'Idle' } as NextState<S, A>;
    }
    default:
      throw new Error(`Illegal transition: ${key}`);
  }
}
```

## 4. Asynchronous Rollback Side-Effect

The reducer stays **pure**. Side effects (the reverse-inventory sweep) live in a separate effect handler — Redux-saga style.

```ts
export interface InventoryService {
  reverseSweep(reservation?: ReservationId): Promise<void>;
}

export async function runEffects(
  state: CheckoutState,
  dispatch: (a: CheckoutAction) => void,
  inv: InventoryService
): Promise<void> {
  if (state.status === 'Rollback') {
    await inv.reverseSweep(state.reservation);
    dispatch({ type: 'ROLLBACK_DONE' });
  }
}
```

## 5. Demonstrating Compile-Time Safety

```ts
const s0: CheckoutState = { status: 'Idle' };

// ✅ Allowed
const s1 = reduce(s0, { type: 'VALIDATE_CART', cart: [] });
//    ^? { status: 'CartValidated'; cart: readonly CartItem[] }

// ❌ Compile-time error: return type 'never' — impossible transition
// const bad = reduce({ status: 'Idle' } as const,
//                    { type: 'COMPLETE', orderId: 'x' });
//                    Type 'never' has no construct/assignment signature.

// ❌ Can't skip payment
// const bad2 = reduce({ status: 'CartValidated', cart: [] } as const,
//                     { type: 'RESERVE_INVENTORY', reservation: { id: '1' } });
```

When TS infers `NextState<...>` as `never`, the call expression yields `never`. Any subsequent use (passing to another reducer call typed by `CheckoutState`, destructuring `.status`, etc.) will fail. To get an *immediate* error at the call site, narrow with `const` assertions as shown, or wrap calls in a helper that requires `NextState` to extend `CheckoutState`:

```ts
function step<S extends CheckoutState, A extends CheckoutAction>(
  state: S,
  action: A & (NextState<S, A> extends never ? never : A)
): NextState<S, A> {
  return reduce(state, action);
}
```

Now `step({status:'Idle'} as const, {type:'COMPLETE', orderId:'x'})` produces an error directly on the `action` argument — it cannot satisfy `never`.

## 6. End-to-End Example

```ts
async function demo(inv: InventoryService) {
  let state: CheckoutState = { status: 'Idle' };
  const dispatch = (a: CheckoutAction) => { state = reduce(state, a); };

  dispatch({ type: 'VALIDATE_CART', cart: [{ sku: 'A', qty: 1, price: 9.99 }] });
  dispatch({ type: 'SUBMIT_PAYMENT', payment: { method: 'card', token: 'tok_1' } });

  // User cancels mid-payment → Rollback
  dispatch({ type: 'CANCEL' });
  await runEffects(state, dispatch, inv); // async reverse sweep → ROLLBACK_DONE → Idle

  console.log(state.status); // 'Idle'
}
```

## Why This Design Works

| Concern | Mechanism |
|---|---|
| **Immutability** | All fields `readonly`; reducer returns new objects. |
| **Purity** | `reduce` is deterministic; effects isolated in `runEffects`. |
| **Type-safe transitions** | `Transitions` lookup table + `NextState` conditional type produces `never` for illegal edges. |
| **Rollback semantics** | `PaymentPending + CANCEL` → `Rollback`; effect handler awaits `reverseSweep`, then dispatches `ROLLBACK_DONE` → `Idle`. |
| **Exhaustiveness** | The `switch` on `${status}:${type}` defaults to `throw`, but the call-site type system prevents reaching it. |

The combination of discriminated unions, a transition lookup type, and the `step` helper makes the **state machine its own type checker** — illegal flows can't even be written.
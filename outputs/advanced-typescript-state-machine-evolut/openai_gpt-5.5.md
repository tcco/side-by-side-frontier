Below is a strictly typed, immutable, purely functional Redux-like checkout reducer.

Key points:

- The reducer never mutates state.
- Side effects are not executed inside the reducer.
- The reducer returns `{ state, commands }`, where commands are interpreted asynchronously outside the reducer.
- Invalid transitions are rejected at compile time when the current state is statically known.
- `CANCEL` is only legal during `PaymentPending`.
- `CANCEL` transitions to `Rollback`, emits a `REVERSE_INVENTORY_SWEEP` command, and only after `ROLLBACK_SWEEP_SUCCEEDED` can the workflow return to `Idle`.

```ts
/* checkout.ts */

/**
 * Recommended tsconfig:
 *
 * {
 *   "compilerOptions": {
 *     "strict": true,
 *     "exactOptionalPropertyTypes": true
 *   }
 * }
 */

// -----------------------------
// Domain types
// -----------------------------

export type Money = {
  readonly currency: string;
  readonly cents: number;
};

export type CartItem = {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: Money;
};

export type Cart = {
  readonly id: string;
  readonly items: readonly CartItem[];
};

export type CartValidation = {
  readonly validatedAtIso: string;
  readonly total: Money;
};

// -----------------------------
// State machine states
// -----------------------------

export type IdleState = {
  readonly tag: "Idle";
  readonly cart: Cart;
};

export type CartValidatedState = {
  readonly tag: "CartValidated";
  readonly cart: Cart;
  readonly validation: CartValidation;
};

export type PaymentPendingState = {
  readonly tag: "PaymentPending";
  readonly cart: Cart;
  readonly validation: CartValidation;
  readonly paymentIntentId: string;
  readonly amount: Money;

  /**
   * These are provisional inventory holds created before payment completion.
   * If payment is cancelled, these must be swept/released asynchronously.
   */
  readonly provisionalInventoryHoldIds: readonly string[];
};

export type InventoryReservedState = {
  readonly tag: "InventoryReserved";
  readonly cart: Cart;
  readonly validation: CartValidation;
  readonly paymentIntentId: string;
  readonly paymentAuthorizationId: string;
  readonly amount: Money;
  readonly inventoryReservationIds: readonly string[];
};

export type CompletedState = {
  readonly tag: "Completed";
  readonly cart: Cart;
  readonly orderId: string;
  readonly paymentIntentId: string;
  readonly paymentAuthorizationId: string;
  readonly inventoryReservationIds: readonly string[];
  readonly completedAtIso: string;
};

export type RollbackState = {
  readonly tag: "Rollback";
  readonly cart: Cart;
  readonly paymentIntentId: string;
  readonly provisionalInventoryHoldIds: readonly string[];
  readonly sweepId: string;
  readonly reason: "PAYMENT_CANCELLED";
  readonly lastError: string | undefined;
};

export type CheckoutState =
  | IdleState
  | CartValidatedState
  | PaymentPendingState
  | InventoryReservedState
  | CompletedState
  | RollbackState;

// -----------------------------
// Actions
// -----------------------------

export type CartValidatedAction = {
  readonly type: "CART_VALIDATED";
  readonly validation: CartValidation;
};

export type PaymentStartedAction = {
  readonly type: "PAYMENT_STARTED";
  readonly paymentIntentId: string;
  readonly amount: Money;
  readonly provisionalInventoryHoldIds: readonly string[];
};

export type InventoryReservedAction = {
  readonly type: "INVENTORY_RESERVED";
  readonly paymentAuthorizationId: string;
  readonly inventoryReservationIds: readonly string[];
};

export type CompleteOrderAction = {
  readonly type: "COMPLETE_ORDER";
  readonly orderId: string;
  readonly completedAtIso: string;
};

export type CancelAction = {
  readonly type: "CANCEL";

  /**
   * The reducer stays pure by not generating IDs itself.
   * The caller/effect layer provides this deterministic sweep ID.
   */
  readonly sweepId: string;
};

export type RollbackSweepSucceededAction = {
  readonly type: "ROLLBACK_SWEEP_SUCCEEDED";
  readonly sweepId: string;
};

export type RollbackSweepFailedAction = {
  readonly type: "ROLLBACK_SWEEP_FAILED";
  readonly sweepId: string;
  readonly message: string;
};

export type RetryRollbackSweepAction = {
  readonly type: "RETRY_ROLLBACK_SWEEP";
};

// -----------------------------
// Commands / effects
// -----------------------------

export type ReverseInventorySweepCommand = {
  readonly type: "REVERSE_INVENTORY_SWEEP";
  readonly sweepId: string;
  readonly cartId: string;
  readonly provisionalInventoryHoldIds: readonly string[];
  readonly reason: "PAYMENT_CANCELLED";
};

export type Command = ReverseInventorySweepCommand;

export type ReducerOutput<
  S extends CheckoutState,
  C extends readonly Command[] = readonly Command[],
> = {
  readonly state: S;
  readonly commands: C;
};

type NoCommands<S extends CheckoutState> = ReducerOutput<S, readonly []>;

type WithCommands<
  S extends CheckoutState,
  C extends readonly Command[],
> = ReducerOutput<S, C>;

// -----------------------------
// Transition table
// -----------------------------

/**
 * This is the core compile-time state machine.
 *
 * Each entry says:
 *
 * from state X, action Y is allowed, and produces result Z.
 *
 * If a pair is absent, TypeScript rejects it.
 */
export type CheckoutTransition =
  | {
      readonly from: "Idle";
      readonly type: "CART_VALIDATED";
      readonly action: CartValidatedAction;
      readonly result: NoCommands<CartValidatedState>;
    }
  | {
      readonly from: "CartValidated";
      readonly type: "PAYMENT_STARTED";
      readonly action: PaymentStartedAction;
      readonly result: NoCommands<PaymentPendingState>;
    }
  | {
      readonly from: "PaymentPending";
      readonly type: "INVENTORY_RESERVED";
      readonly action: InventoryReservedAction;
      readonly result: NoCommands<InventoryReservedState>;
    }
  | {
      readonly from: "PaymentPending";
      readonly type: "CANCEL";
      readonly action: CancelAction;
      readonly result: WithCommands<
        RollbackState,
        readonly [ReverseInventorySweepCommand]
      >;
    }
  | {
      readonly from: "InventoryReserved";
      readonly type: "COMPLETE_ORDER";
      readonly action: CompleteOrderAction;
      readonly result: NoCommands<CompletedState>;
    }
  | {
      readonly from: "Rollback";
      readonly type: "ROLLBACK_SWEEP_SUCCEEDED";
      readonly action: RollbackSweepSucceededAction;
      readonly result: NoCommands<IdleState>;
    }
  | {
      readonly from: "Rollback";
      readonly type: "ROLLBACK_SWEEP_FAILED";
      readonly action: RollbackSweepFailedAction;
      readonly result: NoCommands<RollbackState>;
    }
  | {
      readonly from: "Rollback";
      readonly type: "RETRY_ROLLBACK_SWEEP";
      readonly action: RetryRollbackSweepAction;
      readonly result: WithCommands<
        RollbackState,
        readonly [ReverseInventorySweepCommand]
      >;
    };

/**
 * Legal actions for a particular state.
 *
 * Examples:
 *
 * AllowedAction<IdleState> is CartValidatedAction.
 * AllowedAction<PaymentPendingState> is InventoryReservedAction | CancelAction.
 * AllowedAction<CompletedState> is never.
 */
export type AllowedAction<S extends CheckoutState> = Extract<
  CheckoutTransition,
  { readonly from: S["tag"] }
>["action"];

export type OutputFor<
  S extends CheckoutState,
  A extends AllowedAction<S>,
> = Extract<
  CheckoutTransition,
  {
    readonly from: S["tag"];
    readonly type: A["type"];
  }
>["result"];

export type NextState<
  S extends CheckoutState,
  A extends AllowedAction<S>,
> = OutputFor<S, A>["state"];

type AnyCheckoutAction = CheckoutTransition["action"];

// -----------------------------
// Pure reducer
// -----------------------------

export function checkoutReducer<
  S extends CheckoutState,
  A extends AllowedAction<S>,
>(state: S, action: A): OutputFor<S, A> {
  return reduceUnchecked(state, action) as OutputFor<S, A>;
}

function reduceUnchecked(
  state: CheckoutState,
  action: AnyCheckoutAction,
): ReducerOutput<CheckoutState> {
  switch (state.tag) {
    case "Idle": {
      if (action.type === "CART_VALIDATED") {
        return {
          state: {
            tag: "CartValidated",
            cart: state.cart,
            validation: action.validation,
          },
          commands: [],
        };
      }

      return invalidTransition(state, action);
    }

    case "CartValidated": {
      if (action.type === "PAYMENT_STARTED") {
        return {
          state: {
            tag: "PaymentPending",
            cart: state.cart,
            validation: state.validation,
            paymentIntentId: action.paymentIntentId,
            amount: action.amount,
            provisionalInventoryHoldIds: action.provisionalInventoryHoldIds,
          },
          commands: [],
        };
      }

      return invalidTransition(state, action);
    }

    case "PaymentPending": {
      if (action.type === "INVENTORY_RESERVED") {
        return {
          state: {
            tag: "InventoryReserved",
            cart: state.cart,
            validation: state.validation,
            paymentIntentId: state.paymentIntentId,
            paymentAuthorizationId: action.paymentAuthorizationId,
            amount: state.amount,
            inventoryReservationIds: action.inventoryReservationIds,
          },
          commands: [],
        };
      }

      if (action.type === "CANCEL") {
        const rollbackState: RollbackState = {
          tag: "Rollback",
          cart: state.cart,
          paymentIntentId: state.paymentIntentId,
          provisionalInventoryHoldIds: state.provisionalInventoryHoldIds,
          sweepId: action.sweepId,
          reason: "PAYMENT_CANCELLED",
          lastError: undefined,
        };

        return {
          state: rollbackState,
          commands: [reverseInventorySweepCommand(rollbackState)] as const,
        };
      }

      return invalidTransition(state, action);
    }

    case "InventoryReserved": {
      if (action.type === "COMPLETE_ORDER") {
        return {
          state: {
            tag: "Completed",
            cart: state.cart,
            orderId: action.orderId,
            paymentIntentId: state.paymentIntentId,
            paymentAuthorizationId: state.paymentAuthorizationId,
            inventoryReservationIds: state.inventoryReservationIds,
            completedAtIso: action.completedAtIso,
          },
          commands: [],
        };
      }

      return invalidTransition(state, action);
    }

    case "Rollback": {
      if (action.type === "ROLLBACK_SWEEP_SUCCEEDED") {
        assertSameSweep(state, action.sweepId);

        return {
          state: {
            tag: "Idle",
            cart: state.cart,
          },
          commands: [],
        };
      }

      if (action.type === "ROLLBACK_SWEEP_FAILED") {
        assertSameSweep(state, action.sweepId);

        return {
          state: {
            ...state,
            lastError: action.message,
          },
          commands: [],
        };
      }

      if (action.type === "RETRY_ROLLBACK_SWEEP") {
        const retryState: RollbackState = {
          ...state,
          lastError: undefined,
        };

        return {
          state: retryState,
          commands: [reverseInventorySweepCommand(retryState)] as const,
        };
      }

      return invalidTransition(state, action);
    }

    case "Completed": {
      return invalidTransition(state, action);
    }

    default: {
      return assertNever(state);
    }
  }
}

function reverseInventorySweepCommand(
  state: Pick<
    RollbackState,
    "sweepId" | "cart" | "provisionalInventoryHoldIds" | "reason"
  >,
): ReverseInventorySweepCommand {
  return {
    type: "REVERSE_INVENTORY_SWEEP",
    sweepId: state.sweepId,
    cartId: state.cart.id,
    provisionalInventoryHoldIds: state.provisionalInventoryHoldIds,
    reason: state.reason,
  };
}

function assertSameSweep(state: RollbackState, sweepId: string): void {
  if (state.sweepId !== sweepId) {
    throw new Error(
      `Rollback sweep mismatch. Expected ${state.sweepId}, received ${sweepId}.`,
    );
  }
}

function invalidTransition(
  state: CheckoutState,
  action: AnyCheckoutAction,
): never {
  throw new Error(`Invalid transition: ${state.tag} + ${action.type}`);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

// -----------------------------
// Async command runner
// -----------------------------

export type EffectDependencies = {
  readonly reverseInventorySweep: (input: {
    readonly sweepId: string;
    readonly cartId: string;
    readonly provisionalInventoryHoldIds: readonly string[];
    readonly reason: "PAYMENT_CANCELLED";
  }) => Promise<void>;

  /**
   * In a real Redux app this would be store.dispatch.
   * These are the only events the inventory sweep is allowed to emit.
   */
  readonly dispatch: (
    action: RollbackSweepSucceededAction | RollbackSweepFailedAction,
  ) => void;
};

export async function runCommand(
  command: Command,
  deps: EffectDependencies,
): Promise<void> {
  switch (command.type) {
    case "REVERSE_INVENTORY_SWEEP": {
      try {
        await deps.reverseInventorySweep({
          sweepId: command.sweepId,
          cartId: command.cartId,
          provisionalInventoryHoldIds: command.provisionalInventoryHoldIds,
          reason: command.reason,
        });

        deps.dispatch({
          type: "ROLLBACK_SWEEP_SUCCEEDED",
          sweepId: command.sweepId,
        });
      } catch (error) {
        deps.dispatch({
          type: "ROLLBACK_SWEEP_FAILED",
          sweepId: command.sweepId,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return;
    }

    default: {
      assertNever(command);
    }
  }
}

// -----------------------------
// Example usage
// -----------------------------

const cart: Cart = {
  id: "cart_1",
  items: [
    {
      sku: "sku_1",
      quantity: 2,
      unitPrice: {
        currency: "USD",
        cents: 2500,
      },
    },
  ],
};

const idle: IdleState = {
  tag: "Idle",
  cart,
};

const validated = checkoutReducer(idle, {
  type: "CART_VALIDATED",
  validation: {
    validatedAtIso: "2026-01-01T00:00:00.000Z",
    total: {
      currency: "USD",
      cents: 5000,
    },
  },
});

const paymentPending = checkoutReducer(validated.state, {
  type: "PAYMENT_STARTED",
  paymentIntentId: "pi_123",
  amount: {
    currency: "USD",
    cents: 5000,
  },
  provisionalInventoryHoldIds: ["hold_1", "hold_2"],
});

const cancelled = checkoutReducer(paymentPending.state, {
  type: "CANCEL",
  sweepId: "sweep_1",
});

// cancelled.state is RollbackState.
// cancelled.commands is readonly [ReverseInventorySweepCommand].

const backToIdle = checkoutReducer(cancelled.state, {
  type: "ROLLBACK_SWEEP_SUCCEEDED",
  sweepId: "sweep_1",
});

// backToIdle.state is IdleState.

// -----------------------------
// Compile-time transition errors
// -----------------------------

// @ts-expect-error Cannot complete directly from Idle.
checkoutReducer(idle, {
  type: "COMPLETE_ORDER",
  orderId: "order_1",
  completedAtIso: "2026-01-01T00:00:00.000Z",
});

// @ts-expect-error CANCEL is only legal from PaymentPending.
checkoutReducer(idle, {
  type: "CANCEL",
  sweepId: "sweep_bad",
});

const inventoryReserved = checkoutReducer(paymentPending.state, {
  type: "INVENTORY_RESERVED",
  paymentAuthorizationId: "pa_123",
  inventoryReservationIds: ["res_1", "res_2"],
});

const completed = checkoutReducer(inventoryReserved.state, {
  type: "COMPLETE_ORDER",
  orderId: "order_123",
  completedAtIso: "2026-01-01T00:00:00.000Z",
});

// @ts-expect-error Completed is terminal; it has no outgoing actions.
checkoutReducer(completed.state, {
  type: "CANCEL",
  sweepId: "sweep_bad",
});
```

Important caveat: the compile-time guarantees work when the current state is statically known, for example `IdleState`, `PaymentPendingState`, etc. If you erase the state to the broad union type `CheckoutState`, TypeScript can only know that some checkout action may be valid. In that case, narrow first with `state.tag` or keep the typestate flowing through the reducer as shown above.
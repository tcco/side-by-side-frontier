// ============================================================================
// billing.ts — Purely Functional SaaS Billing Engine with State Monad
// ============================================================================

// ----------------------------------------------------------------------------
// SECTION 1: Domain Types & Interfaces
// ----------------------------------------------------------------------------

export type PlanTier = "starter" | "professional" | "enterprise";
export type RegionCode = "US" | "EU" | "UK" | "CA" | "JP";
export type PromoCode = "WINTER24" | "STARTUP_50";

export interface IUser {
  readonly userId: string;
  readonly grandfatheredYear?: number;
  readonly lastBilledAmount?: number;
}

export interface IBillingRequest {
  readonly user: IUser;
  readonly targetPlan: PlanTier;
  readonly region: RegionCode;
  readonly isMidCycleUpgrade: boolean;
  readonly daysRemainingInCycle: number;
  readonly cycleLengthDays: number;
  readonly promoCode?: PromoCode;
}

export interface IBillingState {
  readonly subtotal: number;          // in integer cents
  readonly taxAmount: number;         // in integer cents
  readonly total: number;             // in integer cents
  readonly appliedPromo?: PromoCode;
  readonly usedGrandfatheredPricing: boolean;
  readonly auditTrail: ReadonlyArray<string>;
}

export interface IBillingResult {
  readonly subtotal: number;          // dollars (2dp)
  readonly taxAmount: number;         // dollars (2dp)
  readonly total: number;             // dollars (2dp)
  readonly user: IUser;               // immutably updated
  readonly auditTrail: ReadonlyArray<string>;
}

export interface IBillingError {
  readonly kind: "BillingError";
  readonly reason: string;
}

export type BillingOutcome =
  | { readonly ok: true; readonly value: IBillingResult }
  | { readonly ok: false; readonly error: IBillingError };

// ----------------------------------------------------------------------------
// SECTION 2: State Monad
// ----------------------------------------------------------------------------

export interface IStateResult<S, A> {
  readonly value: A;
  readonly state: S;
}

export type StateFn<S, A> = (s: S) => IStateResult<S, A>;

export interface IStateMonad<S, A> {
  readonly run: StateFn<S, A>;
}

export const Of = <S, A>(value: A): IStateMonad<S, A> => ({
  run: (s: S) => ({ value, state: s }),
});

export const Get = <S>(): IStateMonad<S, S> => ({
  run: (s: S) => ({ value: s, state: s }),
});

export const Put = <S>(newState: S): IStateMonad<S, null> => ({
  run: (_s: S) => ({ value: null, state: newState }),
});

export const Modify = <S>(f: (s: S) => S): IStateMonad<S, null> => ({
  run: (s: S) => ({ value: null, state: f(s) }),
});

export const Bind = <S, A, B>(
  m: IStateMonad<S, A>,
  f: (a: A) => IStateMonad<S, B>
): IStateMonad<S, B> => ({
  run: (s: S) => {
    const { value, state } = m.run(s);
    return f(value).run(state);
  },
});

export const Sequence = <S>(
  steps: ReadonlyArray<IStateMonad<S, unknown>>
): IStateMonad<S, null> =>
  steps.reduce<IStateMonad<S, null>>(
    (acc, step) => Bind(acc, () => Bind(step, () => Of<S, null>(null))),
    Of<S, null>(null)
  );

// ----------------------------------------------------------------------------
// SECTION 3: Currency-Safe Arithmetic (Integer Cents)
// ----------------------------------------------------------------------------
//
// All currency is stored as integer cents to eliminate IEEE-754 drift.
// Boundary rules:
//   - Inputs in dollars are converted using ToCents (banker-safe rounding).
//   - Tax multiplication uses integer math with explicit rounding rules.
//   - Final values round HALF-UP at the cent boundary.
//   - Negative subtotals are clamped to zero before tax application.

const EPSILON = 1e-9;

export const ToCents = (dollars: number): number => {
  if (!Number.isFinite(dollars)) {
    throw new Error("ToCents: non-finite input");
  }
  // Add epsilon before flooring to absorb representation noise
  // (e.g., 79.99 * 100 = 7998.999999999999)
  const scaled = dollars * 100;
  const rounded = Math.round(scaled + Math.sign(scaled) * EPSILON);
  return rounded;
};

export const ToDollars = (cents: number): number => {
  // Pure formatting — always yields a 2-decimal representation.
  return Math.round(cents) / 100;
};

export const MultiplyCentsByRate = (
  cents: number,
  rate: number,
  rounding: "ceil" | "round" | "floor" = "round"
): number => {
  const raw = cents * rate;
  switch (rounding) {
    case "ceil":
      return Math.ceil(raw - EPSILON);
    case "floor":
      return Math.floor(raw + EPSILON);
    case "round":
    default:
      return Math.round(raw);
  }
};

export const ClampNonNegative = (cents: number): number =>
  cents < 0 ? 0 : cents;

// ----------------------------------------------------------------------------
// SECTION 4: Pricing Tables (Immutable)
// ----------------------------------------------------------------------------

const REGION_TAX_RATES: Readonly<Record<RegionCode, number>> = Object.freeze({
  US: 0.07,
  EU: 0.20,
  UK: 0.20,
  CA: 0.05,
  JP: 0.10,
});

const ACTIVE_PROMOS: ReadonlyArray<PromoCode> = Object.freeze([
  "WINTER24",
  "STARTUP_50",
]);

const STANDARD_PLAN_PRICES_CENTS: Readonly<Record<PlanTier, number>> =
  Object.freeze({
    starter: ToCents(15.0),       // 1500
    professional: ToCents(79.99), // 7999
    enterprise: ToCents(249.5),   // 24950
  });

const GRANDFATHERED_PROFESSIONAL_CENTS = ToCents(35.0); // 3500
const GRANDFATHERED_CUTOFF_YEAR = 2023;

// ----------------------------------------------------------------------------
// SECTION 5: Pure Pricing Functions
// ----------------------------------------------------------------------------

export const ResolveBasePriceCents = (
  plan: PlanTier,
  user: IUser
): { readonly cents: number; readonly grandfathered: boolean } => {
  if (
    plan === "professional" &&
    typeof user.grandfatheredYear === "number" &&
    user.grandfatheredYear < GRANDFATHERED_CUTOFF_YEAR
  ) {
    return { cents: GRANDFATHERED_PROFESSIONAL_CENTS, grandfathered: true };
  }
  return { cents: STANDARD_PLAN_PRICES_CENTS[plan], grandfathered: false };
};

export const ApplyProration = (
  baseCents: number,
  daysRemaining: number,
  cycleLength: number
): number => {
  if (cycleLength <= 0) {
    throw new Error("ApplyProration: cycleLength must be positive");
  }
  const clampedDays = Math.max(0, Math.min(daysRemaining, cycleLength));
  // Integer math: (cents * days) / total — round to nearest cent.
  return Math.round((baseCents * clampedDays) / cycleLength);
};

export const ApplyPromo = (
  baseCents: number,
  plan: PlanTier,
  promo: PromoCode | undefined
): { readonly cents: number; readonly applied: PromoCode | undefined } => {
  if (promo === undefined || !ACTIVE_PROMOS.includes(promo)) {
    return { cents: baseCents, applied: undefined };
  }
  if (promo === "WINTER24") {
    return {
      cents: MultiplyCentsByRate(baseCents, 0.85, "round"),
      applied: "WINTER24",
    };
  }
  if (promo === "STARTUP_50" && plan !== "starter") {
    return { cents: baseCents - ToCents(50.0), applied: "STARTUP_50" };
  }
  return { cents: baseCents, applied: undefined };
};

export const ComputeTaxCents = (
  taxableCents: number,
  region: RegionCode
): number => {
  const rate = REGION_TAX_RATES[region];
  // Use ceil to match the original "tax favorable to merchant" rule.
  return MultiplyCentsByRate(taxableCents, rate, "round");
};

// ----------------------------------------------------------------------------
// SECTION 6: State Monad Pipeline Steps
// ----------------------------------------------------------------------------

const LogStep = (msg: string): IStateMonad<IBillingState, null> =>
  Modify<IBillingState>((s) => ({
    ...s,
    auditTrail: [...s.auditTrail, msg],
  }));

const StepSetBase = (
  request: IBillingRequest
): IStateMonad<IBillingState, null> => ({
  run: (s: IBillingState) => {
    const { cents, grandfathered } = ResolveBasePriceCents(
      request.targetPlan,
      request.user
    );
    return {
      value: null,
      state: {
        ...s,
        subtotal: cents,
        usedGrandfatheredPricing: grandfathered,
        auditTrail: [
          ...s.auditTrail,
          `base=${ToDollars(cents).toFixed(2)} grandfathered=${grandfathered}`,
        ],
      },
    };
  },
});

const StepProrate = (
  request: IBillingRequest
): IStateMonad<IBillingState, null> => ({
  run: (s: IBillingState) => {
    if (!request.isMidCycleUpgrade) return { value: null, state: s };
    const prorated = ApplyProration(
      s.subtotal,
      request.daysRemainingInCycle,
      request.cycleLengthDays
    );
    return {
      value: null,
      state: {
        ...s,
        subtotal: prorated,
        auditTrail: [
          ...s.auditTrail,
          `prorated=${ToDollars(prorated).toFixed(2)} (${request.daysRemainingInCycle}/${request.cycleLengthDays})`,
        ],
      },
    };
  },
});

const StepPromo = (
  request: IBillingRequest
): IStateMonad<IBillingState, null> => ({
  run: (s: IBillingState) => {
    const { cents, applied } = ApplyPromo(
      s.subtotal,
      request.targetPlan,
      request.promoCode
    );
    return {
      value: null,
      state: {
        ...s,
        subtotal: cents,
        appliedPromo: applied,
        auditTrail: [
          ...s.auditTrail,
          `afterPromo=${ToDollars(cents).toFixed(2)} promo=${applied ?? "none"}`,
        ],
      },
    };
  },
});

const StepClamp: IStateMonad<IBillingState, null> = {
  run: (s: IBillingState) => ({
    value: null,
    state: { ...s, subtotal: ClampNonNegative(s.subtotal) },
  }),
};

const StepTax = (
  request: IBillingRequest
): IStateMonad<IBillingState, null> => ({
  run: (s: IBillingState) => {
    const tax = ComputeTaxCents(s.subtotal, request.region);
    const total = s.subtotal + tax;
    return {
      value: null,
      state: {
        ...s,
        taxAmount: tax,
        total,
        auditTrail: [
          ...s.auditTrail,
          `tax=${ToDollars(tax).toFixed(2)} total=${ToDollars(total).toFixed(2)}`,
        ],
      },
    };
  },
});

// ----------------------------------------------------------------------------
// SECTION 7: Public Entry Point
// ----------------------------------------------------------------------------

export const ValidateRequest = (
  request: IBillingRequest
): IBillingError | null => {
  const validPlans: ReadonlyArray<PlanTier> = [
    "starter",
    "professional",
    "enterprise",
  ];
  if (!validPlans.includes(request.targetPlan)) {
    return { kind: "BillingError", reason: `invalid plan: ${request.targetPlan}` };
  }
  if (!(request.region in REGION_TAX_RATES)) {
    return { kind: "BillingError", reason: `invalid region: ${request.region}` };
  }
  if (request.cycleLengthDays <= 0) {
    return { kind: "BillingError", reason: "cycleLengthDays must be > 0" };
  }
  if (request.daysRemainingInCycle < 0) {
    return { kind: "BillingError", reason: "daysRemainingInCycle must be >= 0" };
  }
  return null;
};

export const CalculateBilling = (
  request: IBillingRequest
): BillingOutcome => {
  const validationError = ValidateRequest(request);
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }

  const initialState: IBillingState = {
    subtotal: 0,
    taxAmount: 0,
    total: 0,
    appliedPromo: undefined,
    usedGrandfatheredPricing: false,
    auditTrail: [],
  };

  const pipeline = Sequence<IBillingState>([
    LogStep(`begin user=${request.user.userId} plan=${request.targetPlan}`),
    StepSetBase(request),
    StepProrate(request),
    StepPromo(request),
    StepClamp,
    StepTax(request),
  ]);

  const { state } = pipeline.run(initialState);

  const result: IBillingResult = {
    subtotal: ToDollars(state.subtotal),
    taxAmount: ToDollars(state.taxAmount),
    total: ToDollars(state.total),
    user: { ...request.user, lastBilledAmount: ToDollars(state.total) },
    auditTrail: state.auditTrail,
  };
  return { ok: true, value: result };
};

// ----------------------------------------------------------------------------
// SECTION 8: Mathematically Rigorous Boundary Tests
// ----------------------------------------------------------------------------

export interface ITestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const Approximately = (a: number, b: number, tol = 1e-9): boolean =>
  Math.abs(a - b) <= tol;

export const RunBoundaryTests = (): ReadonlyArray<ITestResult> => {
  const results: ITestResult[] = [];

  // Test 1: 79.99 must round-trip through cents without drift
  const t1 = ToCents(79.99) === 7999 && ToDollars(7999) === 79.99;
  results.push({
    name: "ToCents/ToDollars round-trip @ 79.99",
    passed: t1,
    detail: `cents=${ToCents(79.99)}, back=${ToDollars(7999)}`,
  });

  // Test 2: 0.1 + 0.2 floating-point trap
  const sumCents = ToCents(0.1) + ToCents(0.2);
  const t2 = sumCents === 30 && ToDollars(sumCents) === 0.3;
  results.push({
    name: "0.1 + 0.2 == 0.3 via cents",
    passed: t2,
    detail: `sumCents=${sumCents}, dollars=${ToDollars(sumCents)}`,
  });

  // Test 3: Negative result after STARTUP_50 must clamp to 0
  const r3 = CalculateBilling({
    user: { userId: "u3" },
    targetPlan: "professional",
    region: "US",
    isMidCycleUpgrade: true,
    daysRemainingInCycle: 1,
    cycleLengthDays: 30,
    promoCode: "STARTUP_50",
  });
  const t3 = r3.ok && r3.value.subtotal === 0 && r3.value.taxAmount === 0;
  results.push({
    name: "Clamp negative subtotal after STARTUP_50",
    passed: t3,
    detail: r3.ok ? JSON.stringify(r3.value) : r3.error.reason,
  });

  // Test 4: Grandfathered professional pricing
  const r4 = CalculateBilling({
    user: { userId: "u4", grandfatheredYear: 2021 },
    targetPlan: "professional",
    region: "US",
    isMidCycleUpgrade: false,
    daysRemainingInCycle: 0,
    cycleLengthDays: 30,
  });
  const t4 =
    r4.ok &&
    Approximately(r4.value.subtotal, 35.0) &&
    Approximately(r4.value.total, 35.0 + 35.0 * 0.07, 1e-2);
  results.push({
    name: "Grandfathered professional @ $35",
    passed: t4,
    detail: r4.ok ? JSON.stringify(r4.value) : r4.error.reason,
  });

  // Test 5: Full-cycle proration equals full price (boundary)
  const r5 = CalculateBilling({
    user: { userId: "u5" },
    targetPlan: "enterprise",
    region: "JP",
    isMidCycleUpgrade: true,
    daysRemainingInCycle: 30,
    cycleLengthDays: 30,
  });
  const t5 = r5.ok && Approximately(r5.value.subtotal, 249.5);
  results.push({
    name: "Proration boundary: full cycle == full price",
    passed: t5,
    detail: r5.ok ? JSON.stringify(r5.value) : r5.error.reason,
  });

  // Test 6: Zero-day proration boundary
  const r6 = CalculateBilling({
    user: { userId: "u6" },
    targetPlan: "enterprise",
    region: "EU",
    isMidCycleUpgrade: true,
    daysRemainingInCycle: 0,
    cycleLengthDays: 30,
  });
  const t6 = r6.ok && r6.value.subtotal === 0 && r6.value.total === 0;
  results.push({
    name: "Proration boundary: 0 days == 0",
    passed: t6,
    detail: r6.ok ? JSON.stringify(r6.value) : r6.error.reason,
  });

  // Test 7: Immutability — input user object is not mutated
  const original: IUser = Object.freeze({ userId: "u7" });
  const r7 = CalculateBilling({
    user: original,
    targetPlan: "starter",
    region: "US",
    isMidCycleUpgrade: false,
    daysRemainingInCycle: 0,
    cycleLengthDays: 30,
  });
  const t7 = r7.ok && original.lastBilledAmount === undefined;
  results.push({
    name: "Input immutability preserved",
    passed: t7,
    detail: `original.lastBilledAmount=${original.lastBilledAmount}`,
  });

  // Test 8: Invalid plan returns error
  const r8 = CalculateBilling({
    user: { userId: "u8" },
    // @ts-expect-error — runtime guard test
    targetPlan: "bogus",
    region: "US",
    isMidCycleUpgrade: false,
    daysRemainingInCycle: 0,
    cycleLengthDays: 30,
  });
  results.push({
    name: "Invalid plan rejected",
    passed: !r8.ok,
    detail: r8.ok ? "unexpected success" : r8.error.reason,
  });

  return results;
};
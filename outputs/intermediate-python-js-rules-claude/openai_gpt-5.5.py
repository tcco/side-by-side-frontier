/* ============================================================
   Functional SaaS Billing Engine
   - Pure functions only
   - No classes
   - No external dependencies
   - State Monad based calculation pipeline
   - Exact rational-cent arithmetic for billing
   - Boundary testing for floating-point currency conversion
   ============================================================ */

/* ============================================================
   Domain Types
   ============================================================ */

export type PlanName = "starter" | "professional" | "enterprise";

export type PromoCode = "WINTER24" | "STARTUP_50";

export type KnownRegionCode = "US" | "EU" | "UK" | "CA" | "JP";

export type BillingErrorCode =
  | "InvalidPlan"
  | "InvalidProration"
  | "InvalidMoneyString"
  | "InvalidCurrencyNumber"
  | "AmbiguousFloatingPointBoundary"
  | "UnsafeIntegerConversion"
  | "InvalidRational";

export interface BillingUser {
  readonly userId?: string;
  readonly grandfatheredYr?: number;
  readonly lastBilledAmtCents?: number;
  readonly lastBilledAmt?: string;
}

export interface BillingProrationInput {
  readonly isUpgrade: boolean;
  readonly daysRemaining: number;
  readonly daysInPeriod: number;
}

export interface BillingCalculationInput {
  readonly user: BillingUser;
  readonly targetPlan: string;
  readonly location: string;
  readonly proration: BillingProrationInput;
  readonly promoCode?: string;
}

export interface BillingConfiguration {
  readonly planPricesCents: Readonly<Record<PlanName, number>>;
  readonly professionalLegacyPriceCents: number;
  readonly professionalLegacyCutoffYearExclusive: number;
  readonly taxRatesBasisPointsByRegion: Readonly<Record<KnownRegionCode, number>>;
  readonly activePromoCodes: readonly PromoCode[];
}

export interface BillingAuditEntry {
  readonly sequence: number;
  readonly step: string;
  readonly message: string;
}

export interface BillingState {
  readonly user: BillingUser;
  readonly configuration: BillingConfiguration;
  readonly audit: readonly BillingAuditEntry[];
}

export interface BillingError {
  readonly code: BillingErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface Success<Value> {
  readonly ok: true;
  readonly value: Value;
}

export interface Failure {
  readonly ok: false;
  readonly error: BillingError;
}

export type Result<Value> = Success<Value> | Failure;

export interface RationalCents {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface ExactRationalAmountSnapshot {
  readonly numerator: string;
  readonly denominator: string;
  readonly approximateDecimalCents: string;
}

export interface FinalizedBilling {
  readonly targetPlan: PlanName;
  readonly subtotalBeforeTaxExact: ExactRationalAmountSnapshot;
  readonly taxExact: ExactRationalAmountSnapshot;
  readonly totalExact: ExactRationalAmountSnapshot;
  readonly totalCents: number;
  readonly total: string;
  readonly updatedUser: BillingUser;
}

export interface BillingCalculationSuccessOutput {
  readonly ok: true;
  readonly targetPlan: PlanName;
  readonly subtotalBeforeTaxExact: ExactRationalAmountSnapshot;
  readonly taxExact: ExactRationalAmountSnapshot;
  readonly totalExact: ExactRationalAmountSnapshot;
  readonly totalCents: number;
  readonly total: string;
  readonly updatedUser: BillingUser;
  readonly audit: readonly BillingAuditEntry[];
}

export interface BillingCalculationFailureOutput {
  readonly ok: false;
  readonly error: BillingError;
  readonly user: BillingUser;
  readonly audit: readonly BillingAuditEntry[];
}

export type BillingCalculationOutput =
  | BillingCalculationSuccessOutput
  | BillingCalculationFailureOutput;

/* ============================================================
   State Monad Types
   ============================================================ */

export interface StateTransition<StateValue, Value> {
  readonly state: StateValue;
  readonly value: Value;
}

export type StateMonad<StateValue, Value> = (
  state: StateValue
) => StateTransition<StateValue, Value>;

export type BillingStep<Value> = StateMonad<BillingState, Result<Value>>;

export interface StateReturnInput<Value> {
  readonly value: Value;
}

export interface StateBindInput<StateValue, Value, NextValue> {
  readonly stateMonad: StateMonad<StateValue, Value>;
  readonly next: (value: Value) => StateMonad<StateValue, NextValue>;
}

export interface StateMapInput<StateValue, Value, NextValue> {
  readonly stateMonad: StateMonad<StateValue, Value>;
  readonly mapper: (value: Value) => NextValue;
}

export interface StateModifyInput<StateValue> {
  readonly modifier: (state: StateValue) => StateValue;
}

export interface BillingStepBindInput<Value, NextValue> {
  readonly step: BillingStep<Value>;
  readonly next: (value: Value) => BillingStep<NextValue>;
}

/* ============================================================
   Core State Monad Functions
   ============================================================ */

export function StateReturn<StateValue, Value>(
  input: StateReturnInput<Value>
): StateMonad<StateValue, Value> {
  return (state: StateValue): StateTransition<StateValue, Value> => ({
    state,
    value: input.value,
  });
}

export function StateBind<StateValue, Value, NextValue>(
  input: StateBindInput<StateValue, Value, NextValue>
): StateMonad<StateValue, NextValue> {
  return (state: StateValue): StateTransition<StateValue, NextValue> => {
    const transition = input.stateMonad(state);
    return input.next(transition.value)(transition.state);
  };
}

export function StateMap<StateValue, Value, NextValue>(
  input: StateMapInput<StateValue, Value, NextValue>
): StateMonad<StateValue, NextValue> {
  return StateBind({
    stateMonad: input.stateMonad,
    next: (value: Value): StateMonad<StateValue, NextValue> =>
      StateReturn({ value: input.mapper(value) }),
  });
}

export function StateModify<StateValue>(
  input: StateModifyInput<StateValue>
): StateMonad<StateValue, undefined> {
  return (state: StateValue): StateTransition<StateValue, undefined> => ({
    state: input.modifier(state),
    value: undefined,
  });
}

export function StateBindResult<Value, NextValue>(
  input: BillingStepBindInput<Value, NextValue>
): BillingStep<NextValue> {
  return (state: BillingState): StateTransition<BillingState, Result<NextValue>> => {
    const transition = input.step(state);

    if (!transition.value.ok) {
      return {
        state: transition.state,
        value: transition.value,
      };
    }

    return input.next(transition.value.value)(transition.state);
  };
}

/* ============================================================
   Result Helpers
   ============================================================ */

export interface SuccessInput<Value> {
  readonly value: Value;
}

export interface FailureInput {
  readonly code: BillingErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export function SuccessResult<Value>(input: SuccessInput<Value>): Result<Value> {
  return {
    ok: true,
    value: input.value,
  };
}

export function FailureResult(input: FailureInput): Failure {
  return {
    ok: false,
    error: {
      code: input.code,
      message: input.message,
      details: input.details,
    },
  };
}

/* ============================================================
   Configuration
   ============================================================ */

export function DefaultBillingConfiguration(): BillingConfiguration {
  return {
    planPricesCents: {
      starter: 1500,
      professional: 7999,
      enterprise: 24950,
    },
    professionalLegacyPriceCents: 3500,
    professionalLegacyCutoffYearExclusive: 2023,
    taxRatesBasisPointsByRegion: {
      US: 700,
      EU: 2000,
      UK: 2000,
      CA: 500,
      JP: 1000,
    },
    activePromoCodes: ["WINTER24", "STARTUP_50"],
  };
}

/* ============================================================
   BigInt / Rational Arithmetic
   ============================================================ */

export interface BigIntInput {
  readonly value: bigint;
}

export interface BigIntPairInput {
  readonly left: bigint;
  readonly right: bigint;
}

export interface CreateRationalCentsInput {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface RationalInput {
  readonly amount: RationalCents;
}

export interface RationalBinaryInput {
  readonly left: RationalCents;
  readonly right: RationalCents;
}

export interface RationalRatioInput {
  readonly amount: RationalCents;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface RationalIntegerInput {
  readonly amount: RationalCents;
  readonly integer: bigint;
}

export interface CentsInput {
  readonly cents: number;
}

export interface BigIntCentsInput {
  readonly cents: bigint;
}

export interface SafeIntegerInput {
  readonly value: bigint;
}

export function AbsoluteBigInt(input: BigIntInput): bigint {
  return input.value < 0n ? -input.value : input.value;
}

export function GreatestCommonDivisorBigInt(input: BigIntPairInput): bigint {
  const leftAbs = AbsoluteBigInt({ value: input.left });
  const rightAbs = AbsoluteBigInt({ value: input.right });

  const Iterate = (left: bigint, right: bigint): bigint =>
    right === 0n ? left : Iterate(right, left % right);

  return Iterate(leftAbs, rightAbs);
}

export function CreateRationalCents(
  input: CreateRationalCentsInput
): Result<RationalCents> {
  if (input.denominator === 0n) {
    return FailureResult({
      code: "InvalidRational",
      message: "Rational denominator cannot be zero.",
    });
  }

  const sign = input.denominator < 0n ? -1n : 1n;
  const signedNumerator = input.numerator * sign;
  const positiveDenominator = input.denominator * sign;
  const divisor = GreatestCommonDivisorBigInt({
    left: signedNumerator,
    right: positiveDenominator,
  });

  return SuccessResult({
    value: {
      numerator: signedNumerator / divisor,
      denominator: positiveDenominator / divisor,
    },
  });
}

export function RationalFromCents(input: CentsInput): RationalCents {
  return {
    numerator: BigInt(input.cents),
    denominator: 1n,
  };
}

export function AddRationalCents(input: RationalBinaryInput): RationalCents {
  const numerator =
    input.left.numerator * input.right.denominator +
    input.right.numerator * input.left.denominator;
  const denominator = input.left.denominator * input.right.denominator;

  const normalized = CreateRationalCents({ numerator, denominator });

  return normalized.ok
    ? normalized.value
    : {
        numerator,
        denominator,
      };
}

export function SubtractRationalCents(input: RationalBinaryInput): RationalCents {
  return AddRationalCents({
    left: input.left,
    right: {
      numerator: -input.right.numerator,
      denominator: input.right.denominator,
    },
  });
}

export function MultiplyRationalCentsByInteger(
  input: RationalIntegerInput
): RationalCents {
  const normalized = CreateRationalCents({
    numerator: input.amount.numerator * input.integer,
    denominator: input.amount.denominator,
  });

  return normalized.ok ? normalized.value : input.amount;
}

export function MultiplyRationalCentsByRatio(input: RationalRatioInput): RationalCents {
  const normalized = CreateRationalCents({
    numerator: input.amount.numerator * input.numerator,
    denominator: input.amount.denominator * input.denominator,
  });

  return normalized.ok ? normalized.value : input.amount;
}

export function MaxRationalCentsWithZero(input: RationalInput): RationalCents {
  return input.amount.numerator < 0n
    ? {
        numerator: 0n,
        denominator: 1n,
      }
    : input.amount;
}

export function CeilRationalCentsToBigInt(input: RationalInput): bigint {
  const quotient = input.amount.numerator / input.amount.denominator;
  const remainder = input.amount.numerator % input.amount.denominator;

  if (remainder === 0n) {
    return quotient;
  }

  return input.amount.numerator > 0n ? quotient + 1n : quotient;
}

export function ConvertBigIntToSafeInteger(input: SafeIntegerInput): Result<number> {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);

  if (input.value > maxSafe || input.value < minSafe) {
    return FailureResult({
      code: "UnsafeIntegerConversion",
      message: "BigInt value cannot be represented as a safe JavaScript integer.",
      details: {
        value: input.value.toString(),
      },
    });
  }

  return SuccessResult({
    value: Number(input.value),
  });
}

export function FormatCentsAsCurrency(input: CentsInput): string {
  const sign = input.cents < 0 ? "-" : "";
  const absoluteCents = Math.abs(input.cents);
  const dollars = Math.floor(absoluteCents / 100);
  const cents = absoluteCents % 100;
  const paddedCents = cents.toString().padStart(2, "0");

  return `${sign}${dollars}.${paddedCents}`;
}

export function SnapshotRationalAmount(
  input: RationalInput
): ExactRationalAmountSnapshot {
  const approximateCents =
    Number(input.amount.numerator) / Number(input.amount.denominator);

  return {
    numerator: input.amount.numerator.toString(),
    denominator: input.amount.denominator.toString(),
    approximateDecimalCents: approximateCents.toFixed(8),
  };
}

/* ============================================================
   Exact Money String Conversion
   ============================================================ */

export interface MoneyStringInput {
  readonly amount: string;
}

export function ParseMoneyStringToCents(input: MoneyStringInput): Result<number> {
  const trimmedAmount = input.amount.trim();
  const matches = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(trimmedAmount);

  if (matches === null) {
    return FailureResult({
      code: "InvalidMoneyString",
      message: "Money string must be non-negative with at most two decimal places.",
      details: {
        amount: input.amount,
      },
    });
  }

  const wholePart = BigInt(matches[1]);
  const fractionalPart = matches[2] ?? "";
  const paddedFractionalPart = fractionalPart.padEnd(2, "0");
  const centsBigInt = wholePart * 100n + BigInt(paddedFractionalPart || "0");

  return ConvertBigIntToSafeInteger({ value: centsBigInt });
}

/* ============================================================
   Floating-Point Currency Boundary Conversion and Tests
   ============================================================ */

export interface NumberToCentsInput {
  readonly amount: number;
  readonly precisionEpsilon?: number;
}

export interface CurrencyBoundaryTestCase {
  readonly name: string;
  readonly amount: number;
  readonly expectedOk: boolean;
  readonly expectedCents?: number;
  readonly expectedErrorCode?: BillingErrorCode;
}

export interface CurrencyBoundaryTestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly actual: Result<number>;
  readonly expectedOk: boolean;
  readonly expectedCents?: number;
  readonly expectedErrorCode?: BillingErrorCode;
}

export interface CurrencyBoundaryTestReport {
  readonly passed: boolean;
  readonly results: readonly CurrencyBoundaryTestResult[];
}

export function ConvertCurrencyNumberToCents(
  input: NumberToCentsInput
): Result<number> {
  const epsilon = input.precisionEpsilon ?? 1e-9;

  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return FailureResult({
      code: "InvalidCurrencyNumber",
      message: "Currency number must be finite and non-negative.",
      details: {
        amount: String(input.amount),
      },
    });
  }

  if (input.amount > Number.MAX_SAFE_INTEGER / 100) {
    return FailureResult({
      code: "UnsafeIntegerConversion",
      message: "Currency amount is too large to convert safely to cents.",
      details: {
        amount: input.amount,
      },
    });
  }

  const scaledAmount = input.amount * 100;
  const lowerCent = Math.floor(scaledAmount);
  const fractionalCent = scaledAmount - lowerCent;
  const distanceFromHalfCentBoundary = Math.abs(fractionalCent - 0.5);

  if (distanceFromHalfCentBoundary <= epsilon) {
    return FailureResult({
      code: "AmbiguousFloatingPointBoundary",
      message:
        "Currency number is too close to a half-cent rounding boundary to convert safely.",
      details: {
        amount: input.amount,
        scaledAmount,
        epsilon,
      },
    });
  }

  return SuccessResult({
    value: Math.floor(scaledAmount + 0.5),
  });
}

export function CurrencyBoundaryTestCases(): readonly CurrencyBoundaryTestCase[] {
  return [
    {
      name: "Exact zero",
      amount: 0,
      expectedOk: true,
      expectedCents: 0,
    },
    {
      name: "Exact two-decimal amount",
      amount: 12.34,
      expectedOk: true,
      expectedCents: 1234,
    },
    {
      name: "Binary floating addition still rounds to exact cents",
      amount: 0.1 + 0.2,
      expectedOk: true,
      expectedCents: 30,
    },
    {
      name: "Classic 1.005 half-cent ambiguity",
      amount: 1.005,
      expectedOk: false,
      expectedErrorCode: "AmbiguousFloatingPointBoundary",
    },
    {
      name: "Classic 2.675 half-cent ambiguity",
      amount: 2.675,
      expectedOk: false,
      expectedErrorCode: "AmbiguousFloatingPointBoundary",
    },
    {
      name: "Explicit half-cent boundary",
      amount: 0.005,
      expectedOk: false,
      expectedErrorCode: "AmbiguousFloatingPointBoundary",
    },
    {
      name: "Negative amount rejected",
      amount: -1,
      expectedOk: false,
      expectedErrorCode: "InvalidCurrencyNumber",
    },
    {
      name: "NaN rejected",
      amount: Number.NaN,
      expectedOk: false,
      expectedErrorCode: "InvalidCurrencyNumber",
    },
    {
      name: "Unsafe magnitude rejected",
      amount: Number.MAX_SAFE_INTEGER,
      expectedOk: false,
      expectedErrorCode: "UnsafeIntegerConversion",
    },
  ];
}

export function EvaluateCurrencyBoundaryTestCase(
  input: CurrencyBoundaryTestCase
): CurrencyBoundaryTestResult {
  const actual = ConvertCurrencyNumberToCents({ amount: input.amount });

  const passed =
    input.expectedOk === actual.ok &&
    (actual.ok
      ? actual.value === input.expectedCents
      : actual.error.code === input.expectedErrorCode);

  return {
    name: input.name,
    passed,
    actual,
    expectedOk: input.expectedOk,
    expectedCents: input.expectedCents,
    expectedErrorCode: input.expectedErrorCode,
  };
}

export function RunCurrencyBoundaryTests(): CurrencyBoundaryTestReport {
  const results = CurrencyBoundaryTestCases().map(EvaluateCurrencyBoundaryTestCase);

  return {
    passed: results.every((result) => result.passed),
    results,
  };
}

/* ============================================================
   Billing Helpers
   ============================================================ */

export interface ResolvePlanInput {
  readonly targetPlan: string;
}

export interface ResolvePromoInput {
  readonly promoCode?: string;
}

export interface IsKnownRegionInput {
  readonly location: string;
}

export interface AppendAuditEntryToStateInput {
  readonly state: BillingState;
  readonly step: string;
  readonly message: string;
}

export interface PlanAmount {
  readonly plan: PlanName;
  readonly amount: RationalCents;
}

export interface PromotionAmountInput {
  readonly plan: PlanName;
  readonly amount: RationalCents;
}

export interface ProrationAmountInput {
  readonly amount: RationalCents;
  readonly proration: BillingProrationInput;
}

export interface FinalizeBillingInput {
  readonly plan: PlanName;
  readonly amount: RationalCents;
  readonly location: string;
}

export function ResolvePlan(input: ResolvePlanInput): Result<PlanName> {
  switch (input.targetPlan) {
    case "starter":
      return SuccessResult({ value: "starter" });
    case "professional":
      return SuccessResult({ value: "professional" });
    case "enterprise":
      return SuccessResult({ value: "enterprise" });
    default:
      return FailureResult({
        code: "InvalidPlan",
        message: "Invalid target plan.",
        details: {
          targetPlan: input.targetPlan,
        },
      });
  }
}

export function ResolvePromo(input: ResolvePromoInput): PromoCode | undefined {
  switch (input.promoCode) {
    case "WINTER24":
      return "WINTER24";
    case "STARTUP_50":
      return "STARTUP_50";
    default:
      return undefined;
  }
}

export function IsKnownRegion(input: IsKnownRegionInput): input is {
  readonly location: KnownRegionCode;
} {
  return (
    input.location === "US" ||
    input.location === "EU" ||
    input.location === "UK" ||
    input.location === "CA" ||
    input.location === "JP"
  );
}

export function AppendAuditEntryToState(
  input: AppendAuditEntryToStateInput
): BillingState {
  const sequence = input.state.audit.length + 1;

  return {
    ...input.state,
    audit: [
      ...input.state.audit,
      {
        sequence,
        step: input.step,
        message: input.message,
      },
    ],
  };
}

export function IsGrandfatheredProfessionalUser(input: BillingState): boolean {
  return (
    typeof input.user.grandfatheredYr === "number" &&
    input.user.grandfatheredYr <
      input.configuration.professionalLegacyCutoffYearExclusive
  );
}

export function IsActivePromoCode(input: {
  readonly configuration: BillingConfiguration;
  readonly promoCode: PromoCode;
}): boolean {
  return input.configuration.activePromoCodes.includes(input.promoCode);
}

/* ============================================================
   Billing State-Monad Steps
   ============================================================ */

export function ResolvePlanBaseCostStep(input: ResolvePlanInput): BillingStep<PlanAmount> {
  return (state: BillingState): StateTransition<BillingState, Result<PlanAmount>> => {
    const planResult = ResolvePlan({ targetPlan: input.targetPlan });

    if (!planResult.ok) {
      return {
        state,
        value: planResult,
      };
    }

    const plan = planResult.value;
    const baseCents =
      plan === "professional" && IsGrandfatheredProfessionalUser(state)
        ? state.configuration.professionalLegacyPriceCents
        : state.configuration.planPricesCents[plan];

    const nextState = AppendAuditEntryToState({
      state,
      step: "ResolvePlanBaseCost",
      message: `Resolved ${plan} base cost to ${FormatCentsAsCurrency({
        cents: baseCents,
      })}.`,
    });

    return {
      state: nextState,
      value: SuccessResult({
        value: {
          plan,
          amount: RationalFromCents({ cents: baseCents }),
        },
      }),
    };
  };
}

export function ApplyProrationStep(
  input: ProrationAmountInput
): BillingStep<RationalCents> {
  return (state: BillingState): StateTransition<BillingState, Result<RationalCents>> => {
    if (!input.proration.isUpgrade) {
      const nextState = AppendAuditEntryToState({
        state,
        step: "ApplyProration",
        message: "No proration applied because this is not an upgrade.",
      });

      return {
        state: nextState,
        value: SuccessResult({ value: input.amount }),
      };
    }

    const daysRemainingIsInteger = Number.isInteger(input.proration.daysRemaining);
    const daysInPeriodIsInteger = Number.isInteger(input.proration.daysInPeriod);
    const validDaysInPeriod =
      daysInPeriodIsInteger &&
      input.proration.daysInPeriod >= 1 &&
      input.proration.daysInPeriod <= 366;
    const validDaysRemaining =
      daysRemainingIsInteger &&
      input.proration.daysRemaining >= 0 &&
      input.proration.daysRemaining <= input.proration.daysInPeriod;

    if (!validDaysInPeriod || !validDaysRemaining) {
      return {
        state,
        value: FailureResult({
          code: "InvalidProration",
          message:
            "Proration requires integer days with 1 <= daysInPeriod <= 366 and 0 <= daysRemaining <= daysInPeriod.",
          details: {
            daysRemaining: input.proration.daysRemaining,
            daysInPeriod: input.proration.daysInPeriod,
          },
        }),
      };
    }

    const proratedAmount = MultiplyRationalCentsByRatio({
      amount: input.amount,
      numerator: BigInt(input.proration.daysRemaining),
      denominator: BigInt(input.proration.daysInPeriod),
    });

    const nextState = AppendAuditEntryToState({
      state,
      step: "ApplyProration",
      message: `Applied proration using ${input.proration.daysRemaining}/${input.proration.daysInPeriod} of the billing period.`,
    });

    return {
      state: nextState,
      value: SuccessResult({ value: proratedAmount }),
    };
  };
}

export function ApplyPromotionStep(input: {
  readonly plan: PlanName;
  readonly amount: RationalCents;
  readonly promoCode?: string;
}): BillingStep<RationalCents> {
  return (state: BillingState): StateTransition<BillingState, Result<RationalCents>> => {
    const promoCode = ResolvePromo({ promoCode: input.promoCode });

    if (promoCode === undefined) {
      const nextState = AppendAuditEntryToState({
        state,
        step: "ApplyPromotion",
        message: "No recognized promotion code supplied.",
      });

      return {
        state: nextState,
        value: SuccessResult({ value: input.amount }),
      };
    }

    if (!IsActivePromoCode({ configuration: state.configuration, promoCode })) {
      const nextState = AppendAuditEntryToState({
        state,
        step: "ApplyPromotion",
        message: `Promotion ${promoCode} is recognized but inactive.`,
      });

      return {
        state: nextState,
        value: SuccessResult({ value: input.amount }),
      };
    }

    if (promoCode === "WINTER24") {
      const discountedAmount = MultiplyRationalCentsByRatio({
        amount: input.amount,
        numerator: 8500n,
        denominator: 10000n,
      });

      const nextState = AppendAuditEntryToState({
        state,
        step: "ApplyPromotion",
        message: "Applied WINTER24 discount: 15% off.",
      });

      return {
        state: nextState,
        value: SuccessResult({ value: discountedAmount }),
      };
    }

    if (promoCode === "STARTUP_50" && input.plan !== "starter") {
      const discountedAmount = MaxRationalCentsWithZero({
        amount: SubtractRationalCents({
          left: input.amount,
          right: RationalFromCents({ cents: 5000 }),
        }),
      });

      const nextState = AppendAuditEntryToState({
        state,
        step: "ApplyPromotion",
        message: "Applied STARTUP_50 discount: $50.00 off.",
      });

      return {
        state: nextState,
        value: SuccessResult({ value: discountedAmount }),
      };
    }

    const nextState = AppendAuditEntryToState({
      state,
      step: "ApplyPromotion",
      message: `Promotion ${promoCode} did not apply to ${input.plan}.`,
    });

    return {
      state: nextState,
      value: SuccessResult({ value: input.amount }),
    };
  };
}

export function FinalizeBillingStep(
  input: FinalizeBillingInput
): BillingStep<FinalizedBilling> {
  return (state: BillingState): StateTransition<BillingState, Result<FinalizedBilling>> => {
    const isKnownRegion = IsKnownRegion({ location: input.location });
    const taxBasisPoints = isKnownRegion
      ? state.configuration.taxRatesBasisPointsByRegion[input.location]
      : 0;

    const taxExact = MultiplyRationalCentsByRatio({
      amount: input.amount,
      numerator: BigInt(taxBasisPoints),
      denominator: 10000n,
    });

    const totalExact = AddRationalCents({
      left: input.amount,
      right: taxExact,
    });

    const totalCentsBigInt = CeilRationalCentsToBigInt({ amount: totalExact });
    const safeTotalCents = ConvertBigIntToSafeInteger({ value: totalCentsBigInt });

    if (!safeTotalCents.ok) {
      return {
        state,
        value: safeTotalCents,
      };
    }

    const total = FormatCentsAsCurrency({ cents: safeTotalCents.value });

    const updatedUser: BillingUser = {
      ...state.user,
      lastBilledAmtCents: safeTotalCents.value,
      lastBilledAmt: total,
    };

    const nextState = AppendAuditEntryToState({
      state: {
        ...state,
        user: updatedUser,
      },
      step: "FinalizeBilling",
      message: `Applied ${taxBasisPoints / 100}% tax and finalized total ${total}.`,
    });

    return {
      state: nextState,
      value: SuccessResult({
        value: {
          targetPlan: input.plan,
          subtotalBeforeTaxExact: SnapshotRationalAmount({ amount: input.amount }),
          taxExact: SnapshotRationalAmount({ amount: taxExact }),
          totalExact: SnapshotRationalAmount({ amount: totalExact }),
          totalCents: safeTotalCents.value,
          total,
          updatedUser,
        },
      }),
    };
  };
}

/* ============================================================
   Main Billing Program
   ============================================================ */

export interface BillingProgramInput {
  readonly calculationInput: BillingCalculationInput;
}

export function BillingProgram(input: BillingProgramInput): BillingStep<FinalizedBilling> {
  return StateBindResult({
    step: ResolvePlanBaseCostStep({
      targetPlan: input.calculationInput.targetPlan,
    }),
    next: (planAmount: PlanAmount): BillingStep<FinalizedBilling> =>
      StateBindResult({
        step: ApplyProrationStep({
          amount: planAmount.amount,
          proration: input.calculationInput.proration,
        }),
        next: (proratedAmount: RationalCents): BillingStep<FinalizedBilling> =>
          StateBindResult({
            step: ApplyPromotionStep({
              plan: planAmount.plan,
              amount: proratedAmount,
              promoCode: input.calculationInput.promoCode,
            }),
            next: (discountedAmount: RationalCents): BillingStep<FinalizedBilling> =>
              FinalizeBillingStep({
                plan: planAmount.plan,
                amount: discountedAmount,
                location: input.calculationInput.location,
              }),
          }),
      }),
  });
}

export function CalculateBilling(
  input: BillingCalculationInput
): BillingCalculationOutput {
  const initialState: BillingState = {
    user: input.user,
    configuration: DefaultBillingConfiguration(),
    audit: [],
  };

  const transition = BillingProgram({ calculationInput: input })(initialState);

  if (!transition.value.ok) {
    return {
      ok: false,
      error: transition.value.error,
      user: transition.state.user,
      audit: transition.state.audit,
    };
  }

  return {
    ok: true,
    targetPlan: transition.value.value.targetPlan,
    subtotalBeforeTaxExact: transition.value.value.subtotalBeforeTaxExact,
    taxExact: transition.value.value.taxExact,
    totalExact: transition.value.value.totalExact,
    totalCents: transition.value.value.totalCents,
    total: transition.value.value.total,
    updatedUser: transition.value.value.updatedUser,
    audit: transition.state.audit,
  };
}

/* ============================================================
   Example Usage
   ============================================================ */

export const exampleBillingResult = CalculateBilling({
  user: {
    userId: "user_123",
    grandfatheredYr: 2022,
  },
  targetPlan: "professional",
  location: "US",
  proration: {
    isUpgrade: true,
    daysRemaining: 15,
    daysInPeriod: 30,
  },
  promoCode: "WINTER24",
});

export const exampleCurrencyBoundaryTestReport = RunCurrencyBoundaryTests();
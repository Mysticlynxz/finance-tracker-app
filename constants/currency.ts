export const SUPPORTED_CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "CHF",
  "SGD",
  "AED",
  "SAR",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = "INR";

type CurrencyConfig = {
  symbol: string;
  rate: number;
};

export const CURRENCY_DECIMAL_PLACES = 2;
const CURRENCY_MINOR_UNIT_SCALE = 10 ** CURRENCY_DECIMAL_PLACES;
const MINOR_UNIT_FRACTION_TOLERANCE = Number.EPSILON * 128;

const compensatedSum = (values: number[]) => {
  let sum = 0;
  let correction = 0;

  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value)
      ? (sum - next) + value
      : (value - next) + sum;
    sum = next;
  }

  return sum + correction;
};

export const CURRENCY_CONFIG: Record<SupportedCurrency, CurrencyConfig> = {
  INR: { symbol: "\u20B9", rate: 1 },
  USD: { symbol: "$", rate: 83 },
  EUR: { symbol: "\u20AC", rate: 90 },
  GBP: { symbol: "\u00A3", rate: 105 },
  JPY: { symbol: "\u00A5", rate: 0.55 },
  CNY: { symbol: "\u00A5", rate: 11.5 },
  AUD: { symbol: "A$", rate: 55 },
  CAD: { symbol: "C$", rate: 60 },
  CHF: { symbol: "CHF", rate: 92 },
  SGD: { symbol: "S$", rate: 62 },
  AED: { symbol: "\u062F.\u0625", rate: 22.5 },
  SAR: { symbol: "\uFDFC", rate: 22 },
};

export const CURRENCY_NAMES: Record<SupportedCurrency, string> = {
  INR: "Indian Rupee",
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CNY: "Chinese Yuan",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  SGD: "Singapore Dollar",
  AED: "UAE Dirham",
  SAR: "Saudi Riyal",
};

const roundCurrencyAmount = (value: number) => {
  if (!Number.isFinite(value)) {
    throw new RangeError("Currency amount must be finite before rounding.");
  }

  const rounded = Math.abs(value) > Number.MAX_VALUE / CURRENCY_MINOR_UNIT_SCALE
    ? value
    : Math.round(value * CURRENCY_MINOR_UNIT_SCALE) / CURRENCY_MINOR_UNIT_SCALE;

  if (!Number.isFinite(rounded)) {
    throw new RangeError("Currency amount cannot be represented as a finite value.");
  }

  return rounded;
};

const requireFiniteAmount = (amount: number) => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new RangeError("Currency conversion requires a finite numeric amount.");
  }
  return amount;
};

const requireFiniteConversion = (amount: number, currency: SupportedCurrency) => {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Currency conversion to or from ${currency} exceeds the finite numeric range.`);
  }
  return amount;
};

export const normalizeCurrencyCode = (currency?: string): SupportedCurrency => {
  const normalized = typeof currency === "string" ? currency.trim().toUpperCase() : "";

  if (
    normalized &&
    Object.prototype.hasOwnProperty.call(CURRENCY_CONFIG, normalized)
  ) {
    return normalized as SupportedCurrency;
  }

  return DEFAULT_CURRENCY;
};

export const getCurrencyConfig = (currency?: string): CurrencyConfig => {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const config = CURRENCY_CONFIG[normalizedCurrency];

  if (
    !config ||
    typeof config.symbol !== "string" ||
    !config.symbol.trim() ||
    !Number.isFinite(config.rate) ||
    config.rate <= 0 ||
    typeof CURRENCY_NAMES[normalizedCurrency] !== "string" ||
    !CURRENCY_NAMES[normalizedCurrency].trim()
  ) {
    throw new Error(`Currency configuration is invalid for ${normalizedCurrency}.`);
  }

  return config;
};

export const convertFromINR = (amount: number, currency?: string) => {
  const numericAmount = requireFiniteAmount(amount);
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const { rate } = getCurrencyConfig(normalizedCurrency);
  const convertedAmount = requireFiniteConversion(numericAmount / rate, normalizedCurrency);
  return roundCurrencyAmount(convertedAmount);
};

export const convertToINR = (amount: number, currency?: string) => {
  const numericAmount = requireFiniteAmount(amount);
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const { rate } = getCurrencyConfig(normalizedCurrency);
  const convertedAmount = requireFiniteConversion(numericAmount * rate, normalizedCurrency);
  return roundCurrencyAmount(convertedAmount);
};

export const formatCurrencyAmount = (amount: number, currency?: string) => {
  const numericAmount = requireFiniteAmount(amount);
  const safeAmount = roundCurrencyAmount(numericAmount);
  const { symbol } = getCurrencyConfig(currency);

  return `${symbol}${safeAmount.toFixed(CURRENCY_DECIMAL_PLACES)}`;
};

/** Allocate display minor units so category rows reconcile to the converted total. */
export const allocateCurrencyDisplayAmounts = (
  totalAmountInINR: number,
  categoryAmountsInINR: number[],
  currency?: string
): number[] => {
  if (
    !Number.isFinite(totalAmountInINR) ||
    totalAmountInINR < 0 ||
    categoryAmountsInINR.some((amount) => !Number.isFinite(amount) || amount < 0)
  ) {
    throw new RangeError("Currency allocation requires finite non-negative amounts.");
  }

  const normalizedCurrency = normalizeCurrencyCode(currency);
  const { rate } = getCurrencyConfig(normalizedCurrency);
  const categoryTotalInINR = compensatedSum(categoryAmountsInINR);
  // Bound tolerance by the representational precision of the actual operands.
  // The sum is compensated, so there is no arbitrary multiplier on category
  // count or relative tolerance that can hide a real one-paisa discrepancy.
  const representationErrorBound = categoryAmountsInINR.reduce(
    (bound, amount) => bound + (amount === 0 ? Number.MIN_VALUE : Number.EPSILON * Math.abs(amount)),
    totalAmountInINR === 0 ? Number.MIN_VALUE : Number.EPSILON * Math.abs(totalAmountInINR)
  );
  const reconciliationTolerance = representationErrorBound * 2;

  if (
    !Number.isFinite(categoryTotalInINR) ||
    !Number.isFinite(reconciliationTolerance) ||
    Math.abs(categoryTotalInINR - totalAmountInINR) > reconciliationTolerance
  ) {
    throw new RangeError("Category INR totals do not reconcile with the monthly INR total.");
  }

  const targetAmount = convertFromINR(totalAmountInINR, normalizedCurrency);
  const targetMinorUnits = Math.round(targetAmount * CURRENCY_MINOR_UNIT_SCALE);
  if (!Number.isSafeInteger(targetMinorUnits)) {
    throw new RangeError("Currency allocation exceeds the safe minor-unit range.");
  }

  if (categoryAmountsInINR.length === 0) return [];

  // Absorb only floating-point summation noise into the largest category. Raw
  // category values remain unchanged; genuine mismatches were rejected above.
  const arithmeticCategoryAmounts = [...categoryAmountsInINR];
  const reconciliationDelta = totalAmountInINR - categoryTotalInINR;
  if (reconciliationDelta !== 0) {
    const largestCategoryIndex = arithmeticCategoryAmounts.reduce(
      (largest, amount, index, values) => amount > values[largest] ? index : largest,
      0
    );
    arithmeticCategoryAmounts[largestCategoryIndex] += reconciliationDelta;
  }

  const exactMinorUnits = arithmeticCategoryAmounts.map((amount) => {
    const exactValue = (amount / rate) * CURRENCY_MINOR_UNIT_SCALE;
    if (!Number.isFinite(exactValue) || exactValue > Number.MAX_SAFE_INTEGER) return exactValue;

    // Decimal values such as 1.005 are often represented a few ULPs below
    // their exact half-unit value. Normalize only that floating-point noise
    // so largest-remainder ties remain deterministic.
    const lowerUnit = Math.floor(exactValue);
    const fraction = exactValue - lowerUnit;
    const precisionTolerance = MINOR_UNIT_FRACTION_TOLERANCE;
    if (Math.abs(fraction - 0.5) <= precisionTolerance) {
      return lowerUnit + 0.5;
    }
    if (Math.abs(exactValue - Math.round(exactValue)) <= precisionTolerance) {
      return Math.round(exactValue);
    }
    return exactValue;
  });
  if (exactMinorUnits.some((amount) => !Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Currency allocation exceeds the safe minor-unit range.");
  }

  const allocatedMinorUnits = exactMinorUnits.map((amount) => Math.floor(amount));
  let remainingMinorUnits = targetMinorUnits - allocatedMinorUnits.reduce((sum, amount) => sum + amount, 0);

  if (remainingMinorUnits < 0 || remainingMinorUnits > categoryAmountsInINR.length) {
    throw new RangeError("Category amounts cannot be reconciled to the displayed total.");
  }

  const allocationOrder = exactMinorUnits
    .map((amount, index) => ({ index, remainder: amount - Math.floor(amount) }))
    .sort((left, right) => {
      const remainderDifference = right.remainder - left.remainder;
      return Math.abs(remainderDifference) <= MINOR_UNIT_FRACTION_TOLERANCE
        ? left.index - right.index
        : remainderDifference;
    });

  for (let index = 0; index < remainingMinorUnits; index++) {
    allocatedMinorUnits[allocationOrder[index].index] += 1;
  }

  return allocatedMinorUnits.map((amount) => amount / CURRENCY_MINOR_UNIT_SCALE);
};

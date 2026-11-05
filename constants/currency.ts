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

  const rounded = Math.abs(value) > Number.MAX_VALUE / 100
    ? value
    : Math.round(value * 100) / 100;

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

  return `${symbol}${safeAmount.toFixed(2)}`;
};

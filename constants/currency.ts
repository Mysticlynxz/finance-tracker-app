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

const roundCurrencyAmount = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
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
  return CURRENCY_CONFIG[normalizedCurrency];
};

export const convertFromINR = (amount: number, currency?: string) => {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount)) {
    return 0;
  }

  const { rate } = getCurrencyConfig(currency);

  if (!Number.isFinite(rate) || rate <= 0) {
    return roundCurrencyAmount(numericAmount);
  }

  return roundCurrencyAmount(numericAmount / rate);
};

export const convertToINR = (amount: number, currency?: string) => {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount)) {
    return 0;
  }

  const { rate } = getCurrencyConfig(currency);

  if (!Number.isFinite(rate) || rate <= 0) {
    return roundCurrencyAmount(numericAmount);
  }

  return roundCurrencyAmount(numericAmount * rate);
};

export const formatCurrencyAmount = (amount: number, currency?: string) => {
  const numericAmount = Number(amount);
  const safeAmount = Number.isFinite(numericAmount)
    ? roundCurrencyAmount(numericAmount)
    : 0;
  const { symbol } = getCurrencyConfig(currency);

  return `${symbol}${safeAmount.toFixed(2)}`;
};

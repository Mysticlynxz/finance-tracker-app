import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURRENCY_CONFIG,
  CURRENCY_NAMES,
  SUPPORTED_CURRENCIES,
  allocateCurrencyDisplayAmounts,
  convertFromINR,
  convertToINR,
  formatCurrencyAmount,
} from "../constants/currency.ts";

const roundToCents = (value) => Math.round(value * 100) / 100;

test("currency conversions are finite and correct for every configured currency", () => {
  for (const code of SUPPORTED_CURRENCIES) {
    const { rate, symbol } = CURRENCY_CONFIG[code];
    assert.ok(Number.isFinite(rate) && rate > 0, `${code} rate`);
    assert.ok(CURRENCY_NAMES[code], `${code} name`);
    assert.ok(symbol, `${code} symbol`);

    const fromINR = convertFromINR(12345.67, code);
    const toINR = convertToINR(123.45, code);
    assert.equal(fromINR, roundToCents(12345.67 / rate), `${code} from INR`);
    assert.equal(toINR, roundToCents(123.45 * rate), `${code} to INR`);
    assert.ok(Number.isFinite(fromINR));
    assert.ok(Number.isFinite(toINR));
  }
});

const displayedMinorUnits = (amount, currency) => {
  const formatted = formatCurrencyAmount(amount, currency);
  const numeric = Number(formatted.replace(/[^0-9.-]/g, ""));
  return Math.round(numeric * 100);
};

test("largest-remainder allocation reconciles three ₹1 categories to the USD total", () => {
  const allocated = allocateCurrencyDisplayAmounts(3, [1, 1, 1], "USD");
  assert.deepEqual(allocated, [0.02, 0.01, 0.01]);
  assert.equal(allocated.reduce((sum, amount) => sum + displayedMinorUnits(amount, "USD"), 0), displayedMinorUnits(convertFromINR(3, "USD"), "USD"));
});

test("larger fractional remainders receive residual minor units first", () => {
  const allocated = allocateCurrencyDisplayAmounts(108, [37, 36, 35], "USD");
  assert.deepEqual(allocated, [0.45, 0.43, 0.42]);
});

test("equal fractional remainders use stable input-order tie breaking", () => {
  const allocated = allocateCurrencyDisplayAmounts(111, [37, 37, 37], "USD");
  assert.deepEqual(allocated, [0.45, 0.45, 0.44]);
});

test("allocation distributes multiple residual minor units", () => {
  const amounts = [37, 37, 37];
  const allocated = allocateCurrencyDisplayAmounts(111, amounts, "USD");
  assert.equal(allocated.reduce((sum, amount) => sum + displayedMinorUnits(amount, "USD"), 0), displayedMinorUnits(convertFromINR(111, "USD"), "USD"));
});

test("single and zero spending allocations remain valid", () => {
  assert.deepEqual(allocateCurrencyDisplayAmounts(100, [100], "USD"), [1.2]);
  assert.deepEqual(allocateCurrencyDisplayAmounts(0, [0, 0], "USD"), [0, 0]);
  assert.deepEqual(allocateCurrencyDisplayAmounts(0, [], "USD"), []);
});

test("sub-cent category totals are allocated from raw amounts without independent rounding", () => {
  assert.deepEqual(allocateCurrencyDisplayAmounts(0.01, [0.005, 0.005], "INR"), [0.01, 0]);
  assert.deepEqual(allocateCurrencyDisplayAmounts(0.015, [0.005, 0.005, 0.005], "INR"), [0.01, 0.01, 0]);
  assert.deepEqual(allocateCurrencyDisplayAmounts(0.01, [0.0049, 0.0051], "INR"), [0, 0.01]);
});

test("mixed sub-cent and ordinary amounts retain total rounding and stable half-cent ties", () => {
  assert.deepEqual(allocateCurrencyDisplayAmounts(1.01, [0.005, 1.005], "INR"), [0.01, 1]);
});

test("reconciles floating-point summation noise but rejects genuine raw-total mismatch", () => {
  const noisyCategories = [0.1, 0.2];
  const rounded = allocateCurrencyDisplayAmounts(0.3, noisyCategories, "INR");
  assert.equal(rounded.reduce((sum, value) => sum + displayedMinorUnits(value, "INR"), 0), 30);
  assert.throws(
    () => allocateCurrencyDisplayAmounts(1, [0.4, 0.4], "INR"),
    /Category INR totals do not reconcile/
  );
});

test("rejects a one-paisa reconciliation mismatch even at a trillion rupees", () => {
  const total = 1_000_000_000_000;
  const categories = [999_999_999_999.99, ...Array(99).fill(0)];
  assert.throws(
    () => allocateCurrencyDisplayAmounts(total, categories, "INR"),
    /Category INR totals do not reconcile/
  );
});

test("larger minor-unit values do not widen local remainder comparisons", () => {
  const first = 10_000_000_000_000.05;
  const second = 0.004;
  const allocated = allocateCurrencyDisplayAmounts(first + second, [first, second], "INR");
  assert.equal(allocated[0], first);
  assert.equal(allocated[1], 0.01);
});

test("category display amounts reconcile to the rounded total in every configured currency", () => {
  const categoryAmounts = [1, 37, 81, 205.45, 902.13];
  const total = categoryAmounts.reduce((sum, amount) => sum + amount, 0);
  for (const currency of SUPPORTED_CURRENCIES) {
    const allocated = allocateCurrencyDisplayAmounts(total, categoryAmounts, currency);
    const categorySumMinor = allocated.reduce(
      (sum, amount) => sum + displayedMinorUnits(amount, currency),
      0
    );
    assert.equal(categorySumMinor, displayedMinorUnits(convertFromINR(total, currency), currency), currency);
  }
});

test("sub-cent category allocations reconcile across all configured currencies", () => {
  const categoryAmounts = [0.005, 0.005, 0.005, 0.005];
  const total = categoryAmounts.reduce((sum, amount) => sum + amount, 0);
  for (const currency of SUPPORTED_CURRENCIES) {
    const allocated = allocateCurrencyDisplayAmounts(total, categoryAmounts, currency);
    const categorySumMinor = allocated.reduce(
      (sum, amount) => sum + displayedMinorUnits(amount, currency),
      0
    );
    assert.equal(categorySumMinor, displayedMinorUnits(convertFromINR(total, currency), currency), currency);
  }
});

test("INR conversion is an identity at ordinary and extreme finite magnitudes", () => {
  for (const amount of [0, 0.004, 0.01, 100, 100.5, 1e307, Number.MAX_VALUE]) {
    assert.equal(convertFromINR(amount, "INR"), amount < 0.005 && amount > 0 ? 0 : amount);
    assert.equal(convertToINR(amount, "INR"), amount < 0.005 && amount > 0 ? 0 : amount);
  }
});

test("rounding preserves finite values when multiplying by 100 would overflow", () => {
  for (const amount of [1e307, 1e306, Number.MAX_VALUE]) {
    const converted = convertFromINR(amount, "INR");
    assert.equal(converted, amount);
    assert.ok(Number.isFinite(converted));
  }
  assert.equal(convertFromINR(100, "INR"), 100);
  assert.equal(convertFromINR(100.5, "INR"), 100.5);
  assert.equal(convertFromINR(0.01, "INR"), 0.01);
  assert.equal(convertFromINR(0.004, "INR"), 0);
});

test("conversion overflow never rounds to or returns zero", () => {
  for (const code of SUPPORTED_CURRENCIES) {
    const { rate } = CURRENCY_CONFIG[code];
    for (const [operation, convert] of [["to INR", convertToINR], ["from INR", convertFromINR]]) {
      const multiplier = operation === "to INR" ? rate : 1 / rate;
      if (multiplier > 1) {
        const overflowInput = Math.min(Number.MAX_VALUE, Number.MAX_VALUE / multiplier * 2);
        assert.throws(() => convert(overflowInput, code), /exceeds the finite numeric range/, `${code} ${operation}`);
      } else {
        assert.ok(Number.isFinite(convert(Number.MAX_VALUE, code)), `${code} ${operation} maximum finite input`);
      }
    }
  }
  assert.throws(() => convertToINR(Number.MAX_VALUE, "USD"), /exceeds the finite numeric range/);
  assert.throws(() => convertFromINR(Number.MAX_VALUE, "JPY"), /exceeds the finite numeric range/);
});

test("non-finite inputs are rejected while zero and negative finite values retain arithmetic behavior", () => {
  for (const invalid of [Infinity, -Infinity, NaN]) {
    assert.throws(() => convertToINR(invalid, "USD"), /requires a finite numeric amount/);
    assert.throws(() => convertFromINR(invalid, "USD"), /requires a finite numeric amount/);
    assert.throws(() => formatCurrencyAmount(invalid, "USD"), /requires a finite numeric amount/);
  }
  assert.equal(convertToINR(0, "USD"), 0);
  assert.equal(convertFromINR(0, "USD"), 0);
  assert.equal(convertToINR(-100, "USD"), -8300);
  assert.equal(convertFromINR(-8300, "USD"), -100);
});

test("near-boundary values either convert to finite results or throw without returning zero", () => {
  for (const code of SUPPORTED_CURRENCIES) {
    const { rate } = CURRENCY_CONFIG[code];
    for (const [convert, divisor] of [[convertToINR, rate], [convertFromINR, 1 / rate]]) {
      const boundary = Number.MAX_VALUE / divisor;
      const inputs = Number.isFinite(boundary)
        ? [boundary * 0.999, boundary, Math.min(Number.MAX_VALUE, boundary * 1.001)]
        : [Number.MAX_VALUE];
      for (const input of inputs) {
        try {
          const result = convert(input, code);
          assert.ok(Number.isFinite(result));
          assert.notEqual(result, 0);
        } catch (error) {
          assert.match(error.message, /exceeds the finite numeric range/);
        }
      }
    }
  }
});

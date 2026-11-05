import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURRENCY_CONFIG,
  CURRENCY_NAMES,
  SUPPORTED_CURRENCIES,
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

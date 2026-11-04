/**
 * Shared currency amount parser and validator.
 *
 * Used by both voice expense entry and manual expense entry to ensure
 * consistent validation rules across the application.
 *
 * Rules:
 * - Accepts ordinary positive decimal values (e.g. "100", "100.50", ".50").
 * - Rejects zero, negative amounts, hexadecimal, exponent notation,
 *   Infinity, NaN, and invalid characters.
 * - Trims surrounding whitespace.
 * - Returns the parsed number or null if invalid.
 */

export function parseCurrencyAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }

  // Accept ordinary decimal numbers:
  //   - Optional leading sign (+/-)
  //   - Digits with optional decimal point and fractional digits
  //   - Leading decimal point without digits (e.g. ".50")
  // Rejects hex (0x), octal (0o), binary (0b), exponent (1e5), Infinity, NaN, etc.
  const decimalRegex = /^[+-]?(\d+\.?\d*|\.\d+)$/;
  if (!decimalRegex.test(trimmed)) {
    return null;
  }

  const num = Number(trimmed);

  // Reject NaN, Infinity, -Infinity, zero, and negative values.
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }

  return num;
}

/**
 * Validates a currency amount string without parsing.
 * Returns true if the string represents a valid positive decimal amount.
 */
export function isValidCurrencyAmount(value: string): boolean {
  return parseCurrencyAmount(value) !== null;
}

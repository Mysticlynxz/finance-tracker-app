import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateDailyAmounts,
  filterItemsForMonth,
  getCalendarMonthKey,
  isBudgetMonthAhead,
  getCalendarDateKey,
  getCurrentMonthDateKeys,
} from "../lib/reportDates.ts";

test("current month day keys use Asia/Kolkata calendar boundaries", () => {
  const keys = getCurrentMonthDateKeys(new Date("2026-11-01T00:30:00+05:30"));
  assert.equal(keys[0], "2026-11-01");
  assert.equal(keys.at(-1), "2026-11-30");
  assert.equal(keys.length, 30);
});

test("canonical budget month ignores device offset and handles year and leap-month transitions", () => {
  const decemberBeforeBoundary = new Date("2026-12-31T18:29:59.000Z");
  const januaryAtBoundaryUtc = new Date("2026-12-31T18:30:00.000Z");
  assert.equal(getCalendarMonthKey(decemberBeforeBoundary), "2026-12");
  assert.equal(getCalendarMonthKey(januaryAtBoundaryUtc), "2027-01");
  for (const offsetRepresentation of [
    "2026-12-31T13:30:00-05:00",
    "2027-01-01T01:30:00+07:00",
    "2026-12-31T18:30:00Z",
  ]) {
    assert.equal(getCalendarMonthKey(new Date(offsetRepresentation)), "2027-01");
  }

  const leapDayBefore = new Date("2028-02-28T18:29:59.000Z");
  const leapDayStart = new Date("2028-02-28T18:30:00.000Z");
  assert.equal(getCalendarMonthKey(leapDayBefore), "2028-02");
  assert.equal(getCalendarMonthKey(leapDayStart), "2028-02");
  assert.equal(getCurrentMonthDateKeys(leapDayStart).length, 29);

  const marchBoundary = new Date("2028-03-31T18:30:00.000Z");
  assert.equal(getCalendarMonthKey(marchBoundary), "2028-04");
  assert.equal(isBudgetMonthAhead("2027-01", "2026-12"), true);
  assert.equal(isBudgetMonthAhead("2026-11", "2026-12"), false);
  assert.equal(isBudgetMonthAhead("invalid", "2026-12"), false);
});

test("date keys preserve date-only calendar dates and use Kolkata days for timestamps", () => {
  assert.equal(getCalendarDateKey("2026-11-01"), "2026-11-01");
  assert.equal(getCalendarDateKey("2026-10-31T19:00:00.000Z"), "2026-11-01");
  assert.equal(getCalendarDateKey("2026-11-30T18:30:00.000Z"), "2026-12-01");
  assert.equal(getCalendarDateKey("invalid"), null);
});

test("month filter and daily totals share the same boundary and aggregate per calendar day", () => {
  const monthKeys = getCurrentMonthDateKeys(new Date("2026-11-15T12:00:00+05:30"));
  const expenses = [
    { date: "2026-10-31T18:29:59.000Z", amount: 100 },
    { date: "2026-10-31T18:30:00.000Z", amount: 10 },
    { date: "2026-10-31T19:00:00.000Z", amount: 20 },
    { date: "2026-11-30T18:29:59.000Z", amount: 30 },
    { date: "2026-11-30T18:30:00.000Z", amount: 1000 },
  ];
  const filtered = filterItemsForMonth(expenses, monthKeys);
  assert.deepEqual(filtered.map(({ amount }) => amount), [10, 20, 30]);
  assert.deepEqual(aggregateDailyAmounts(filtered, ({ amount }) => amount), [
    { x: "2026-11-01", y: 30 },
    { x: "2026-11-30", y: 30 },
  ]);
});

test("aggregation skips invalid dates and non-finite amounts", () => {
  const items = [
    { date: "invalid", amount: 50 },
    { date: "2026-11-01", amount: Infinity },
    { date: "2026-11-01", amount: 1.234 },
  ];
  assert.deepEqual(aggregateDailyAmounts(items, ({ amount }) => amount), [
    { x: "2026-11-01", y: 1.23 },
  ]);
});

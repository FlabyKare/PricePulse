import assert from "node:assert/strict";
import test from "node:test";
import {
  applyObservedPrice,
  isPriceCheckDue,
  priceNotification,
} from "../lib/price-monitor.ts";

const product = {
  id: 7,
  name: "AK-47 | Redline",
  url: "https://lis-skins.com/market/csgo/ak-47-redline-field-tested/",
  source: "LIS-SKINS",
  price: 5000,
  period: 3,
  alertMode: "amount",
  alertThreshold: 500,
  alertReferencePrice: 5000,
  priceHistory: [{ price: 5000, capturedAt: "2026-08-31T10:00:00.000Z" }],
};

test("runs the first bot check after two minutes and later checks by user period", () => {
  assert.equal(isPriceCheckDue({ ...product, alertCheckPending: true }, Date.parse("2026-08-31T10:00:01.000Z")), true);
  assert.equal(isPriceCheckDue(product, Date.parse("2026-08-31T10:01:59.000Z")), false);
  assert.equal(isPriceCheckDue(product, Date.parse("2026-08-31T10:02:00.000Z")), true);
  const checked = applyObservedPrice(product, 4900, "2026-08-31T10:02:00.000Z");
  assert.equal(isPriceCheckDue(checked, Date.parse("2026-08-31T13:01:59.000Z")), false);
  assert.equal(isPriceCheckDue(checked, Date.parse("2026-08-31T13:02:00.000Z")), true);
});

test("does not notify before the configured amount threshold in either direction", () => {
  assert.equal(priceNotification(product, 4600), null);
  assert.equal(priceNotification(product, 5399), null);

  const cheaper = priceNotification(product, 4500);
  assert.equal(cheaper?.thresholdReached, true);
  assert.equal(cheaper?.alertMode, "amount");
  assert.equal(cheaper?.alertThreshold, 500);
  assert.equal(cheaper?.deltaAmount, -500);
  assert.equal(cheaper?.percent, -10);

  const dearer = priceNotification(product, 5500);
  assert.equal(dearer?.deltaAmount, 500);
  assert.equal(dearer?.percent, 10);
});

test("accumulates movement from the last notification price instead of each check", () => {
  const observedWithoutAlert = { ...product, price: 4700, alertReferencePrice: 5000 };
  assert.equal(priceNotification(observedWithoutAlert, 4550), null);
  assert.equal(priceNotification(observedWithoutAlert, 4499)?.previous, 5000);
  assert.equal(priceNotification(observedWithoutAlert, 4499)?.deltaAmount, -501);
});

test("supports a percentage threshold", () => {
  const percentProduct = { ...product, alertMode: "percent", alertThreshold: 10 };
  assert.equal(priceNotification(percentProduct, 4550), null);
  assert.equal(priceNotification(percentProduct, 5450), null);
  assert.equal(priceNotification(percentProduct, 4500)?.percent, -10);
  assert.equal(priceNotification(percentProduct, 5500)?.percent, 10);
});

test("sends no price notification when the user did not configure a threshold", () => {
  const withoutAlert = { ...product, alertThreshold: undefined, alertReferencePrice: undefined };
  assert.equal(priceNotification(withoutAlert, 1000), null);
});

test("treats a legacy target value as an amount threshold", () => {
  const legacyProduct = { ...product, alertThreshold: undefined, alertReferencePrice: undefined, target: 500 };
  assert.equal(priceNotification(legacyProduct, 4600), null);
  assert.equal(priceNotification(legacyProduct, 4500)?.alertMode, "amount");
});

test("stores every observed price without changing the alert reference", () => {
  const updated = applyObservedPrice(product, 4600, "2026-08-31T10:02:00.000Z");
  assert.equal(updated.price, 4600);
  assert.equal(updated.oldPrice, 5000);
  assert.equal(updated.change, -8);
  assert.equal(updated.alertReferencePrice, 5000);
});
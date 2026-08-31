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
  target: 4700,
  priceHistory: [{ price: 5000, capturedAt: "2026-08-31T10:00:00.000Z" }],
};

test("runs the first bot check after two minutes and later checks by user period", () => {
  assert.equal(isPriceCheckDue({ ...product, targetCheckPending: true }, Date.parse("2026-08-31T10:00:01.000Z")), true);
  assert.equal(isPriceCheckDue(product, Date.parse("2026-08-31T10:01:59.000Z")), false);
  assert.equal(isPriceCheckDue(product, Date.parse("2026-08-31T10:02:00.000Z")), true);
  const checked = applyObservedPrice(product, 4900, "2026-08-31T10:02:00.000Z");
  assert.equal(isPriceCheckDue(checked, Date.parse("2026-08-31T13:01:59.000Z")), false);
  assert.equal(isPriceCheckDue(checked, Date.parse("2026-08-31T13:02:00.000Z")), true);
});

test("creates a Telegram notification for a change and a reached target", () => {
  const notification = priceNotification(product, 4600);
  assert.equal(notification?.targetReached, true);
  assert.equal(notification?.priceChanged, true);
  assert.equal(notification?.percent, -8);
  const updated = applyObservedPrice(product, 4600, "2026-08-31T10:02:00.000Z");
  assert.equal(updated.price, 4600);
  assert.equal(updated.oldPrice, 5000);
  assert.equal(updated.change, -8);
});

test("ignores price noise that would be displayed as zero percent", () => {
  const expensiveProduct = {
    ...product,
    price: 174_817.6,
    target: 4500,
    priceHistory: [
      { price: 174_817.6, capturedAt: "2026-08-31T10:00:00.000Z" },
      { price: 174_817.6, capturedAt: "2026-08-31T13:00:00.000Z" },
    ],
  };
  assert.equal(priceNotification(expensiveProduct, 174_818.2), null);
  assert.equal(priceNotification(expensiveProduct, 174_900), null);
});

test("always notifies when the configured target is crossed", () => {
  const nearTarget = {
    ...product,
    price: 4500.2,
    target: 4500,
    priceHistory: [
      { price: 4510, capturedAt: "2026-08-31T10:00:00.000Z" },
      { price: 4500.2, capturedAt: "2026-08-31T13:00:00.000Z" },
    ],
  };
  const notification = priceNotification(nearTarget, 4499.9);
  assert.equal(notification?.targetReached, true);
  assert.equal(notification?.priceChanged, false);
  assert.equal(notification?.percent, 0);

  const alreadyAlerted = { ...nearTarget, price: 4499.9, targetAlerted: true };
  assert.equal(priceNotification(alreadyAlerted, 4499.8), null);
  assert.equal(priceNotification({ ...alreadyAlerted, price: 4510 }, 4490)?.targetReached, true);
});

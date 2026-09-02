import assert from "node:assert/strict";
import test from "node:test";

import { shouldDismissSheetDrag } from "../lib/sheet-gesture.ts";

test("dismisses the product sheet after a deliberate downward drag", () => {
  assert.equal(shouldDismissSheetDrag(96, 800), true);
  assert.equal(shouldDismissSheetDrag(70, 800), false);
});

test("dismisses the product sheet after a quick downward flick", () => {
  assert.equal(shouldDismissSheetDrag(42, 60), true);
  assert.equal(shouldDismissSheetDrag(30, 30), false);
  assert.equal(shouldDismissSheetDrag(-120, 100), false);
});
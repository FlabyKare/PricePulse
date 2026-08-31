import assert from "node:assert/strict";
import test from "node:test";
import { mergeProfileRecords } from "../lib/profile-state.ts";

test("merges products added on two Telegram devices without losing either card", () => {
  const server = [{ id: 1, name: "Телефон" }, { id: 2, name: "Облако" }];
  const desktop = [{ id: 1, name: "ПК обновил карточку" }, { id: 3, name: "ПК добавил" }];
  assert.deepEqual(mergeProfileRecords(server, desktop), [
    { id: 1, name: "ПК обновил карточку" },
    { id: 3, name: "ПК добавил" },
    { id: 2, name: "Облако" },
  ]);
});

test("keeps an explicit Telegram-profile deletion during a merge", () => {
  const server = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(mergeProfileRecords(server, [{ id: 2 }], [1]), [{ id: 2 }]);
});

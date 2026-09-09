import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { containsSensitiveIdentifier } from "../lib/privacy.ts";

test("blocks personal identifiers before external AI processing", () => {
  assert.equal(containsSensitiveIdentifier("монитор 27 дюймов до 30000 рублей"), false);
  assert.equal(containsSensitiveIdentifier("напиши мне test@example.com"), true);
  assert.equal(containsSensitiveIdentifier("карта 4276 1234 5678 9012"), true);
  assert.equal(containsSensitiveIdentifier("паспорт 1234 567890"), true);
});

test("privacy hardening stays wired into production sources", async () => {
  const [telegramAuth, privateAccess, profileRoute, assistantRoute, discoverRoute, layout, legalPage, genericInvestments] = await Promise.all([
    readFile(new URL("../lib/telegram-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/private-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/discover/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/investments/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(privateAccess, /!== "public"/);
  assert.match(telegramAuth, /private_access_required/);
  assert.match(telegramAuth, /ALLOWED_TELEGRAM_USER_IDS/);
  assert.match(profileRoute, /x-pricepulse-profile-consent/);
  assert.match(profileRoute, /export async function DELETE/);
  assert.match(profileRoute, /firstName: "Telegram user"/);
  assert.match(profileRoute, /username: null/);
  assert.match(assistantRoute, /zdr: true/);
  assert.match(assistantRoute, /data_collection: "deny"/);
  assert.match(discoverRoute, /containsSensitiveIdentifier/);
  assert.match(layout, /index: false/);
  assert.match(legalPage, /закрытого персонального использования|непубличный, некоммерческий/i);
  assert.match(genericInvestments, /status: 410/);
});
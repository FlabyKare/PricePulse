import assert from "node:assert/strict";
import test from "node:test";
import { verifyTelegramInitData } from "../lib/telegram-init-data.ts";

const encoder = new TextEncoder();
const botToken = "123456789:test-secret";

async function signedInitData({ authDate = 1_800_000_000, firstName = "Артём" } = {}) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAExampleQuery",
    user: JSON.stringify({
      id: 987654321,
      first_name: firstName,
      username: "pricepulse_test",
      language_code: "ru",
    }),
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const webAppKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", webAppKey, encoder.encode(botToken));
  const validationKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", validationKey, encoder.encode(checkString)));
  params.set("hash", [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
  return params.toString();
}

test("authenticates a Telegram Mini App profile from signed initData", async () => {
  const raw = await signedInitData();
  const profile = await verifyTelegramInitData(raw, {
    botToken,
    now: 1_800_000_300,
  });
  assert.equal(profile?.id, "987654321");
  assert.equal(profile?.firstName, "Артём");
  assert.equal(profile?.username, "pricepulse_test");
});

test("rejects tampered and expired Telegram initData", async () => {
  const raw = await signedInitData();
  assert.equal(await verifyTelegramInitData(raw.replace("pricepulse_test", "attacker"), {
    botToken,
    now: 1_800_000_300,
  }), null);
  assert.equal(await verifyTelegramInitData(raw, {
    botToken,
    now: 1_800_100_000,
  }), null);
});

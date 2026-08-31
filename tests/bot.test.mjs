import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppKeyboard,
  handleUpdate,
  normalizeWebAppUrl,
  parseCommand,
  runPriceMonitor,
} from "../bot/telegram.mjs";

test("parses Telegram commands with an optional bot username", () => {
  assert.equal(parseCommand("/start"), "start");
  assert.equal(parseCommand("/APP@price_pulce_bot payload"), "app");
  assert.equal(parseCommand("обычное сообщение"), null);
});

test("accepts only secure Mini App URLs", () => {
  assert.equal(normalizeWebAppUrl("https://example.com/"), "https://example.com");
  assert.throws(() => normalizeWebAppUrl("http://example.com"), /HTTPS/);
});

test("builds a Telegram Web App keyboard", () => {
  assert.deepEqual(buildAppKeyboard("https://example.com"), {
    inline_keyboard: [[{ text: "Открыть PricePulse", web_app: { url: "https://example.com" } }]],
  });
});

test("answers /start with the Mini App button", async () => {
  const calls = [];
  const client = { call: async (...args) => calls.push(args) };

  const handled = await handleUpdate({
    client,
    webAppUrl: "https://example.com",
    update: { update_id: 1, message: { text: "/start", chat: { id: 42 } } },
  });

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "sendMessage");
  assert.equal(calls[0][1].chat_id, 42);
  assert.equal(calls[0][1].reply_markup.inline_keyboard[0][0].web_app.url, "https://example.com");
});

test("triggers the protected price monitor with the bot token", async () => {
  const calls = [];
  const result = await runPriceMonitor({
    token: "123:secret",
    webAppUrl: "https://example.com/",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ ok: true, checked: 2, notified: 1 });
    },
  });
  assert.equal(result.notified, 1);
  assert.equal(calls[0].url, "https://example.com/api/notifications/run");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer 123:secret");
});
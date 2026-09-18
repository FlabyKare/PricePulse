import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppKeyboard,
  handleUpdate,
  normalizeWebAppUrl,
  parseCommand,
  runBotAction,
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

function botMessage(text, userId = 42) {
  return { update_id: 8, message: { text, chat: { id: userId, type: "private" }, from: { id: userId } } };
}

test("chat commands use the Telegram ID and shared profile actions", async () => {
  const calls = [];
  const actions = [];
  const client = { call: async (...args) => calls.push(args) };
  const runAction = async (action, payload) => {
    actions.push({ action, payload });
    if (action === "add") return { product: { id: 123, name: "Монитор", source: "DNS", price: 16000 } };
    if (action === "alert") return { product: { name: "Монитор" } };
    if (action === "interval") return { product: { name: "Монитор", period: 6 } };
    if (action === "history") return { product: { name: "Монитор" }, history: [{ price: 16000, capturedAt: "2026-09-18T08:00:00.000Z" }] };
    if (action === "list") return { products: [{ id: 123, name: "Монитор", source: "DNS", price: 16000 }], total: 1 };
    return {};
  };
  for (const text of ["/agree", "/add https://dns-shop.ru/product/abc | 16000", "/alert 123 10%", "/interval 123 6", "/history 123", "/list"]) {
    assert.equal(await handleUpdate({ client, update: botMessage(text), webAppUrl: "https://example.com", runAction }), true);
  }
  assert.deepEqual(actions.map((item) => item.action), ["consent", "add", "alert", "interval", "history", "list"]);
  assert.deepEqual(actions[1].payload, { input: "https://dns-shop.ru/product/abc", manualPrice: 16000 });
  assert.deepEqual(actions[2].payload, { productId: 123, threshold: 10, mode: "percent" });
  assert.deepEqual(actions[3].payload, { productId: 123, hours: 6 });
  assert.match(calls.at(-1)[1].text, /#123/);
});

test("market search waits for explicit confirmation from the same Telegram user", async () => {
  const calls = [];
  const actions = [];
  const client = { call: async (...args) => calls.push(args) };
  const runAction = async (action, payload) => {
    actions.push({ action, payload });
    return { products: [{ name: "Монитор 27", priceLabel: "16 000 ₽", ratingLabel: "4,8", reviewCount: 100, sources: [{ kind: "магазин", verified: true, url: "https://example.com/product" }] }] };
  };
  await handleUpdate({ client, update: botMessage("/search монитор 27"), webAppUrl: "https://example.com", runAction });
  assert.equal(actions.length, 0);
  const data = calls[0][1].reply_markup.inline_keyboard[0][0].callback_data;
  await handleUpdate({
    client, webAppUrl: "https://example.com", runAction,
    update: { callback_query: { id: "cb1", data, from: { id: 43 }, message: { chat: { id: 42, type: "private" } } } },
  });
  assert.equal(actions.length, 0);
  await handleUpdate({
    client, webAppUrl: "https://example.com", runAction,
    update: { callback_query: { id: "cb2", data, from: { id: 42 }, message: { chat: { id: 42, type: "private" } } } },
  });
  assert.deepEqual(actions, [{ action: "search", payload: { query: "монитор 27" } }]);
  assert.equal(calls.at(-1)[1].reply_markup.inline_keyboard[0][0].url, "https://example.com/product");
});

test("bot action calls the protected shared API without forwarding chat history", async () => {
  const calls = [];
  await runBotAction({
    token: "123:secret", webAppUrl: "https://example.com/", userId: 42,
    action: "find", payload: { query: "монитор" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ products: [] });
    },
  });
  assert.equal(calls[0].url, "https://example.com/api/bot/action");
  assert.deepEqual(JSON.parse(calls[0].options.body), { userId: "42", action: "find", query: "монитор" });
  assert.equal(calls[0].options.headers.authorization, "Bearer 123:secret");
});

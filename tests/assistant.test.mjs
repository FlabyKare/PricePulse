import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("assistant-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const context = { waitUntil() {}, passThroughOnException() {} };

async function ask(body) {
  const worker = await loadWorker();
  return worker.fetch(new Request("http://localhost/api/assistant", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), env, context);
}

test("assistant requires external AI consent", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("External fetch must not run"); };
  try {
    const response = await ask({ question: "Стоит ли покупать сейчас?" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Подтвердите/);
  } finally { globalThis.fetch = originalFetch; }
});

test("assistant answers from product price context and public sources", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("s.jina.ai")) return Response.json({ data: [{
      title: "Обзор товара", url: "https://example.com/review", description: "Сравнение характеристик и цены.",
    }] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await ask({
      question: "Стоит ли покупать сейчас?",
      externalSearchConsent: true,
      product: {
        name: "Glock-18 | Pink DDPAT", category: "CS2", source: "LIS-SKINS", price: 6100, change: -4.2,
        offers: [{ store: "LIS-SKINS", price: 6100, url: "https://lis-skins.com/item" }, { store: "Steam", price: 7200, url: "https://steamcommunity.com/market/item" }],
      },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, "contextual");
    assert.match(body.answer, /Glock-18.*Pink DDPAT/);
    assert.match(body.answer, /Самое дешёвое.*LIS-SKINS/);
    assert.equal(body.sources[0].url, "https://example.com/review");
  } finally { globalThis.fetch = originalFetch; }
});

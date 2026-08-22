import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("discovery-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const context = { waitUntil() {}, passThroughOnException() {} };

async function discover(body) {
  const worker = await loadWorker();
  return worker.fetch(new Request("http://localhost/api/discover", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), env, context);
}

test("requires explicit consent before sending a search query externally", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("External fetch must not run"); };
  try {
    const response = await discover({ query: "наушники" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Подтвердите/);
  } finally { globalThis.fetch = originalFetch; }
});

test("rejects contact details in external search queries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("External fetch must not run"); };
  try {
    const response = await discover({ query: "найди товар test@example.com", externalSearchConsent: true });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /телефон или e-mail/);
  } finally { globalThis.fetch = originalFetch; }
});

test("builds product cards with reviews prices and multiple sources", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("suggestqueries.google.com")) {
      const bytes = new TextEncoder().encode(JSON.stringify(["наушники", ["наушники sony wh-1000xm5", "наушники jbl"]]));
      return new Response(bytes, { headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (url.includes("s.jina.ai")) {
      return Response.json({ data: [{
        title: "Sony WH-1000XM5 — обзор", url: "https://example.com/sony-review",
        description: "Рейтинг 4.8/5. Цена от 29 990 руб. Хорошее шумоподавление.",
      }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await discover({ query: "наушники", externalSearchConsent: true });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.engine, "ai-web");
    assert.ok(body.products.length >= 2);
    assert.match(body.products[0].ratingLabel, /4\.8/);
    assert.match(body.products[0].priceLabel, /29 990/);
    assert.ok(body.products[0].sources.length >= 4);
    assert.match(JSON.stringify(body.products), /Наушники sony wh-1000xm5/);
  } finally { globalThis.fetch = originalFetch; }
});


test("detects CS2 context and returns exact LIS-SKINS catalogue links", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("suggestqueries.google.com")) {
      return new Response(new TextEncoder().encode(JSON.stringify(["глок", []])), { headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (url.includes("s.jina.ai")) return Response.json({ data: [] });
    if (url.includes("market_export_json/csgo.json")) {
      return Response.json([
        { name: "Glock-18 | Pink DDPAT (Field-Tested)", price: 20.15, count: 72, url: "https://lis-skins.com/market/csgo/glock-18-pink-ddpat-field-tested/" },
        { name: "Glock-18 | Water Elemental (Factory New)", price: 60.71, count: 79, url: "https://lis-skins.com/market/csgo/glock-18-water-elemental-factory-new/" },
      ]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await discover({ query: "новый глок в кс 2 из новой коллекции розовый", externalSearchConsent: true });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.intent, "cs2");
    assert.match(body.summary, /LIS-SKINS/);
    assert.match(body.products[0].name, /Glock-18.*Pink DDPAT/);
    assert.ok(body.products[0].sources.some((source) => source.url === "https://lis-skins.com/market/csgo/glock-18-pink-ddpat-field-tested/"));
    assert.ok(body.products[0].sources.some((source) => /csfloat\.com|dmarket\.com|steamcommunity\.com/.test(source.url)));
  } finally { globalThis.fetch = originalFetch; }
});

import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("lis-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const workerEnv = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const workerContext = { waitUntil() {}, passThroughOnException() {} };

test("resolves the Titan Katowice sticker from the LIS-SKINS export", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("market_export_json/csgo.json")) {
      return Response.json([{
        name: "Sticker | Titan (Holo) | Katowice 2014",
        price: 74445.64,
        unlocked_price: 74445.64,
        url: "https://app.lis-skins.com/market/csgo/sticker-titan-holo-katowice-2014/",
        count: 1,
      }]);
    }
    if (url.includes("XML_daily.asp")) {
      return new Response('<ValCurs><Valute><CharCode>AUD</CharCode><VunitRate>59,2471</VunitRate></Valute><Valute><CharCode>USD</CharCode><VunitRate>82,9211</VunitRate></Valute></ValCurs>');
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };

  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://lis-skins.com/market/csgo/sticker-titan-holo-katowice-2014/" }),
    }), workerEnv, workerContext);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.name, "Sticker | Titan (Holo) | Katowice 2014");
    assert.equal(body.priceUsd, 74445.64);
    assert.equal(body.exchangeRate, 85.4087);
    assert.equal(body.priceRub, 6358305.33);
    assert.equal(body.count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unrelated store URLs before fetching the LIS-SKINS catalogue", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Catalogue must not be requested"); };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/product" }),
    }), workerEnv, workerContext);
    assert.equal(response.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("resolves an Ozon product from page metadata even when URL has only an id", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://www.ozon.ru/product/1883746/") {
      return new Response(
        '<html><head><meta property="og:title" content="Наушники Sony WH-1000XM5 — Ozon"></head><body><h1>Наушники Sony WH-1000XM5</h1><span>29 990 ₽</span></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.ozon.ru/product/1883746/" }),
    }), workerEnv, workerContext);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, "OZON");
    assert.equal(body.name, "Наушники Sony WH-1000XM5");
    assert.equal(body.priceRub, 29990);
    assert.equal(body.needsManualPrice, false);
    assert.equal(body.resolvedBy, "page-content");
  } finally { globalThis.fetch = originalFetch; }
});

test("keeps a user-provided name when a supported store blocks page parsing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Forbidden", { status: 403 });
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.ozon.ru/product/1883746/", name: "Sony WH-1000XM5" }),
    }), workerEnv, workerContext);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.name, "Sony WH-1000XM5");
    assert.equal(body.priceRub, null);
    assert.equal(body.needsManualPrice, true);
    assert.equal(body.resolvedBy, "safe-fallback");
  } finally { globalThis.fetch = originalFetch; }
});

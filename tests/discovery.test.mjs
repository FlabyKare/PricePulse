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
      return new Response(bytes, { headers: { "content-type": "application/json; charset=iso-8859-1" } });
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

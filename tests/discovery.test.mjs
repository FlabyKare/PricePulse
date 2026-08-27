import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("discovery-test", String(process.pid) + "-" + Date.now() + "-" + Math.random());
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

test("returns real product cards with live price rating reviews and direct sources", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("search.wb.ru")) {
      return Response.json({ products: [
        {
          id: 741076063,
          name: "Наушники беспроводные WH-1000XM5",
          brand: "Sony",
          rating: 5,
          feedbacks: 19,
          sizes: [{ price: { product: 1772000, total: 1772000 } }],
        },
        {
          id: 741076064,
          name: "Наушники WH-1000XM4",
          brand: "Sony",
          rating: 4.8,
          feedbacks: 230,
          sizes: [{ price: { product: 2299000, total: 2299000 } }],
        },
      ] });
    }
    if (url.includes("html.duckduckgo.com")) {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("отзывы обзор")) {
        return new Response(
          '<a class="result__a" href="https://www.ixbt.com/live/digs/sony-wh-1000xm5-review.html">Sony WH-1000XM5 — обзор</a>' +
          '<div class="result__snippet">Подробный тест шумоподавления и автономности.</div>',
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      return new Response(
        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.ozon.ru%2Fproduct%2Fsony-wh-1000xm5-black-123456%2F">Sony WH-1000XM5 Black</a>' +
        '<div class="result__snippet">Цена 19 990 руб. Рейтинг 4.9 из 5.</div>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    throw new Error("Unexpected URL: " + url);
  };
  try {
    const response = await discover({ query: "Sony WH-1000XM5 до 30 000", externalSearchConsent: true });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.engine, "live-market");
    assert.ok(body.products.length >= 1);
    assert.match(body.products[0].priceLabel, /17.?720|19.?990/);
    assert.match(body.products[0].ratingLabel, /5\.0|4\.9/);
    assert.ok(body.products[0].sources.some((source) => source.url === "https://www.wildberries.ru/catalog/741076063/detail.aspx"));
    assert.ok(body.products[0].sources.some((source) => source.url.includes("ozon.ru/product/sony-wh-1000xm5")));
    assert.ok(body.products.some((product) => product.sources.some((source) => source.url.includes("ixbt.com/live/"))));
    assert.ok(body.products.every((product) => product.sources.every((source) => source.verified === true && source.kind !== "поиск" && !source.url.includes("/search"))));
  } finally { globalThis.fetch = originalFetch; }
});

test("detects CS2 context and returns exact catalogue and Steam item links", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("market_export_json/csgo.json")) {
      return Response.json([
        { name: "Glock-18 | Pink DDPAT (Field-Tested)", price: 20.15, count: 72, url: "https://lis-skins.com/market/csgo/glock-18-pink-ddpat-field-tested/" },
        { name: "Glock-18 | Water Elemental (Factory New)", price: 60.71, count: 79, url: "https://lis-skins.com/market/csgo/glock-18-water-elemental-factory-new/" },
      ]);
    }
    throw new Error("Unexpected URL: " + url);
  };
  try {
    const response = await discover({ query: "новый глок в кс 2 из новой коллекции розовый", externalSearchConsent: true });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.engine, "cs2-live-catalog");
    assert.equal(body.intent, "cs2");
    assert.match(body.summary, /LIS-SKINS/);
    assert.match(body.products[0].name, /Glock-18.*Pink DDPAT/);
    assert.ok(body.products[0].sources.some((source) => source.url === "https://lis-skins.com/market/csgo/glock-18-pink-ddpat-field-tested/"));
    assert.ok(body.products[0].sources.some((source) => source.url.includes("steamcommunity.com/market/listings/730/Glock-18%20%7C%20Pink%20DDPAT")));
    assert.ok(body.products[0].sources.every((source) => source.verified === true));
  } finally { globalThis.fetch = originalFetch; }
});

test("returns an honest error instead of fabricated marketplace search links", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  try {
    const response = await discover({ query: "редкая кофемашина неизвестной модели", externalSearchConsent: true });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.error, /подтверждённые карточки/);
    assert.equal(body.products, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

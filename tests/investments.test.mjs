import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("cs2-investments-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

test("ranks concrete CS2 items with live price context and risks", async () => {
  const originalFetch = globalThis.fetch;
  const catalogue = [
    { name: "Sticker | Natus Vincere (Holo) | Stockholm 2021", price: 124.5, unlocked_price: 121, count: 23, url: "https://lis-skins.com/market/csgo/sticker-natus-vincere-holo-stockholm-2021/" },
    { name: "Sticker | Titan (Holo) | Katowice 2014", price: 72000, unlocked_price: 71500, count: 1, url: "https://lis-skins.com/market/csgo/sticker-titan-holo-katowice-2014/" },
    { name: "Stockholm 2021 Legends Sticker Capsule", price: 3.1, unlocked_price: 3, count: 84, url: "https://lis-skins.com/market/csgo/stockholm-2021-legends-sticker-capsule/" },
    { name: "Recoil Case", price: 0.43, unlocked_price: 0.41, count: 940, url: "https://lis-skins.com/market/csgo/recoil-case/" },
    { name: "AK-47 | Redline (Field-Tested)", price: 36.2, unlocked_price: 35, count: 61, url: "https://lis-skins.com/market/csgo/ak-47-redline-field-tested/" },
    { name: "AWP | Asiimov (Field-Tested)", price: 134, unlocked_price: 131, count: 18, url: "https://lis-skins.com/market/csgo/awp-asiimov-field-tested/" },
    { name: "Glock-18 | Water Elemental (Field-Tested)", price: 17.7, unlocked_price: 17.2, count: 37, url: "https://lis-skins.com/market/csgo/glock-18-water-elemental-field-tested/" },
  ];

  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("market_export_json/csgo.json")) return Response.json(catalogue);
    if (url.includes("s.jina.ai")) return Response.json({ data: [
      { title: "Counter-Strike update and tournament news", url: "https://www.counter-strike.net/news", description: "Official CS2 update, collection and tournament news." },
      { title: "Steam Community Market liquidity", url: "https://steamcommunity.com/market/search?appid=730", description: "Listings and market activity for Counter-Strike 2 items." },
      { title: "CS2 item price history", url: "https://steamanalyst.com/", description: "Public price history and liquidity context." },
    ] });
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("http://localhost/api/cs2-investments"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.mode, "live-cs2-market");
    assert.ok(body.ideas.length >= 4);
    assert.ok(body.ideas.some((idea) => idea.name === "AK-47 | Redline (Field-Tested)"));
    assert.ok(body.ideas.some((idea) => idea.itemType === "Наклейка"));
    assert.ok(body.ideas.some((idea) => idea.itemType === "Кейс / капсула"));
    assert.ok(body.ideas.every((idea) => Number.isFinite(idea.potentialScore)));
    assert.ok(body.ideas.every((idea) => idea.sourceUrls.some((url) => url.includes("steamcommunity.com/market/listings/730/"))));
    assert.match(body.methodology, /не является вероятностью|не вероятность/i);
    assert.match(body.disclaimer, /CS2|предмет/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

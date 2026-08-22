import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("rates-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const context = { waitUntil() {}, passThroughOnException() {} };

test("returns current USD and EUR rates from the CBR feed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("XML_daily.asp")) {
      return new Response(`
        <ValCurs>
          <Valute><Nominal>1</Nominal><CharCode>USD</CharCode><Value>82,9211</Value><VunitRate>82,9211</VunitRate></Valute>
          <Valute><Nominal>1</Nominal><CharCode>EUR</CharCode><Value>97,4321</Value><VunitRate>97,4321</VunitRate></Valute>
        </ValCurs>
      `);
    }
    return originalFetch(input);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/rates"), env, context);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.base, "RUB");
    assert.equal(body.rates.USD, 82.9211);
    assert.equal(body.rates.EUR, 97.4321);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

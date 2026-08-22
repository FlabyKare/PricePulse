import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("investments-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

test("builds risk-labelled market themes from public sources", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("s.jina.ai")) return Response.json({ data: [
      { title: "Банк России: ставка и облигации", url: "https://example.com/rates", description: "Ставка, доходность облигаций и финансовый рынок." },
      { title: "Золото и нефть", url: "https://example.com/gold", description: "Новости золота, нефти и сырьевых рынков." },
      { title: "Новости компаний и акций", url: "https://example.com/stocks", description: "Акции, отчётность компаний и биржевые индексы." },
    ] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/investments"), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, "public-sources");
    assert.ok(body.ideas.length >= 4);
    assert.ok(body.ideas.every((idea) => ["низкий", "средний", "высокий"].includes(idea.risk)));
    assert.ok(body.sources.some((source) => source.url === "https://example.com/rates"));
    assert.match(body.disclaimer, /не индивидуальная инвестиционная рекомендация/i);
  } finally { globalThis.fetch = originalFetch; }
});

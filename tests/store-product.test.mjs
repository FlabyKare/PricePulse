import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("store-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const workerEnv = {
  PRICEPULSE_ACCESS_MODE: "public",
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const workerContext = { waitUntil() {}, passThroughOnException() {} };

test("resolves a product from generic JSON-LD on an arbitrary public HTTPS store", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://shop.example.com/products/headphones-123") {
      return new Response(`<!doctype html><html><head>
        <meta property="og:title" content="Наушники Example Pro">
        <meta property="og:image" content="https://cdn.example.com/headphones.jpg">
        <script type="application/ld+json">{"@type":"Product","name":"Наушники Example Pro","offers":{"@type":"Offer","price":"24990","priceCurrency":"RUB"}}</script>
      </head></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://shop.example.com/products/headphones-123" }),
    }), workerEnv, workerContext);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, "SHOP");
    assert.equal(body.name, "Наушники Example Pro");
    assert.equal(body.priceRub, 24990);
    assert.equal(body.needsManualPrice, false);
    assert.equal(body.resolvedBy, "page-content");
    assert.equal(body.imageUrl, "https://cdn.example.com/headphones.jpg");
  } finally { globalThis.fetch = originalFetch; }
});

test("resolves the exact DNS product but never substitutes a stale third-party price", async () => {
  const originalFetch = globalThis.fetch;
  const shortUrl = "https://www.dns-shop.ru/product/b58aaa7e00a9d582";
  const productUrl = "https://www.dns-shop.ru/product/b58aaa7e00a9d582/videokarta-palit-geforce-rtx-5070-infinity-3-ne75070019k9-gb2050s/";
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://www.dns-shop.ru/sitemap-products12.xml") {
      return new Response(`<urlset><url><loc>${productUrl}</loc></url></urlset>`, {
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    }
    if (url === productUrl) {
      return new Response('<html><head><script src="/__qrator/qauth.js"></script></head><body></body></html>', {
        status: 401, headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url === "https://r.jina.ai/" + productUrl) {
      return new Response("Title: Видеокарта Palit GeForce RTX 5070 Infinity 3 [NE75070019K9-GB2050S] | DNS\n\nЦена зависит от выбранного города.", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: shortUrl }),
    }), workerEnv, workerContext);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, "DNS");
    assert.match(body.name, /Palit GeForce RTX 5070 Infinity 3/i);
    assert.equal(body.url, productUrl);
    assert.equal(body.priceRub, null);
    assert.equal(body.needsManualPrice, true);
    assert.equal(body.resolvedBy, "reader-content");
  } finally { globalThis.fetch = originalFetch; }
});

test("recognizes the requested DNS monitor title even when DNS hides its regional price", async () => {
  const originalFetch = globalThis.fetch;
  const productUrl = "https://www.dns-shop.ru/product/7b1f39f10b79ce2e/27-monitor-ardor-gaming-infinity-pro-aq27h1-cernyj/";
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === productUrl) return new Response("Qrator challenge", { status: 401 });
    if (url === "https://r.jina.ai/" + productUrl) return new Response("Unavailable", { status: 451 });
    throw new Error("Unexpected outbound request: " + url);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: productUrl }),
    }), workerEnv, workerContext);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, "DNS");
    assert.equal(body.name, '27" Монитор ARDOR GAMING INFINITY PRO AQ27H1 черный');
    assert.equal(body.url, productUrl);
    assert.equal(body.priceRub, null);
    assert.equal(body.needsManualPrice, true);
    assert.equal(body.resolvedBy, "safe-fallback");
  } finally { globalThis.fetch = originalFetch; }
});

test("resolves an exact Ozon card through the guarded OpenRouter web-index fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const productUrl = "https://www.ozon.ru/product/attack-shark-igrovaya-mysh-besprovodnaya-attack-shark-r5-ultra-chernyy-matovyy-1948677209/";
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === productUrl) return new Response("Forbidden", { status: 403 });
    if (url === "https://r.jina.ai/" + productUrl) return new Response("Unavailable", { status: 451 });
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const request = JSON.parse(String(init.body));
      assert.equal(request.tools[0].type, "openrouter:web_search");
      assert.deepEqual(request.tools[0].parameters.allowed_domains, ["ozon.ru"]);
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              name: "Беспроводная игровая мышь Attack Shark R5 Ultra",
              price_rub: 4290,
              matched_url: productUrl,
            }),
          },
        }],
      });
    }
    throw new Error("Unexpected outbound request: " + url);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: productUrl }),
    }), { ...workerEnv, OPENROUTER_API_KEY: "test-key" }, workerContext);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, "OZON");
    assert.equal(body.name, "Беспроводная игровая мышь Attack Shark R5 Ultra");
    assert.equal(body.priceRub, 4290);
    assert.equal(body.needsManualPrice, false);
    assert.equal(body.resolvedBy, "web-index");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test("resolves a Wildberries article through the first-party catalogue and converts kopecks to rubles", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://card.wb.ru/cards/v4/detail?")) {
      assert.match(url, /nm=83811644/);
      return Response.json({ products: [{
        id: 83811644,
        name: "Духи Believe me 50 мл",
        brand: "You&World",
        totalQuantity: 38,
        sizes: [{ price: { basic: 175500, product: 74200 } }],
      }] });
    }
    throw new Error("Unexpected outbound request: " + url);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "WB 83811644" }),
    }), workerEnv, workerContext);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, "WILDBERRIES");
    assert.equal(body.priceRub, 742);
    assert.equal(body.name, "You&World · Духи Believe me 50 мл");
    assert.equal(body.url, "https://www.wildberries.ru/catalog/83811644/detail.aspx");
    assert.equal(body.needsManualPrice, false);
    assert.equal(body.resolvedBy, "official-catalogue");
  } finally { globalThis.fetch = originalFetch; }
});

test("accepts an Ozon article and reads the exact product from composer widgets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.ozon.ru/composer-api.bx/page/json/v2?")) {
      return Response.json({ widgetStates: {
        "webProductHeading-1": JSON.stringify({ title: "Игровая мышь Attack Shark R5 Ultra" }),
        "webPrice-1": JSON.stringify({ finalPrice: "4 290 ₽" }),
      } });
    }
    throw new Error("Unexpected outbound request: " + url);
  };
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Ozon 1948677209" }),
    }), workerEnv, workerContext);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, "OZON");
    assert.equal(body.name, "Игровая мышь Attack Shark R5 Ultra");
    assert.equal(body.priceRub, 4290);
    assert.equal(body.url, "https://www.ozon.ru/product/1948677209/");
    assert.equal(body.needsManualPrice, false);
    assert.equal(body.resolvedBy, "official-catalogue");
  } finally { globalThis.fetch = originalFetch; }
});

test("rejects local and non-HTTPS arbitrary URLs before fetching", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unsafe URL must not be fetched"); };
  try {
    const worker = await loadWorker();
    for (const url of ["http://shop.example.com/product", "https://127.0.0.1/product", "https://service.local/product"]) {
      const response = await worker.fetch(new Request("http://localhost/api/products/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }), workerEnv, workerContext);
      assert.equal(response.status, 400);
    }
  } finally { globalThis.fetch = originalFetch; }
});

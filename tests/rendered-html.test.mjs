import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the PricePulse product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>PricePulse/);
  assert.match(html, /Следи за ценой/);
  assert.match(html, /LIS-SKINS/);
  assert.match(html, /Добавить товар/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("removes the temporary starter preview", async () => {
  const [css, page, aiViews, discoverRoute, cs2InvestmentsRoute, resolveRoute, profileRoute, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ai-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/discover/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cs2-investments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/products/resolve/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /PricePulse/);
  assert.match(page, /localStorage/);
  assert.match(page, /deleteProduct/);
  assert.match(page, /CollectionDetailsModal/);
  assert.match(page, /onOpen/);
  assert.match(page, /revision: profileRevision\.current/);
  assert.match(page, /response\.status === 409/);
  assert.match(page, /pendingProductDeletions/);
  assert.match(page, /collection-card-open/);
  assert.match(profileRoute, /unexpectedlyMissing/);
  assert.match(profileRoute, /deletedProductIds/);
  assert.match(profileRoute, /stored\.revision !== state\.revision/);
  assert.match(profileRoute, /profileStates\.revision\} \+ 1/);
  assert.match(page, /ИИ-поиск/);
  assert.match(aiViews, /enterKeyHint="search"/);
  assert.match(aiViews, /Разрешить и продолжить/);
  assert.match(aiViews, /pricepulse-external-search-consent/);
  assert.match(aiViews, /AI-КОНСУЛЬТАНТ ПО ПОКУПКЕ/);
  assert.match(aiViews, /найденные прямые страницы товаров/);
  assert.match(aiViews, /CS2 ИНВЕСТ-РАДАР/);
  assert.match(aiViews, /offline-cs2-watchlist/);
  assert.ok(aiViews.includes("/api/cs2-investments"));
  assert.match(page, /InvestmentsView/);
  assert.match(page, /x-telegram-init-data/);
  assert.match(page, /TELEGRAM ACCOUNT/);
  assert.match(page, /pricepulse-currency/);
  assert.match(page, /\/api\/rates/);
  assert.match(page, /Обновить все цены/);
  assert.match(page, /проверяются по содержимому страницы/);
  assert.match(page, /resolveStoreProduct/);
  assert.match(page, /MIN_FORECAST_POINTS = 3/);
  assert.match(page, /ДОВЕРИЕ МОДЕЛИ/);
  assert.match(page, /aria-expanded={forecastOpen}/);
  assert.match(page, /priceHistory: appendPriceObservation/);
  assert.doesNotMatch(page, /const chartValues = \[56, 48, 52/);
  assert.match(page, /product\.imageUrl && <img/);
  assert.match(resolveRoute, /steamcommunity\.com\/market\/listings\/730/);
  assert.match(resolveRoute, /imageFromPage/);
  assert.match(page, /OpenRouter-ready/);
  assert.match(css, /profile-sync-badge/);
  assert.match(css, /\.primary-button[^}]*display:\s*inline-flex/s);
  assert.match(css, /currency-switch/);
  assert.match(css, /product-art\.has-preview/);
  assert.match(css, /forecast-method/);
  assert.ok(css.includes(".app-shell { min-height: 100vh; color: var(--ink);"));
  assert.ok(css.includes("--surface: #151713"));
  assert.ok(css.includes("background: var(--preview-surface)"));
  assert.ok(page.includes('"--surface": palette.surface'));
  assert.ok(page.includes('"--muted": `color-mix'));
  assert.match(page, /id: "forest".*paper: "#07140e".*ink: "#e7f5ea".*card: "#0c1f16"/);
  assert.match(css, /\.discovery-search input[^}]*font-size:\s*16px/s);
  assert.match(discoverRoute, /steamcommunity\.com\/market\/listings\/730/);
  assert.match(discoverRoute, /lis-skins\.com\/market_export_json\/csgo\.json/);
  assert.match(discoverRoute, /csfloat\.com\/search/);
  assert.match(discoverRoute, /search\.wb\.ru\/exactmatch/);
  assert.match(discoverRoute, /html\.duckduckgo\.com/);
  assert.match(discoverRoute, /s\.jina\.ai/);
  assert.match(discoverRoute, /jinaSearch/);
  assert.doesNotMatch(discoverRoute, /marketplaceFallback|Поиск по сайтам магазинов|ozon\.ru\/search/);
  assert.match(layout, /title: "PricePulse/);
  assert.match(layout, /telegram-web-app\.js/);
  assert.match(page, /body\.profile!\.username \?\? current\?\.username/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});

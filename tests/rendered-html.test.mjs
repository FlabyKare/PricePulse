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
  const [css, page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /PricePulse/);
  assert.match(page, /localStorage/);
  assert.match(page, /deleteProduct/);
  assert.match(page, /ИИ-поиск/);
  assert.match(page, /enterKeyHint="search"/);
  assert.match(page, /Разрешить и найти/);
  assert.match(page, /pricepulse-external-search-consent/);
  assert.match(css, /\.discovery-search input[^}]*font-size:\s*16px/s);
  assert.match(page, /steamcommunity\.com\/market\/search\?appid=730/);
  assert.match(page, /market\.csgo\.com\/en/);
  assert.match(layout, /title: "PricePulse/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});

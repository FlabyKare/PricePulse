import { requirePrivateTelegramAccess } from "@/lib/private-access";
import { imageFromPage, parseMarketplaceArticle, resolveMarketplaceArticle, resolveStoreProduct } from "@/lib/store-product";
import { dnsRegionByCode } from "@/lib/dns-regions";

import {
  findLisSkinsItem,
  getLisSkinsSlug,
  parseCbrUsdRate,
  rubPriceFromUsd,
  type LisSkinsExportItem,
} from "@/lib/lis-skins";

const LIS_EXPORT_URL = "https://lis-skins.com/market_export_json/csgo.json";
const CBR_RATES_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const CACHE_TTL_MS = 5 * 60 * 1000;
const LIS_RATE_SURCHARGE = 1.03;
const FALLBACK_USD_RUB_RATE = 85.37;
const PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let catalogueCache: { items: LisSkinsExportItem[]; expiresAt: number } | null = null;
let rateCache: { value: number; expiresAt: number } | null = null;
const previewCache = new Map<string, { value: string | null; expiresAt: number }>();

async function readResponsePrefix(response: Response, maxBytes = 96 * 1024) {
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - received;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      received += chunk.byteLength;
      output += decoder.decode(chunk, { stream: received < maxBytes });
      if (received >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    output += decoder.decode();
  }
  return output;
}

async function getSteamPreview(productName: string) {
  const cacheKey = productName.toLocaleLowerCase("en");
  const cached = previewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const listingUrl = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(productName)}`;
    const response = await fetch(listingUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; PricePulse/2.0; +https://pricepulse-app.bokcerkbr.chatgpt.site)",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Steam Market вернул ошибку ${response.status}`);
    const imageUrl = imageFromPage(await readResponsePrefix(response), listingUrl);
    const host = imageUrl ? new URL(imageUrl).hostname.toLocaleLowerCase("en") : "";
    const value = host === "community.steamstatic.com" || host.endsWith(".steamstatic.com") ? imageUrl : null;
    previewCache.set(cacheKey, { value, expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS });
    return value;
  } catch {
    previewCache.set(cacheKey, { value: null, expiresAt: Date.now() + 15 * 60 * 1000 });
    return null;
  }
}

async function getCatalogue() {
  if (catalogueCache && catalogueCache.expiresAt > Date.now()) return catalogueCache.items;
  const response = await fetch(LIS_EXPORT_URL, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`LIS-SKINS вернул ошибку ${response.status}`);
  const items = await response.json() as LisSkinsExportItem[];
  if (!Array.isArray(items)) throw new Error("LIS-SKINS вернул данные неизвестного формата");
  catalogueCache = { items, expiresAt: Date.now() + CACHE_TTL_MS };
  return items;
}

async function getUsdRubRate() {
  const configuredRate = Number(process.env.LIS_USD_RUB_RATE);
  if (Number.isFinite(configuredRate) && configuredRate > 0) return configuredRate;
  if (rateCache && rateCache.expiresAt > Date.now()) return rateCache.value;
  try {
    const response = await fetch(CBR_RATES_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Курс ЦБ недоступен");
    const cbrRate = parseCbrUsdRate(await response.text());
    if (!cbrRate) throw new Error("Курс USD не найден");
    const value = Math.round(cbrRate * LIS_RATE_SURCHARGE * 10000) / 10000;
    rateCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    return FALLBACK_USD_RUB_RATE;
  }
}

export async function POST(request: Request) {
  const accessDenied = await requirePrivateTelegramAccess(request);
  if (accessDenied) return accessDenied;
  let body: { input?: unknown; url?: unknown; name?: unknown; region?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "Передайте ссылку или артикул товара" }, { status: 400 }); }
  const input = typeof body.input === "string" ? body.input.trim() : typeof body.url === "string" ? body.url.trim() : "";
  if (!input) return Response.json({ error: "Передайте ссылку или артикул товара" }, { status: 400 });

  const articleReference = parseMarketplaceArticle(input);
  if (articleReference) {
    try {
      const product = await resolveMarketplaceArticle(articleReference, typeof body.name === "string" ? body.name : "");
      if (!product) return Response.json({ error: "Товар с таким артикулом не найден" }, { status: 404 });
      return Response.json(product, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось проверить артикул";
      return Response.json({ error: message }, { status: 502 });
    }
  }

  let url: URL;
  try {
    url = new URL(input);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    return Response.json({ error: "Укажите HTTPS-ссылку либо артикул в формате «WB 123456789» или «Ozon 123456789»" }, { status: 400 });
  }

  try {
    const isLis = /(^|\.)lis-skins\.com$/i.test(url.hostname);
    if (!isLis) {
      const requestedRegion = typeof body.region === "string" ? body.region : "";
      if (requestedRegion && !dnsRegionByCode(requestedRegion)) {
        return Response.json({ error: "Выберите регион из списка" }, { status: 400 });
      }
      const product = await resolveStoreProduct(url, typeof body.name === "string" ? body.name : "", requestedRegion);
      return Response.json(product, { headers: { "cache-control": "no-store" } });
    }

    getLisSkinsSlug(url.href);
    const item = findLisSkinsItem(await getCatalogue(), url.href);
    if (!item || !Number.isFinite(item.price) || item.price <= 0) {
      return Response.json({ error: "Товар не найден в актуальном каталоге LIS-SKINS" }, { status: 404 });
    }
    const [exchangeRate, imageUrl] = await Promise.all([getUsdRubRate(), getSteamPreview(item.name)]);
    return Response.json({
      source: "LIS-SKINS",
      name: item.name,
      url: item.url,
      priceUsd: item.price,
      priceRub: rubPriceFromUsd(item.price, exchangeRate),
      exchangeRate,
      count: item.count,
      approximate: true,
      needsManualPrice: false,
      imageUrl,
      resolvedBy: "official-catalogue",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось проверить товар";
    const status = /ссылк|HTTPS|раздела market|не поддерживает/i.test(message) ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

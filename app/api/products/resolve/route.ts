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

type StoreDefinition = { source: string; domains: string[] };
const SUPPORTED_STORES: StoreDefinition[] = [
  { source: "OZON", domains: ["ozon.ru"] },
  { source: "ЯНДЕКС МАРКЕТ", domains: ["market.yandex.ru"] },
  { source: "WILDBERRIES", domains: ["wildberries.ru", "wb.ru"] },
  { source: "DNS", domains: ["dns-shop.ru"] },
  { source: "М.ВИДЕО", domains: ["mvideo.ru"] },
  { source: "СИТИЛИНК", domains: ["citilink.ru"] },
  { source: "LAMODA", domains: ["lamoda.ru"] },
  { source: "ЗОЛОТОЕ ЯБЛОКО", domains: ["goldapple.ru"] },
  { source: "ЛЭТУАЛЬ", domains: ["letu.ru"] },
  { source: "AVITO", domains: ["avito.ru"] },
  { source: "HOFF", domains: ["hoff.ru"] },
  { source: "ВСЕИНСТРУМЕНТЫ", domains: ["vseinstrumenti.ru"] },
  { source: "EXIST", domains: ["exist.ru"] },
  { source: "EMEX", domains: ["emex.ru"] },
  { source: "AUTODOC", domains: ["autodoc.ru"] },
];

let catalogueCache: { items: LisSkinsExportItem[]; expiresAt: number } | null = null;
let rateCache: { value: number; expiresAt: number } | null = null;

function clean(value: string, limit = 180) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`#[\]]/g, " ")
    .replace(/&(?:amp|quot|apos);/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function storeFor(url: URL) {
  const host = url.hostname.toLocaleLowerCase("en").replace(/^www\./, "");
  return SUPPORTED_STORES.find((store) => store.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) ?? null;
}

function inferredNameFromUrl(url: URL) {
  const generic = /^(?:product|products|catalog|catalogue|item|detail|details|search|p|shop|store|index|default|detail\.aspx)$/i;
  for (const raw of url.pathname.split("/").filter(Boolean).reverse()) {
    let part = clean(decodeURIComponent(raw), 140)
      .replace(/\.(?:html?|aspx?)$/i, "")
      .replace(/[-_]?\d{5,}(?:[-_].*)?$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (!part || generic.test(part) || /^\d+$/.test(part) || !/[\p{L}]{3}/u.test(part)) continue;
    part = part.replace(/\b(?:kupit|buy|cena|price)\b.*$/i, "").trim();
    if (part) return part.charAt(0).toLocaleUpperCase("ru") + part.slice(1);
  }
  for (const key of ["text", "q", "query", "search"]) {
    const value = clean(url.searchParams.get(key) ?? "", 140);
    if (value) return value.charAt(0).toLocaleUpperCase("ru") + value.slice(1);
  }
  return "";
}

function decodeEntities(value: string) {
  return value
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function titleFromPage(html: string) {
  const candidates = [
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1],
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1],
    html.match(/"name"\s*:\s*"([^"]{3,180})"/i)?.[1],
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const title = clean(decodeEntities(candidate))
      .replace(/\s*(?:\||—|–|-)+\s*(?:Ozon|Wildberries|Яндекс Маркет|DNS|М\.Видео|Ситилинк|Lamoda|Avito).*$/i, "")
      .replace(/\s+(?:купить|цена|отзывы)\b.*$/i, "")
      .trim();
    if (title.length >= 3 && !/^(?:ozon|wildberries|яндекс маркет|dns)$/i.test(title)) return title;
  }
  return "";
}

function rubPriceFromText(text: string) {
  const matches = [...decodeEntities(text).matchAll(/(?:^|[^\d])((?:\d{1,3}(?:[\s\u00a0]\d{3})+|\d{2,8})(?:[,.]\d{1,2})?)\s*(?:₽|руб(?:\.|лей)?)/gim)];
  for (const match of matches) {
    const value = Number(match[1].replace(/[\s\u00a0]/g, "").replace(",", "."));
    if (Number.isFinite(value) && value > 0 && value <= 100_000_000) return value;
  }
  return null;
}

async function fetchStorePage(url: URL, expectedStore: StoreDefinition, redirectsLeft = 2): Promise<{ html: string; finalUrl: string }> {
  const response = await fetch(url.href, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ru-RU,ru;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; PricePulse/1.0; +https://pricepulse-app.bokcerkbr.chatgpt.site)",
    },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status >= 300 && response.status < 400 && redirectsLeft > 0) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Магазин вернул перенаправление без адреса");
    const nextUrl = new URL(location, url);
    const nextStore = storeFor(nextUrl);
    if (!nextStore || nextStore.source !== expectedStore.source) throw new Error("Магазин перенаправил на неподдерживаемый домен");
    return fetchStorePage(nextUrl, expectedStore, redirectsLeft - 1);
  }
  if (!response.ok) throw new Error(`Страница магазина вернула ошибку ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("Магазин вернул не HTML-страницу");
  return { html: (await response.text()).slice(0, 500_000), finalUrl: url.href };
}

async function getMarketplaceProduct(url: URL, requestedName: string) {
  const store = storeFor(url);
  if (!store) throw new Error("Этот магазин пока не поддерживает автоматическое распознавание");
  const fallbackName = clean(requestedName) || inferredNameFromUrl(url) || `Товар из ${store.source}`;
  try {
    const page = await fetchStorePage(url, store);
    const resolvedName = titleFromPage(page.html);
    const priceRub = rubPriceFromText(page.html);
    return {
      source: store.source,
      name: resolvedName || fallbackName,
      url: page.finalUrl,
      priceRub,
      count: 1,
      approximate: true,
      needsManualPrice: priceRub === null,
      resolvedBy: resolvedName ? "page-content" : "url-fallback",
    };
  } catch {
    return {
      source: store.source,
      name: fallbackName,
      url: url.href,
      priceRub: null,
      count: 1,
      approximate: true,
      needsManualPrice: true,
      resolvedBy: "safe-fallback",
    };
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
  let body: { url?: unknown; name?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "Передайте ссылку на товар" }, { status: 400 }); }
  if (typeof body.url !== "string") return Response.json({ error: "Передайте ссылку на товар" }, { status: 400 });

  let url: URL;
  try {
    url = new URL(body.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    return Response.json({ error: "Передайте безопасную ссылку на страницу товара" }, { status: 400 });
  }

  try {
    const isLis = /(^|\.)lis-skins\.com$/i.test(url.hostname);
    if (!isLis) {
      return Response.json(await getMarketplaceProduct(url, typeof body.name === "string" ? body.name : ""), { headers: { "cache-control": "no-store" } });
    }

    getLisSkinsSlug(url.href);
    const item = findLisSkinsItem(await getCatalogue(), url.href);
    if (!item || !Number.isFinite(item.price) || item.price <= 0) {
      return Response.json({ error: "Товар не найден в актуальном каталоге LIS-SKINS" }, { status: 404 });
    }
    const exchangeRate = await getUsdRubRate();
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
      resolvedBy: "official-catalogue",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось проверить товар";
    const status = /ссылк|раздела market|не поддерживает/i.test(message) ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

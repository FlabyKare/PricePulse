import {
  findLisSkinsItem,
  parseCbrUsdRate,
  rubPriceFromUsd,
  type LisSkinsExportItem,
} from "@/lib/lis-skins";

const LIS_EXPORT_URL = "https://lis-skins.com/market_export_json/csgo.json";
const CBR_RATES_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const CACHE_TTL_MS = 5 * 60 * 1000;
const LIS_RATE_SURCHARGE = 1.03;
const FALLBACK_USD_RUB_RATE = 85.37;

let catalogueCache: { items: LisSkinsExportItem[]; expiresAt: number } | null = null;
let rateCache: { value: number; expiresAt: number } | null = null;

async function getCatalogue() {
  if (catalogueCache && catalogueCache.expiresAt > Date.now()) return catalogueCache.items;

  const response = await fetch(LIS_EXPORT_URL, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
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
  let body: { url?: unknown };
  try {
    body = await request.json() as { url?: unknown };
  } catch {
    return Response.json({ error: "Передайте ссылку на товар" }, { status: 400 });
  }

  if (typeof body.url !== "string") {
    return Response.json({ error: "Передайте ссылку на товар" }, { status: 400 });
  }

  try {
    const item = findLisSkinsItem(await getCatalogue(), body.url);
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
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось проверить цену";
    const status = /ссылк|раздела market/i.test(message) ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}


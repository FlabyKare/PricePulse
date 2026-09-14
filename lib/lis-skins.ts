export type LisSkinsExportItem = {
  name: string;
  price: number;
  unlocked_price?: number;
  url: string;
  count: number;
};

const LIS_HOSTS = new Set(["lis-skins.com", "www.lis-skins.com", "app.lis-skins.com"]);

// The public LIS-SKINS catalogue is denominated in USD, while its storefront
// publishes RUB prices using a two-decimal display rate above the CBR rate.
// Keeping this conversion here prevents the app refresh and Telegram monitor
// from silently using different formulas.
export const LIS_RUB_RATE_MULTIPLIER = 1.042;
const CBR_RATES_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const FALLBACK_LIS_USD_RUB_RATE = 87.8;
const RATE_CACHE_TTL_MS = 5 * 60 * 1000;

export type LisRubRateResolution = {
  value: number;
  source: "configured" | "official-page" | "official-web-index" | "cbr-fallback";
};

let rubRateCache: { resolution: LisRubRateResolution; expiresAt: number } | null = null;

export function isLisSkinsUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && LIS_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function getLisSkinsSlug(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !LIS_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Поддерживаются только ссылки lis-skins.com");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const marketIndex = parts.findIndex((part) => part.toLowerCase() === "market");
  if (marketIndex < 0 || parts[marketIndex + 1]?.toLowerCase() !== "csgo" || !parts[marketIndex + 2]) {
    throw new Error("Нужна ссылка на товар CS2 из раздела market");
  }

  return decodeURIComponent(parts[marketIndex + 2]).toLowerCase();
}

export function findLisSkinsItem(items: LisSkinsExportItem[], rawUrl: string) {
  const requestedSlug = getLisSkinsSlug(rawUrl);
  return items.find((item) => {
    try {
      return getLisSkinsSlug(item.url) === requestedSlug;
    } catch {
      return false;
    }
  });
}

export function parseCbrUsdRate(xml: string) {
  const usdBlock = (xml.match(/<Valute\b[^>]*>[\s\S]*?<\/Valute>/gi) ?? [])
    .find((block) => /<CharCode>USD<\/CharCode>/i.test(block));
  const value = usdBlock?.match(/<VunitRate>([^<]+)<\/VunitRate>/i)?.[1]
    ?? usdBlock?.match(/<Value>([^<]+)<\/Value>/i)?.[1];
  const rate = Number(value?.replace(",", "."));
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function parseLisSkinsRubRate(content: string) {
  const text = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#8381;|&#x20bd;/gi, "₽")
    .replace(/\s+/g, " ");
  const match = text.match(/RUB\s+(?:Ruble|Рубль)[^0-9]{0,80}(?:₽\s*)?([0-9]{2,3}(?:[.,][0-9]{1,4})?)/i);
  const rate = Number(match?.[1]?.replace(",", "."));
  return Number.isFinite(rate) && rate >= 30 && rate <= 300
    ? Math.round(rate * 100) / 100
    : null;
}

export function lisRubRateFromCbr(cbrRate: number) {
  if (!Number.isFinite(cbrRate) || cbrRate <= 0) return null;
  return Math.round(cbrRate * LIS_RUB_RATE_MULTIPLIER * 100) / 100;
}

export function rubPriceFromUsd(priceUsd: number, exchangeRate: number) {
  return Math.round(priceUsd * exchangeRate * 100) / 100;
}

function openRouterContent(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) =>
    part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : []
  ).join("");
}

async function rateFromOfficialPage(pageUrl: string) {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
        "user-agent": "Mozilla/5.0 (compatible; PricePulse/2.1; +https://pricepulse-app.bokcerkbr.chatgpt.site)",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return parseLisSkinsRubRate(await response.text());
  } catch {
    return null;
  }
}

async function rateFromOfficialWebIndex(pageUrl: string) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "http-referer": process.env.WEBAPP_URL?.trim() || "https://pricepulse-app.bokcerkbr.chatgpt.site",
        "x-title": "PricePulse LIS-SKINS Rate Resolver",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
        temperature: 0,
        max_tokens: 180,
        max_tool_calls: 1,
        provider: { zdr: true, data_collection: "deny", allow_fallbacks: false },
        response_format: { type: "json_object" },
        tools: [{
          type: "openrouter:web_search",
          parameters: {
            engine: "exa",
            max_results: 3,
            allowed_domains: ["lis-skins.com"],
          },
        }],
        messages: [
          {
            role: "system",
            content: "Read the exact supplied official LIS-SKINS page. Return the global RUB exchange rate shown in its currency selector next to 'RUB Ruble', never the skin price. Return only JSON: {\"rub_rate\":87.59,\"matched_url\":\"official LIS-SKINS URL\"}. Return empty values unless the rate is explicitly visible on lis-skins.com.",
          },
          { role: "user", content: JSON.stringify({ url: pageUrl }) },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const raw = openRouterContent(await response.json());
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as { rub_rate?: unknown; matched_url?: unknown };
    const rate = Number(parsed.rub_rate);
    const matchedUrl = typeof parsed.matched_url === "string" ? parsed.matched_url : "";
    if (!isLisSkinsUrl(matchedUrl) || !Number.isFinite(rate) || rate < 30 || rate > 300) return null;
    return Math.round(rate * 100) / 100;
  } catch {
    return null;
  }
}

async function fallbackRubRate() {
  try {
    const response = await fetch(CBR_RATES_URL, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("Курс ЦБ недоступен");
    const cbrRate = parseCbrUsdRate(await response.text());
    return cbrRate ? lisRubRateFromCbr(cbrRate) : null;
  } catch {
    return null;
  }
}

export async function resolveLisSkinsRubRate(pageUrl: string): Promise<LisRubRateResolution> {
  if (!isLisSkinsUrl(pageUrl)) throw new Error("Нужна официальная ссылка LIS-SKINS");
  const configuredRate = Number(process.env.LIS_USD_RUB_RATE);
  if (Number.isFinite(configuredRate) && configuredRate > 0) {
    return { value: Math.round(configuredRate * 100) / 100, source: "configured" };
  }
  if (rubRateCache && rubRateCache.expiresAt > Date.now()) return rubRateCache.resolution;

  const directRate = await rateFromOfficialPage(pageUrl);
  const indexedRate = directRate ? null : await rateFromOfficialWebIndex(pageUrl);
  const fallbackRate = directRate || indexedRate ? null : await fallbackRubRate();
  const resolution: LisRubRateResolution = directRate
    ? { value: directRate, source: "official-page" }
    : indexedRate
      ? { value: indexedRate, source: "official-web-index" }
      : { value: fallbackRate ?? FALLBACK_LIS_USD_RUB_RATE, source: "cbr-fallback" };
  rubRateCache = { resolution, expiresAt: Date.now() + RATE_CACHE_TTL_MS };
  return resolution;
}

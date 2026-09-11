export type ResolvedStoreProduct = {
  source: string;
  name: string;
  url: string;
  priceRub: number | null;
  count: number;
  approximate: boolean;
  needsManualPrice: boolean;
  imageUrl: string | null;
  resolvedBy: "page-content" | "reader-content" | "url-fallback" | "safe-fallback" | "web-index" | "official-catalogue";
};

type RuntimeEnv = {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  WEBAPP_URL?: string;
  OZON_RESOLVER_URL?: string;
  OZON_RESOLVER_TOKEN?: string;
};

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

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "ru-RU,ru;q=0.9",
  "user-agent": "Mozilla/5.0 (compatible; PricePulse/2.0; +https://pricepulse-app.bokcerkbr.chatgpt.site)",
};

const dnsCanonicalCache = new Map<string, { url: string; expiresAt: number }>();
const webIndexCache = new Map<string, { name: string; priceRub: number; expiresAt: number }>();
const wbArticleCache = new Map<string, { value: ResolvedStoreProduct; expiresAt: number }>();

export type MarketplaceArticle = { store: "WILDBERRIES" | "OZON"; article: string };

export function parseMarketplaceArticle(value: string): MarketplaceArticle | null {
  const input = value.trim();
  const match = input.match(/^(wb|wildberries|вб|ozon|озон)\s*(?:[:#№-]\s*)?(\d{6,15})$/iu);
  if (!match) return null;
  return {
    store: /^(?:wb|wildberries|вб)$/iu.test(match[1]) ? "WILDBERRIES" : "OZON",
    article: match[2],
  };
}

function wildberriesArticleFromUrl(url: URL) {
  if (sourceFor(url) !== "WILDBERRIES") return null;
  return url.pathname.match(/\/catalog\/(\d{6,15})(?:\/|$)/i)?.[1]
    ?? url.searchParams.get("nm")?.match(/^\d{6,15}$/)?.[0]
    ?? null;
}

function ozonArticleFromUrl(url: URL) {
  if (sourceFor(url) !== "OZON") return null;
  return url.pathname.match(/(?:-|\/)(\d{6,15})(?:\/|$)/)?.[1] ?? null;
}

function clean(value: string, limit = 180) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`#[\]]/g, " ")
    .replace(/&(?:amp|quot|apos);/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function hostWithoutWww(host: string) {
  return host.toLocaleLowerCase("en").replace(/^www\./, "");
}

function isPrivateIpv4(host: string) {
  return /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    || /^0\./.test(host);
}

export function assertSafePublicProductUrl(url: URL) {
  const host = hostWithoutWww(url.hostname);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
    || !host.includes(".")
    || host === "localhost"
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host === "0.0.0.0"
    || host === "::1"
    || isPrivateIpv4(host)
  ) throw new Error("Передайте публичную HTTPS-ссылку на страницу товара");
}

function storeFor(url: URL) {
  const host = hostWithoutWww(url.hostname);
  return SUPPORTED_STORES.find((store) => store.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) ?? null;
}

function sourceFor(url: URL) {
  return storeFor(url)?.source ?? hostWithoutWww(url.hostname).split(".")[0]!.toLocaleUpperCase("ru").slice(0, 32);
}

function inferredDnsNameFromUrl(url: URL) {
  const slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const words = slug.replace(/\.(?:html?|aspx?)$/i, "").split("-").filter(Boolean);
  if (!words.length) return "";
  const translated: Record<string, string> = {
    monitor: "Монитор",
    videokarta: "Видеокарта",
    noutbuk: "Ноутбук",
    televizor: "Телевизор",
    smartfon: "Смартфон",
    nausniki: "Наушники",
    klaviatura: "Клавиатура",
    mys: "Мышь",
    cernyj: "черный",
    belyj: "белый",
    seryj: "серый",
    serebristyj: "серебристый",
    igrovoj: "игровой",
    besprovodnoj: "беспроводной",
    ardor: "ARDOR",
    gaming: "GAMING",
    infinity: "INFINITY",
    pro: "PRO",
    palit: "Palit",
    geforce: "GeForce",
    rtx: "RTX",
  };
  const formatted = words.map((word, index) => {
    if (index === 0 && /^\d{2}$/.test(word) && translated[words[1] ?? ""] === "Монитор") return `${word}"`;
    if (translated[word]) return translated[word];
    if (/\d/.test(word)) return word.toLocaleUpperCase("en");
    return word.charAt(0).toLocaleUpperCase("ru") + word.slice(1);
  });
  return clean(formatted.join(" "));
}

export function inferredNameFromUrl(url: URL) {
  if (sourceFor(url) === "DNS") {
    const dnsName = inferredDnsNameFromUrl(url);
    if (dnsName) return dnsName;
  }
  const generic = /^(?:product|products|catalog|catalogue|item|detail|details|search|p|shop|store|index|default|detail\.aspx)$/i;
  for (const raw of url.pathname.split("/").filter(Boolean).reverse()) {
    let part = clean(decodeURIComponent(raw), 160)
      .replace(/\.(?:html?|aspx?)$/i, "")
      .replace(/[-_]?\d{5,}(?:[-_].*)?$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (!part || generic.test(part) || /^\d+$/.test(part) || !/[\p{L}]{3}/u.test(part)) continue;
    part = part.replace(/\b(?:kupit|buy|cena|price)\b.*$/i, "").trim();
    if (part) return part.charAt(0).toLocaleUpperCase("ru") + part.slice(1);
  }
  for (const key of ["text", "q", "query", "search"]) {
    const value = clean(url.searchParams.get(key) ?? "", 160);
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
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&rub;|&#8381;/gi, "₽");
}

function safeImageUrl(rawValue: string, baseUrl?: string) {
  try {
    const imageUrl = new URL(decodeEntities(rawValue), baseUrl);
    assertSafePublicProductUrl(imageUrl);
    return imageUrl.href.slice(0, 2_000);
  } catch {
    return null;
  }
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1],
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, "i"))?.[1],
  ].find(Boolean) ?? null;
}

export function imageFromPage(html: string, baseUrl: string) {
  const rawImage = ["og:image:secure_url", "og:image", "twitter:image", "image"].map((key) => metaContent(html, key)).find(Boolean);
  return rawImage ? safeImageUrl(rawImage, baseUrl) : null;
}

function normalizedProductTitle(value: string) {
  return clean(decodeEntities(value))
    .replace(/^Купить\s+/i, "")
    .replace(/\s+в\s+интернет-магазине\s+DNS(?:\.|$).*$/i, "")
    .replace(/\s*(?:\||—|–|-)+\s*(?:Ozon|Wildberries|Яндекс Маркет|DNS|М\.Видео|Ситилинк|Lamoda|Avito).*$/i, "")
    .replace(/\s+(?:купить|цена|отзывы)\b.*$/i, "")
    .trim();
}

export function titleFromPage(html: string) {
  const candidates = [
    metaContent(html, "og:title"),
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1],
    html.match(/"name"\s*:\s*"([^"\\]{3,180})"/i)?.[1],
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const title = normalizedProductTitle(candidate);
    if (title.length >= 3 && !/^(?:ozon|wildberries|яндекс маркет|dns)$/i.test(title)) return title;
  }
  return "";
}

function priceNumber(raw: unknown) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 && raw <= 100_000_000 ? raw : null;
  if (typeof raw !== "string") return null;
  const normalized = raw.replace(/[\s\u00a0]/g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 && value <= 100_000_000 ? value : null;
}

function jsonLdPrice(html: string) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const visit = (value: unknown, productContext = false): number | null => {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, productContext);
        if (found) return found;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    const type = String(record["@type"] ?? "").toLocaleLowerCase("en");
    const inProduct = productContext || type === "product" || type === "offer" || type === "aggregateoffer";
    if (inProduct) {
      for (const key of ["price", "lowPrice", "highPrice"]) {
        const found = priceNumber(record[key]);
        if (found) return found;
      }
    }
    for (const [key, item] of Object.entries(record)) {
      if (key === "offers" || key === "priceSpecification" || key === "@graph" || inProduct) {
        const found = visit(item, inProduct || key === "offers" || key === "priceSpecification");
        if (found) return found;
      }
    }
    return null;
  };
  for (const script of scripts) {
    try {
      const found = visit(JSON.parse(decodeEntities(script[1])));
      if (found) return found;
    } catch { /* Ignore invalid retailer JSON-LD. */ }
  }
  return null;
}

export function rubPriceFromText(text: string) {
  const decoded = decodeEntities(text);
  const structured = [
    metaContent(decoded, "product:price:amount"),
    metaContent(decoded, "og:price:amount"),
    metaContent(decoded, "price"),
  ].map(priceNumber).find((value): value is number => value !== null);
  if (structured) return structured;
  const ldPrice = jsonLdPrice(decoded);
  if (ldPrice) return ldPrice;
  const labelled = [
    /(?:текущая\s+)?цена\s*[:-]?\s*(\d[\d\s\u00a0]{1,12}(?:[,.]\d{1,2})?)\s*(?:₽|руб(?:\.|лей)?)/gi,
    /(?:^|[^\d])((?:\d{1,3}(?:[\s\u00a0]\d{3})+|\d{2,8})(?:[,.]\d{1,2})?)\s*(?:₽|руб(?:\.|лей)?)/gim,
  ];
  for (const pattern of labelled) {
    for (const match of decoded.matchAll(pattern)) {
      const value = priceNumber(match[1]);
      if (value) return value;
    }
  }
  return null;
}

function sameStoreRedirect(from: URL, to: URL) {
  const fromStore = storeFor(from);
  const toStore = storeFor(to);
  if (fromStore || toStore) return Boolean(fromStore && toStore && fromStore.source === toStore.source);
  return hostWithoutWww(from.hostname) === hostWithoutWww(to.hostname);
}

async function fetchPage(url: URL, redirectsLeft = 4): Promise<{ html: string; finalUrl: string }> {
  const response = await fetch(url.href, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status >= 300 && response.status < 400 && redirectsLeft > 0) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Магазин вернул перенаправление без адреса");
    const nextUrl = new URL(location, url);
    assertSafePublicProductUrl(nextUrl);
    if (!sameStoreRedirect(url, nextUrl)) throw new Error("Магазин перенаправил на другой домен");
    return fetchPage(nextUrl, redirectsLeft - 1);
  }
  if (!response.ok) throw new Error(`Страница магазина вернула ошибку ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (type && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)) throw new Error("Магазин вернул неподдерживаемый формат");
  return { html: (await response.text()).slice(0, 750_000), finalUrl: url.href };
}

function dnsProductId(url: URL) {
  return url.pathname.match(/^\/product\/([a-f0-9]{16})(?:\/|$)/i)?.[1]?.toLocaleLowerCase("en") ?? null;
}

async function resolveDnsCanonicalUrl(url: URL) {
  const id = dnsProductId(url);
  if (!id || url.pathname.split("/").filter(Boolean).length > 2) return url;
  const cached = dnsCanonicalCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return new URL(cached.url);
  try {
    const sitemapNumber = Math.min(17, Math.floor(Number.parseInt(id.slice(0, 2), 16) / 16) + 1);
    const response = await fetch(`https://www.dns-shop.ru/sitemap-products${sitemapNumber}.xml`, {
      headers: REQUEST_HEADERS, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return url;
    const xml = await response.text();
    const match = xml.match(new RegExp(`<loc>(https:\\/\\/www\\.dns-shop\\.ru\\/product\\/${id}\\/[^<]+)<\\/loc>`, "i"));
    if (!match?.[1]) return url;
    const canonical = new URL(decodeEntities(match[1]));
    dnsCanonicalCache.set(id, { url: canonical.href, expiresAt: Date.now() + 86_400_000 });
    return canonical;
  } catch { return url; }
}

async function readerFallback(url: URL) {
  try {
    const response = await fetch(`https://r.jina.ai/${url.href}`, {
      headers: { accept: "text/plain", "x-retain-images": "none" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const text = (await response.text()).slice(0, 500_000);
    const name = normalizedProductTitle(text.match(/^Title:\s*(.+)$/mi)?.[1] ?? text.match(/^#\s+(.+)$/m)?.[1] ?? "");
    const priceRub = rubPriceFromText(text);
    if (!name && !priceRub) return null;
    return { name, priceRub };
  } catch { return null; }
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

function sameProductIdentity(expected: URL, candidateValue: string) {
  try {
    const candidate = new URL(candidateValue);
    if (hostWithoutWww(candidate.hostname) !== hostWithoutWww(expected.hostname)) return false;
    const expectedPath = expected.pathname.replace(/\/+$/, "").toLocaleLowerCase("en");
    const candidatePath = candidate.pathname.replace(/\/+$/, "").toLocaleLowerCase("en");
    if (expectedPath === candidatePath) return true;
    const expectedIds = expectedPath.match(/\d{7,}|[a-f0-9]{16}/gi) ?? [];
    return expectedIds.some((id) => candidatePath.includes(id));
  } catch { return false; }
}

async function webIndexFallback(url: URL, fallbackName: string) {
  const cached = webIndexCache.get(url.href);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const runtime = process.env as RuntimeEnv;
  const apiKey = runtime.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + apiKey,
        "content-type": "application/json",
        "http-referer": runtime.WEBAPP_URL?.trim() || "https://pricepulse-app.bokcerkbr.chatgpt.site",
        "x-title": "PricePulse Product Resolver",
      },
      body: JSON.stringify({
        model: runtime.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
        temperature: 0,
        max_tokens: 300,
        max_tool_calls: 1,
        provider: { zdr: true, data_collection: "deny", allow_fallbacks: false },
        response_format: { type: "json_object" },
        tools: [{
          type: "openrouter:web_search",
          parameters: {
            engine: "exa",
            max_results: 5,
            allowed_domains: [hostWithoutWww(url.hostname)],
          },
        }],
        messages: [
          {
            role: "system",
            content: "Find exactly the product card identified by the supplied URL in the public web index. Never substitute a similar product or invent a price. Return only JSON: {\"name\":\"exact product name\",\"price_rub\":12345,\"matched_url\":\"URL of the same exact product card\"}. If the exact card and current RUB price cannot both be confirmed, return empty values.",
          },
          { role: "user", content: JSON.stringify({ url: url.href, fallback_name: fallbackName }) },
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
    const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as { name?: unknown; price_rub?: unknown; matched_url?: unknown };
    const priceRub = priceNumber(parsed.price_rub);
    const name = typeof parsed.name === "string" ? clean(parsed.name) : "";
    const matchedUrl = typeof parsed.matched_url === "string" ? parsed.matched_url : "";
    if (!priceRub || !name || !sameProductIdentity(url, matchedUrl)) return null;
    const result = { name, priceRub, expiresAt: Date.now() + 30 * 60_000 };
    webIndexCache.set(url.href, result);
    return result;
  } catch { return null; }
}

function wbPriceRub(product: unknown) {
  if (!product || typeof product !== "object") return null;
  const sizes = (product as { sizes?: unknown }).sizes;
  if (!Array.isArray(sizes)) return null;
  const prices = sizes.flatMap((size) => {
    if (!size || typeof size !== "object") return [];
    const price = (size as { price?: unknown }).price;
    if (!price || typeof price !== "object") return [];
    const productPrice = Number((price as { product?: unknown }).product);
    return Number.isFinite(productPrice) && productPrice > 0 ? [productPrice / 100] : [];
  });
  return prices.length ? Math.round(Math.min(...prices)) : null;
}

async function wbStaticCard(article: string) {
  const id = Number(article);
  const vol = Math.floor(id / 100_000);
  const part = Math.floor(id / 1_000);
  for (let start = 1; start <= 31; start += 6) {
    const baskets = Array.from({ length: Math.min(6, 32 - start) }, (_, index) => start + index);
    const attempts = await Promise.all(baskets.map(async (basket) => {
      const base = `https://basket-${String(basket).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${article}`;
      try {
        const response = await fetch(`${base}/info/ru/card.json`, {
          headers: { accept: "application/json", referer: "https://www.wildberries.ru/" },
          cache: "no-store",
          signal: AbortSignal.timeout(6_000),
        });
        if (!response.ok) return null;
        const card = await response.json() as { nm_id?: unknown; imt_name?: unknown; selling?: { brand_name?: unknown } };
        if (String(card.nm_id) !== article) return null;
        return { basket, base, card };
      } catch { return null; }
    }));
    const found = attempts.find(Boolean);
    if (found) return found;
  }
  return null;
}

export async function resolveWildberriesArticle(article: string): Promise<ResolvedStoreProduct | null> {
  if (!/^\d{6,15}$/.test(article)) return null;
  const cached = wbArticleCache.get(article);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const url = `https://www.wildberries.ru/catalog/${article}/detail.aspx`;
  try {
    const endpoint = new URL("https://card.wb.ru/cards/v4/detail");
    endpoint.search = new URLSearchParams({ appType: "1", curr: "rub", dest: "-1257786", spp: "30", nm: article }).toString();
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        origin: "https://www.wildberries.ru",
        referer: "https://www.wildberries.ru/",
        "accept-language": "ru-RU,ru;q=0.9",
        "user-agent": REQUEST_HEADERS["user-agent"],
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const payload = await response.json() as { products?: unknown };
      const products = Array.isArray(payload.products) ? payload.products : [];
      const product = products.find((item) => item && typeof item === "object" && String((item as { id?: unknown }).id) === article) as {
        name?: unknown; brand?: unknown; totalQuantity?: unknown;
      } | undefined;
      const priceRub = wbPriceRub(product);
      const name = product && typeof product.name === "string" ? clean(`${typeof product.brand === "string" ? product.brand + " · " : ""}${product.name}`) : "";
      if (product && name && priceRub) {
        const value: ResolvedStoreProduct = {
          source: "WILDBERRIES", name, url, priceRub,
          count: Math.max(1, Number(product.totalQuantity) || 1),
          approximate: false, needsManualPrice: false, imageUrl: null,
          resolvedBy: "official-catalogue",
        };
        wbArticleCache.set(article, { value, expiresAt: Date.now() + 5 * 60_000 });
        return value;
      }
    }
  } catch { /* Use the first-party static catalogue below. */ }

  const staticCard = await wbStaticCard(article);
  if (!staticCard) return null;
  let priceRub: number | null = null;
  try {
    const response = await fetch(`${staticCard.base}/info/price-history.json`, {
      headers: { accept: "application/json", referer: "https://www.wildberries.ru/" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const history = response.ok ? await response.json() as unknown : null;
    if (Array.isArray(history)) {
      const latest = history
        .filter((item) => item && typeof item === "object")
        .sort((a, b) => Number((b as { dt?: unknown }).dt) - Number((a as { dt?: unknown }).dt))[0] as { price?: { RUB?: unknown } } | undefined;
      const kopecks = Number(latest?.price?.RUB);
      if (Number.isFinite(kopecks) && kopecks > 0) priceRub = Math.round(kopecks / 100);
    }
  } catch { /* A card can exist without price history. */ }
  const rawName = typeof staticCard.card.imt_name === "string" ? staticCard.card.imt_name : "";
  const rawBrand = typeof staticCard.card.selling?.brand_name === "string" ? staticCard.card.selling.brand_name : "";
  const name = clean(`${rawBrand ? rawBrand + " · " : ""}${rawName}`) || `Товар Wildberries · артикул ${article}`;
  const imageUrl = `${staticCard.base}/images/big/1.webp`;
  const value: ResolvedStoreProduct = {
    source: "WILDBERRIES", name, url, priceRub, count: 1,
    approximate: Boolean(priceRub), needsManualPrice: !priceRub, imageUrl,
    resolvedBy: "official-catalogue",
  };
  wbArticleCache.set(article, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
}

function ozonStringPrice(value: unknown) {
  if (typeof value !== "string") return null;
  if (!/[₽р]|rub/i.test(value) && !/^\s*\d[\d\s.,]*\s*$/.test(value)) return null;
  return priceNumber(value);
}

function parseOzonPayload(payload: unknown, article: string, fallbackUrl: string): ResolvedStoreProduct | null {
  if (!payload || typeof payload !== "object") return null;
  const direct = payload as { name?: unknown; title?: unknown; priceRub?: unknown; price_rub?: unknown; url?: unknown; imageUrl?: unknown; image_url?: unknown; count?: unknown };
  const directPrice = priceNumber(direct.priceRub ?? direct.price_rub);
  const directName = typeof direct.name === "string" ? direct.name : typeof direct.title === "string" ? direct.title : "";
  if (directPrice && directName) {
    const candidateUrl = typeof direct.url === "string" ? direct.url : fallbackUrl;
    if (!sameProductIdentity(new URL(fallbackUrl), candidateUrl)) return null;
    return {
      source: "OZON", name: clean(directName), url: candidateUrl, priceRub: Math.round(directPrice),
      count: Math.max(1, Number(direct.count) || 1), approximate: false, needsManualPrice: false,
      imageUrl: safeImageUrl(typeof direct.imageUrl === "string" ? direct.imageUrl : typeof direct.image_url === "string" ? direct.image_url : ""),
      resolvedBy: "official-catalogue",
    };
  }

  const states = (payload as { widgetStates?: unknown }).widgetStates;
  if (!states || typeof states !== "object") return null;
  const decoded: unknown[] = [];
  for (const value of Object.values(states)) {
    if (typeof value !== "string") continue;
    try { decoded.push(JSON.parse(value)); } catch { /* Ignore unrelated widgets. */ }
  }
  let name = "";
  let priceRub: number | null = null;
  let imageUrl: string | null = null;
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (!name) {
      for (const key of ["productTitle", "title", "name"]) {
        if (typeof record[key] === "string" && clean(record[key] as string).length >= 3) { name = clean(record[key] as string); break; }
      }
    }
    if (!priceRub) {
      for (const key of ["finalPrice", "cardPrice", "ozonCardPrice", "price"]) {
        const candidate = ozonStringPrice(record[key]);
        if (candidate) { priceRub = Math.round(candidate); break; }
      }
    }
    if (!imageUrl) {
      for (const key of ["imageUrl", "image", "src"]) {
        if (typeof record[key] === "string") {
          const candidate = safeImageUrl(record[key] as string, fallbackUrl);
          if (candidate) { imageUrl = candidate; break; }
        }
      }
    }
    Object.values(record).forEach(visit);
  };
  decoded.forEach(visit);
  if (!name || !priceRub) return null;
  return {
    source: "OZON", name, url: fallbackUrl, priceRub, count: 1,
    approximate: false, needsManualPrice: false, imageUrl,
    resolvedBy: "official-catalogue",
  };
}

export async function resolveOzonArticle(article: string): Promise<ResolvedStoreProduct | null> {
  if (!/^\d{6,15}$/.test(article)) return null;
  const canonicalUrl = `https://www.ozon.ru/product/${article}/`;
  const runtime = process.env as RuntimeEnv;
  try {
    const configured = runtime.OZON_RESOLVER_URL?.trim();
    const endpoint = configured ? new URL(configured) : new URL("https://api.ozon.ru/composer-api.bx/page/json/v2");
    endpoint.searchParams.set(configured ? "article" : "url", configured ? article : `/product/${article}/`);
    if (configured) endpoint.searchParams.set("url", canonicalUrl);
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        "accept-language": "ru-RU,ru;q=0.9",
        "user-agent": REQUEST_HEADERS["user-agent"],
        ...(configured && runtime.OZON_RESOLVER_TOKEN?.trim() ? { authorization: `Bearer ${runtime.OZON_RESOLVER_TOKEN.trim()}` } : {}),
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return parseOzonPayload(await response.json(), article, canonicalUrl);
  } catch { return null; }
}

export async function resolveMarketplaceArticle(reference: MarketplaceArticle, requestedName = "") {
  if (reference.store === "WILDBERRIES") return resolveWildberriesArticle(reference.article);
  const resolved = await resolveOzonArticle(reference.article);
  if (resolved) return resolved;
  return resolveStoreProduct(new URL(`https://www.ozon.ru/product/${reference.article}/`), requestedName || `Товар Ozon · артикул ${reference.article}`);
}

export async function resolveStoreProduct(url: URL, requestedName = ""): Promise<ResolvedStoreProduct> {
  assertSafePublicProductUrl(url);
  const source = sourceFor(url);
  const wbArticle = wildberriesArticleFromUrl(url);
  if (wbArticle) {
    const product = await resolveWildberriesArticle(wbArticle);
    if (product) return product;
  }
  const ozonArticle = ozonArticleFromUrl(url);
  if (ozonArticle) {
    const product = await resolveOzonArticle(ozonArticle);
    if (product) return product;
  }
  const canonicalUrl = source === "DNS" ? await resolveDnsCanonicalUrl(url) : url;
  let page: { html: string; finalUrl: string } | null = null;
  try { page = await fetchPage(canonicalUrl); } catch { /* Continue with safe public fallbacks. */ }
  const finalUrl = page ? new URL(page.finalUrl) : canonicalUrl;
  const fallbackName = clean(requestedName) || inferredNameFromUrl(finalUrl) || `Товар из ${source}`;
  const pageName = page ? titleFromPage(page.html) : "";
  const pagePrice = page ? rubPriceFromText(page.html) : null;
  if (pagePrice) {
    return {
      source, name: pageName || fallbackName, url: finalUrl.href, priceRub: pagePrice, count: 1,
      approximate: false, needsManualPrice: false, imageUrl: page ? imageFromPage(page.html, finalUrl.href) : null,
      resolvedBy: "page-content",
    };
  }

  const reader = await readerFallback(finalUrl);
  if (reader?.priceRub) {
    return {
      source, name: reader.name || pageName || fallbackName, url: finalUrl.href, priceRub: reader.priceRub, count: 1,
      approximate: true, needsManualPrice: false, imageUrl: page ? imageFromPage(page.html, finalUrl.href) : null,
      resolvedBy: "reader-content",
    };
  }

  // DNS serves region-specific prices behind an anti-bot session. A cached price from
  // another catalogue can be a different region or simply stale, so never present it
  // as the current DNS price. Preserve the exact official title and let the user enter
  // the visible price until a live first-party page response is available.
  if (source === "DNS") {
    return {
      source, name: reader?.name || pageName || fallbackName, url: finalUrl.href, priceRub: null, count: 1,
      approximate: false, needsManualPrice: true, imageUrl: page ? imageFromPage(page.html, finalUrl.href) : null,
      resolvedBy: reader?.name ? "reader-content" : pageName ? "url-fallback" : "safe-fallback",
    };
  }

  const indexed = await webIndexFallback(finalUrl, pageName || fallbackName);
  if (indexed) {
    return {
      source, name: indexed.name, url: finalUrl.href, priceRub: indexed.priceRub, count: 1,
      approximate: true, needsManualPrice: false, imageUrl: page ? imageFromPage(page.html, finalUrl.href) : null,
      resolvedBy: "web-index",
    };
  }

  return {
    source, name: pageName || fallbackName, url: finalUrl.href, priceRub: null, count: 1,
    approximate: true, needsManualPrice: true, imageUrl: page ? imageFromPage(page.html, finalUrl.href) : null,
    resolvedBy: pageName ? "url-fallback" : "safe-fallback",
  };
}

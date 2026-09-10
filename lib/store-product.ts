export type ResolvedStoreProduct = {
  source: string;
  name: string;
  url: string;
  priceRub: number | null;
  count: number;
  approximate: boolean;
  needsManualPrice: boolean;
  imageUrl: string | null;
  resolvedBy: "page-content" | "url-fallback" | "safe-fallback" | "price-index";
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

export function inferredNameFromUrl(url: URL) {
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

export function titleFromPage(html: string) {
  const candidates = [
    metaContent(html, "og:title"),
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1],
    html.match(/"name"\s*:\s*"([^"\\]{3,180})"/i)?.[1],
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

function dnsSearchTerm(productUrl: URL, productName: string) {
  const slug = productUrl.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const parts = slug.split("-").filter(Boolean);
  const codeIndex = parts.findLastIndex((part) => part.length >= 8 && /[a-z]/i.test(part) && /\d/.test(part));
  if (codeIndex >= 0) return parts.slice(codeIndex).join("-");
  return clean(productName.replace(/\b(?:videokarta|видеокарта)\b/giu, " "));
}

async function pcStonksCandidates(query: string) {
  const search = new URL("https://pcstonks.com/catalog/");
  search.searchParams.set("name", query);
  const response = await fetch(search, { headers: REQUEST_HEADERS, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) return [];
  const html = (await response.text()).slice(0, 750_000);
  const matches = [...html.matchAll(/href=["'](\/catalog\/\d+-[^"'#?]+)["']/gi)];
  const candidates: Array<{ url: URL; context: string }> = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const url = new URL(match[1], search);
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const start = Math.max(0, (match.index ?? 0) - 300);
    const context = clean(decodeEntities(html.slice(start, (match.index ?? 0) + 1_500)), 1_500);
    if (likelySameProduct(query, context)) candidates.push({ url, context });
  }
  return candidates.slice(0, 5);
}

function comparableTokens(value: string) {
  return new Set(value.toLocaleLowerCase("ru").match(/[a-zа-яё0-9]{4,}/giu)?.filter((token) => !/^(?:videokarta|видеокарта|купить|цена|товар|dns|shop)$/.test(token)) ?? []);
}

function likelySameProduct(expected: string, actual: string) {
  const left = comparableTokens(expected);
  const right = comparableTokens(actual);
  const shared = [...left].filter((token) => right.has(token));
  const hasSpecificCode = shared.some((token) => /[a-zа-яё]/iu.test(token) && /\d/u.test(token) && token.length >= 7);
  return hasSpecificCode || shared.length >= Math.min(3, Math.max(2, left.size));
}

async function resolveDnsViaPriceIndex(productUrl: URL, productName: string) {
  const queryName = dnsSearchTerm(productUrl, productName || inferredNameFromUrl(productUrl));
  if (!queryName) return null;
  for (const candidate of await pcStonksCandidates(queryName)) {
    try {
      const indexed = await fetchPage(candidate.url, 2);
      const name = titleFromPage(indexed.html) || candidate.context;
      const priceRub = rubPriceFromText(indexed.html);
      if (priceRub && likelySameProduct(queryName, `${name} ${candidate.context}`)) return { name, priceRub };
    } catch { /* Try another exact index result. */ }
  }
  return null;
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
    const priceRub = rubPriceFromText(text);
    if (!priceRub) return null;
    const name = clean(text.match(/^Title:\s*(.+)$/mi)?.[1] ?? text.match(/^#\s+(.+)$/m)?.[1] ?? "");
    return { name, priceRub };
  } catch { return null; }
}

export async function resolveStoreProduct(url: URL, requestedName = ""): Promise<ResolvedStoreProduct> {
  assertSafePublicProductUrl(url);
  const source = sourceFor(url);
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

  if (source === "DNS") {
    const indexed = await resolveDnsViaPriceIndex(finalUrl, pageName || fallbackName);
    if (indexed) {
      return {
        source, name: indexed.name || pageName || fallbackName, url: finalUrl.href, priceRub: indexed.priceRub, count: 1,
        approximate: true, needsManualPrice: false, imageUrl: page ? imageFromPage(page.html, finalUrl.href) : null,
        resolvedBy: "price-index",
      };
    }
  }

  const reader = await readerFallback(finalUrl);
  if (reader) {
    return {
      source, name: reader.name || pageName || fallbackName, url: finalUrl.href, priceRub: reader.priceRub, count: 1,
      approximate: true, needsManualPrice: false, imageUrl: page ? imageFromPage(page.html, finalUrl.href) : null,
      resolvedBy: "price-index",
    };
  }

  return {
    source, name: pageName || fallbackName, url: finalUrl.href, priceRub: null, count: 1,
    approximate: true, needsManualPrice: true, imageUrl: page ? imageFromPage(page.html, finalUrl.href) : null,
    resolvedBy: pageName ? "url-fallback" : "safe-fallback",
  };
}

type RuntimeEnv = { OPENROUTER_API_KEY?: string; OPENROUTER_MODEL?: string; WEBAPP_URL?: string };
type SearchIntent = "cs2" | "electronics" | "beauty" | "fashion" | "home" | "auto" | "general";
type Source = {
  title: string;
  url: string;
  kind: "магазин" | "обзор";
  priceLabel?: string;
  ratingLabel?: string;
  verified: true;
};
type Candidate = {
  id: string;
  name: string;
  description: string;
  priceValue: number | null;
  priceLabel: string;
  ratingValue: number | null;
  ratingLabel: string;
  reviewCount: number | null;
  popularity: string;
  sources: Source[];
};
type SearchResult = { title: string; url: string; description: string; kind: "магазин" | "обзор" };
type LisCatalogueItem = { name: string; price: number; url: string; count?: number };
type WbProduct = {
  id?: unknown;
  name?: unknown;
  brand?: unknown;
  rating?: unknown;
  feedbacks?: unknown;
  salePriceU?: unknown;
  sizes?: Array<{ price?: { product?: unknown; total?: unknown } }>;
};

const LIS_EXPORT_URL = "https://lis-skins.com/market_export_json/csgo.json";
const WB_SEARCH_URL = "https://search.wb.ru/exactmatch/ru/common/v18/search";
const LIS_CACHE_TTL_MS = 5 * 60 * 1000;
let lisCatalogueCache: { items: LisCatalogueItem[]; expiresAt: number } | null = null;

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/");
}

function clean(value: string, limit = 300) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(decodeEntities(value), "https://html.duckduckgo.com");
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.hostname === "duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com")) {
      const target = url.searchParams.get("uddg");
      return target ? safeUrl(target) : null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith("." + domain);
}

function inferIntent(query: string): SearchIntent {
  if (/cs\s*2|csgo|counter.?strike|скин|sticker|наклейк|глок|glock|ak-?47|m4a[14]|awp|нож|перчатк/i.test(query)) return "cs2";
  if (/телефон|смартфон|ноутбук|наушник|телевизор|монитор|планшет|камера|процессор|видеокарт|электрон/i.test(query)) return "electronics";
  if (/косметик|духи|парфюм|крем|шампун|макияж|сыворотк/i.test(query)) return "beauty";
  if (/одежд|обув|кроссов|куртк|плать|джинс|сумк/i.test(query)) return "fashion";
  if (/мебел|кресл|стол|матрас|пылесос|кофемашин|холодильник|дом/i.test(query)) return "home";
  if (/авто|машин|шины|диск|запчаст|масло мотор/i.test(query)) return "auto";
  return "general";
}

function storeDomains(intent: SearchIntent) {
  if (intent === "electronics") return ["ozon.ru/product", "market.yandex.ru/product", "market.yandex.ru/card", "dns-shop.ru/product", "mvideo.ru/products", "citilink.ru/product"];
  if (intent === "beauty") return ["ozon.ru/product", "goldapple.ru", "letu.ru", "wildberries.ru/catalog"];
  if (intent === "fashion") return ["ozon.ru/product", "wildberries.ru/catalog", "lamoda.ru/p"];
  if (intent === "home") return ["ozon.ru/product", "market.yandex.ru/product", "wildberries.ru/catalog", "hoff.ru/catalog", "vseinstrumenti.ru/product"];
  if (intent === "auto") return ["avito.ru", "exist.ru", "emex.ru", "autodoc.ru"];
  return ["ozon.ru/product", "market.yandex.ru/product", "market.yandex.ru/card", "wildberries.ru/catalog", "avito.ru"];
}

function isDirectStoreUrl(value: string, intent: SearchIntent) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase("en").replace(/^www\./, "");
    const path = url.pathname.toLocaleLowerCase("en");
    if (hostMatches(host, "ozon.ru")) return path.includes("/product/");
    if (hostMatches(host, "market.yandex.ru")) return path.includes("/product") || path.includes("/card");
    if (hostMatches(host, "wildberries.ru")) return /\/catalog\/\d+\/detail\.aspx/.test(path);
    if (hostMatches(host, "dns-shop.ru")) return path.includes("/product/");
    if (hostMatches(host, "mvideo.ru")) return path.includes("/products/");
    if (hostMatches(host, "citilink.ru")) return path.includes("/product/");
    if (hostMatches(host, "lamoda.ru")) return path.includes("/p/");
    if (hostMatches(host, "goldapple.ru") || hostMatches(host, "letu.ru")) return path.split("/").filter(Boolean).length >= 2;
    if (hostMatches(host, "hoff.ru") || hostMatches(host, "vseinstrumenti.ru")) return /\/(catalog|product)\//.test(path);
    if (hostMatches(host, "avito.ru")) return /_\d+$/.test(path);
    if (intent === "auto" && ["exist.ru", "emex.ru", "autodoc.ru"].some((domain) => hostMatches(host, domain))) return path.length > 3;
    return false;
  } catch {
    return false;
  }
}

function isReviewUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLocaleLowerCase("en").replace(/^www\./, "");
    return ["ixbt.com", "3dnews.ru", "mobile-review.com", "overclockers.ru", "otzovik.com", "irecommend.ru", "youtube.com", "youtu.be"].some((domain) => hostMatches(host, domain));
  } catch {
    return false;
  }
}

function labelFromUrl(value: string) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    const labels: Record<string, string> = {
      "ozon.ru": "Ozon",
      "market.yandex.ru": "Яндекс Маркет",
      "wildberries.ru": "Wildberries",
      "dns-shop.ru": "DNS",
      "mvideo.ru": "М.Видео",
      "citilink.ru": "Ситилинк",
      "ixbt.com": "iXBT",
      "3dnews.ru": "3DNews",
      "mobile-review.com": "Mobile-review",
      "otzovik.com": "Отзовик",
      "irecommend.ru": "IRecommend",
    };
    const key = Object.keys(labels).find((domain) => hostMatches(host, domain));
    return key ? labels[key] : host;
  } catch {
    return "Источник";
  }
}

function productName(value: string) {
  const name = clean(value, 140)
    .replace(/\s*(?:[|—–-]\s*)?(?:купить|цена|отзывы|характеристики|доставка)\b.*$/i, "")
    .replace(/\s*(?:[|—–-]\s*)?(?:Ozon|Wildberries|Яндекс Маркет|DNS|М\.Видео)\s*$/i, "")
    .trim();
  return name.charAt(0).toLocaleUpperCase("ru") + name.slice(1);
}

function numericPrice(text: string) {
  const matches = [...text.matchAll(/(?:от|за)?\s*(\d{1,3}(?:[\s\u00a0]\d{3})+|\d{3,8})(?:[,.]\d{1,2})?\s*(?:₽|руб(?:\.|лей)?)/gim)];
  for (const match of matches) {
    const value = Number(match[1].replace(/[\s\u00a0]/g, ""));
    if (Number.isFinite(value) && value >= 50 && value <= 100_000_000) return value;
  }
  return null;
}

function numericRating(text: string) {
  const match = text.match(/([1-5](?:[,.]\d)?)\s*(?:\/\s*5|из\s*5|★)/i);
  const value = match ? Number(match[1].replace(",", ".")) : NaN;
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

function numericReviewCount(text: string) {
  const match = text.match(/(\d{1,3}(?:[\s\u00a0]\d{3})*|\d{1,7})\s*(?:отзыв(?:а|ов)?|оцен(?:ка|ки|ок)|review(?:s)?|rating(?:s)?)/i);
  const value = match ? Number(match[1].replace(/[\s\u00a0]/g, "")) : NaN;
  return Number.isInteger(value) && value >= 0 && value <= 100_000_000 ? value : null;
}

function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value);
}

function queryTokens(value: string) {
  const stop = new Set(["купить", "цена", "цены", "отзывы", "обзор", "лучший", "лучшие", "товар", "товары", "для", "или", "до", "руб", "рублей"]);
  return value.toLocaleLowerCase("ru").split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2 && !stop.has(token));
}

function tokenScore(left: string, right: string) {
  const rightText = right.toLocaleLowerCase("ru");
  return queryTokens(left).reduce((score, token) => score + (rightText.includes(token) ? 1 : 0), 0);
}

function budgetFromQuery(query: string) {
  const match = query.match(/(?:до|бюджет(?:ом)?|не дороже)\s*(\d[\d\s]{2,8})/i);
  if (!match) return null;
  const value = Number(match[1].replace(/\s/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function catalogueQuery(query: string) {
  const cleaned = query
    .replace(/(?:до|бюджет(?:ом)?|не дороже)\s*\d[\d\s]{2,8}(?:\s*(?:₽|руб(?:\.|лей)?))?/gi, " ")
    .replace(/\b(?:купить|цена|цены|отзывы|обзор|лучший|лучшие|подбери|найди)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned : query;
}

function parseDuckResults(html: string, intent: SearchIntent, resultKind: "магазин" | "обзор") {
  const results: SearchResult[] = [];
  const anchorPattern = /<a[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(anchorPattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const url = safeUrl(match[1]);
    if (!url) continue;
    if (resultKind === "магазин" ? !isDirectStoreUrl(url, intent) : !isReviewUrl(url)) continue;
    const nextIndex = matches[index + 1]?.index ?? Math.min(html.length, (match.index ?? 0) + 2_500);
    const nearby = html.slice((match.index ?? 0) + match[0].length, nextIndex);
    const snippet = clean(nearby.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] ?? "", 420);
    const title = productName(match[2]);
    if (title.length < 3) continue;
    results.push({ title, url, description: snippet, kind: resultKind });
  }
  return results.filter((result, position, all) => all.findIndex((item) => item.url === result.url) === position).slice(0, 12);
}

async function duckSearch(query: string, intent: SearchIntent, resultKind: "магазин" | "обзор") {
  try {
    const domains = resultKind === "магазин"
      ? storeDomains(intent)
      : ["ixbt.com", "3dnews.ru", "mobile-review.com", "overclockers.ru", "otzovik.com", "irecommend.ru"];
    const scoped = domains.map((domain) => "site:" + domain).join(" OR ");
    const searchQuery = resultKind === "магазин"
      ? '"' + query + '" (' + scoped + ")"
      : '"' + query + '" отзывы обзор (' + scoped + ")";
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", searchQuery);
    url.searchParams.set("kl", "ru-ru");
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ru-RU,ru;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; PricePulse/2.0)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [];
    return parseDuckResults((await response.text()).slice(0, 750_000), intent, resultKind);
  } catch {
    return [];
  }
}

async function jinaSearch(query: string, intent: SearchIntent, resultKind: "магазин" | "обзор") {
  try {
    const domains = resultKind === "магазин" ? storeDomains(intent) : ["ixbt.com", "3dnews.ru", "mobile-review.com", "otzovik.com", "irecommend.ru"];
    const scoped = domains.map((domain) => `site:${domain}`).join(" OR ");
    const searchQuery = `${query} ${resultKind === "магазин" ? "цена купить" : "отзывы тест обзор"} (${scoped})`;
    const response = await fetch(`https://s.jina.ai/${encodeURIComponent(searchQuery)}`, {
      headers: { accept: "application/json", "x-retain-images": "none" }, cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: unknown };
    if (!Array.isArray(payload.data)) return [];
    return payload.data.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const url = safeUrl(item.url);
      if (!url || (resultKind === "магазин" ? !isDirectStoreUrl(url, intent) : !isReviewUrl(url))) return [];
      const title = typeof item.title === "string" ? productName(item.title) : "";
      const description = typeof item.description === "string" ? clean(item.description, 420) : "";
      return title.length >= 3 ? [{ title, url, description, kind: resultKind } satisfies SearchResult] : [];
    }).filter((result, position, all) => all.findIndex((item) => item.url === result.url) === position).slice(0, 12);
  } catch { return []; }
}
function wbPrice(product: WbProduct) {
  const values = [

    ...(product.sizes ?? []).flatMap((size) => [Number(size.price?.product), Number(size.price?.total)]),
    Number(product.salePriceU),
  ].filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) / 100 : null;
}

async function wildberriesCandidates(query: string): Promise<Candidate[]> {
  try {
    const url = new URL(WB_SEARCH_URL);
    [
      ["ab_testing", "false"], ["appType", "1"], ["curr", "rub"], ["dest", "-1257786"],
      ["query", query], ["resultset", "catalog"], ["sort", "popular"], ["spp", "30"], ["suppressSpellcheck", "false"],
    ].forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; PricePulse/2.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [];
    const payload = await response.json() as { products?: unknown; data?: { products?: unknown } };
    const products = Array.isArray(payload.products) ? payload.products : Array.isArray(payload.data?.products) ? payload.data.products : [];
    const budget = budgetFromQuery(query);
    return products.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const product = raw as WbProduct;
      const id = Number(product.id);
      const rawName = typeof product.name === "string" ? clean(product.name, 100) : "";
      const brand = typeof product.brand === "string" ? clean(product.brand, 50) : "";
      const priceValue = wbPrice(product);
      const ratingValue = Number(product.rating);
      const reviewCount = Number(product.feedbacks);
      if (!Number.isInteger(id) || id <= 0 || !rawName || !priceValue) return [];
      if (budget && priceValue > budget) return [];
      const name = brand && !rawName.toLocaleLowerCase("ru").includes(brand.toLocaleLowerCase("ru"))
        ? brand + " " + rawName
        : rawName;
      const rating = Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : null;
      const reviews = Number.isInteger(reviewCount) && reviewCount >= 0 ? reviewCount : null;
      const priceLabel = formatRub(priceValue);
      const ratingLabel = rating
        ? rating.toFixed(1) + (reviews !== null ? " · " + reviews.toLocaleString("ru-RU") + " отзывов" : "")
        : reviews ? reviews.toLocaleString("ru-RU") + " отзывов" : "Новый товар";
      return [{
        id: "wb-" + id,
        name,
        description: [brand, reviews !== null ? reviews.toLocaleString("ru-RU") + " отзывов" : "", "реальная карточка Wildberries"].filter(Boolean).join(" · "),
        priceValue,
        priceLabel,
        ratingValue: rating,
        ratingLabel,
        reviewCount: reviews,
        popularity: "Реальная карточка",
        sources: [{
          title: "Wildberries · " + name,
          url: "https://www.wildberries.ru/catalog/" + id + "/detail.aspx",
          kind: "магазин" as const,
          priceLabel,
          ratingLabel,
          verified: true as const,
        }],
      }];
    }).sort((a, b) => {
      const relevance = tokenScore(query, b.name) - tokenScore(query, a.name);
      if (relevance) return relevance;
      return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
    }).filter((candidate, position, all) =>
      all.findIndex((item) => item.name.toLocaleLowerCase("ru") === candidate.name.toLocaleLowerCase("ru") && item.priceValue === candidate.priceValue) === position
    ).slice(0, 6);
  } catch {
    return [];
  }
}


function sourceFromSearch(result: SearchResult): Source {
  const priceValue = numericPrice(result.description);
  const ratingValue = numericRating(result.description);
  const reviewCount = numericReviewCount(result.description);
  return {
    title: labelFromUrl(result.url) + " · " + result.title,
    url: result.url,
    kind: result.kind,
    priceLabel: priceValue ? formatRub(priceValue) : undefined,
    ratingLabel: ratingValue
      ? ratingValue.toFixed(1) + " / 5" + (reviewCount !== null ? " · " + reviewCount.toLocaleString("ru-RU") + " отзывов" : "")
      : reviewCount !== null ? reviewCount.toLocaleString("ru-RU") + " отзывов" : undefined,
    verified: true,
  };
}

function candidateFromStoreResult(result: SearchResult, position: number): Candidate {
  const priceValue = numericPrice(result.description);
  const ratingValue = numericRating(result.description);
  const reviewCount = numericReviewCount(result.description);
  return {
    id: "web-" + position + "-" + encodeURIComponent(result.url).slice(-36),
    name: productName(result.title),
    description: clean(result.description || "Прямая карточка товара из результатов рынка", 180),
    priceValue,
    priceLabel: priceValue ? formatRub(priceValue) : "Цена на странице",
    ratingValue,
    ratingLabel: ratingValue
      ? ratingValue.toFixed(1) + " / 5" + (reviewCount !== null ? " · " + reviewCount.toLocaleString("ru-RU") + " отзывов" : "")
      : reviewCount !== null ? reviewCount.toLocaleString("ru-RU") + " отзывов" : "Отзывы на странице",
    reviewCount,
    popularity: "Найдено на рынке",
    sources: [sourceFromSearch(result)],
  };
}

function attachSource(candidate: Candidate, source: Source) {
  if (!candidate.sources.some((item) => item.url === source.url)) candidate.sources.push(source);
}

function mergeMarketCandidates(query: string, wbItems: Candidate[], stores: SearchResult[], reviews: SearchResult[]) {
  const candidates = [...wbItems];
  for (const [position, result] of stores.entries()) {
    const resultText = result.title + " " + result.description;
    let best: Candidate | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = tokenScore(candidate.name, resultText) + tokenScore(query, resultText);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best && bestScore >= 2) {
      attachSource(best, sourceFromSearch(result));
      const discoveredPrice = numericPrice(result.description);
      const discoveredRating = numericRating(result.description);
      const discoveredReviews = numericReviewCount(result.description);
      if (discoveredPrice && (!best.priceValue || discoveredPrice < best.priceValue)) {
        best.priceValue = discoveredPrice;
        best.priceLabel = formatRub(discoveredPrice);
      }
      if (discoveredReviews !== null && discoveredReviews > (best.reviewCount ?? 0)) {
        best.reviewCount = discoveredReviews;
        if (discoveredRating) best.ratingValue = discoveredRating;
      } else if (discoveredRating && !best.ratingValue) {
        best.ratingValue = discoveredRating;
      }
      if (best.ratingValue) {
        best.ratingLabel = best.ratingValue.toFixed(1) + " / 5" + (best.reviewCount !== null ? " · " + best.reviewCount.toLocaleString("ru-RU") + " отзывов" : "");
      } else if (best.reviewCount !== null) {
        best.ratingLabel = best.reviewCount.toLocaleString("ru-RU") + " отзывов";
      }
    } else {
      candidates.push(candidateFromStoreResult(result, position));
    }
  }

  for (const result of reviews) {
    const resultText = result.title + " " + result.description;
    let best: Candidate | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = tokenScore(candidate.name, resultText);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best && bestScore > 0) attachSource(best, sourceFromSearch(result));
  }

  const budget = budgetFromQuery(query);
  const queryTokenCount = Math.max(1, queryTokens(query).length);
  return candidates
    .filter((candidate) => !budget || !candidate.priceValue || candidate.priceValue <= budget)
    .map((candidate) => ({
      candidate,
      relevance: tokenScore(query, candidate.name + " " + candidate.description) / queryTokenCount,
    }))
    .filter(({ relevance }, position) => relevance > 0 || position < 3)
    .sort((left, right) => {
      if (right.relevance !== left.relevance) return right.relevance - left.relevance;
      const reviewDelta = (right.candidate.reviewCount ?? 0) - (left.candidate.reviewCount ?? 0);
      if (reviewDelta) return reviewDelta;
      return (left.candidate.priceValue ?? Number.MAX_SAFE_INTEGER) - (right.candidate.priceValue ?? Number.MAX_SAFE_INTEGER);
    })
    .map(({ candidate }) => candidate)
    .filter((candidate, position, all) =>
      all.findIndex((item) => item.name.toLocaleLowerCase("ru") === candidate.name.toLocaleLowerCase("ru")) === position
    )
    .slice(0, 6);
}

function lisTokens(query: string) {
  const translated = query.toLocaleLowerCase("ru")
    .replace(/кс\s*2|ксго|counter.?strike|csgo/g, " cs2 ")
    .replace(/глок(?:а|ом|у)?/g, " glock-18 ")
    .replace(/калаш(?:а|ом|у)?|ак-?47/g, " ak-47 ")
    .replace(/эмк[ау]|m4a1/g, " m4a1 ")
    .replace(/розов\p{L}*/gu, " pink ")
    .replace(/золот\p{L}*/gu, " gold ")
    .replace(/фиолетов\p{L}*/gu, " purple ")
    .replace(/красн\p{L}*/gu, " red ")
    .replace(/син\p{L}*/gu, " blue ");
  const stopWords = new Set(["cs2", "skin", "skins", "скин", "скины", "новый", "новая", "новое", "новой", "коллекция", "коллекции", "из", "для", "the", "and"]);
  return translated.split(/[^\p{L}\p{N}-]+/u).filter((token) => token.length > 1 && !stopWords.has(token));
}

async function lisCandidatesFor(query: string): Promise<Candidate[]> {
  try {
    let items = lisCatalogueCache?.expiresAt && lisCatalogueCache.expiresAt > Date.now() ? lisCatalogueCache.items : null;
    if (!items) {
      const response = await fetch(LIS_EXPORT_URL, {
        headers: { accept: "application/json", "user-agent": "PricePulse/2.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) return [];
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) return [];
      items = payload.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const url = safeUrl(item.url);
        return typeof item.name === "string" && typeof item.price === "number" && item.price > 0 && url
          ? [{ name: clean(item.name, 120), price: item.price, url, count: typeof item.count === "number" ? item.count : 0 }]
          : [];
      });
      lisCatalogueCache = { items, expiresAt: Date.now() + LIS_CACHE_TTL_MS };
    }

    const tokens = lisTokens(query);
    if (!tokens.length) return [];
    return items.map((item) => {
      const haystack = item.name.toLocaleLowerCase("en");
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? (token.includes("glock") || token === "pink" ? 3 : 1) : 0), 0);
      return { item, score };
    }).filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || (right.item.count ?? 0) - (left.item.count ?? 0))
      .slice(0, 6)
      .map(({ item }, position) => {
        const encoded = encodeURIComponent(item.name);
        const offers = item.count ?? 0;
        return {
          id: "lis-" + position + "-" + encoded.slice(-32),
          name: item.name,
          description: "Реальная позиция каталога LIS-SKINS · " + offers.toLocaleString("ru-RU") + " предложений",
          priceValue: item.price,
          priceLabel: "$" + item.price.toLocaleString("en-US", { maximumFractionDigits: 2 }),
          ratingValue: null,
          ratingLabel: offers.toLocaleString("ru-RU") + " предложений",
          reviewCount: offers,
          popularity: offers > 20 ? "Много предложений" : "CS2-маркет",
          sources: [
            { title: "LIS-SKINS · точная карточка", url: item.url, kind: "магазин", priceLabel: "$" + item.price.toFixed(2), ratingLabel: offers + " предложений", verified: true },
            { title: "Steam Community Market · точный лот", url: "https://steamcommunity.com/market/listings/730/" + encoded, kind: "магазин", verified: true },
            { title: "CSFloat · точное имя предмета", url: "https://csfloat.com/search?market_hash_name=" + encoded, kind: "магазин", verified: true },
          ],
        };
      });
  } catch {
    return [];
  }
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

async function rankWithOpenRouter(query: string, candidates: Candidate[]) {
  const runtime = process.env as RuntimeEnv;
  const apiKey = runtime.OPENROUTER_API_KEY?.trim();
  if (!apiKey || candidates.length < 2) return { candidates, used: false };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + apiKey,
        "content-type": "application/json",
        "http-referer": runtime.WEBAPP_URL?.trim() || "https://pricepulse-app.bokcerkbr.chatgpt.site",
        "x-title": "PricePulse",
      },
      body: JSON.stringify({
        model: runtime.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 350,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Ты ранжируешь только предоставленные реальные карточки. Не придумывай товары, цены, оценки или ссылки. Верни JSON вида {\"ordered_ids\":[\"id\"]}.",
          },
          {
            role: "user",
            content: JSON.stringify({
              query,
              candidates: candidates.map((candidate) => ({
                id: candidate.id,
                name: candidate.name,
                price: candidate.priceLabel,
                rating: candidate.ratingLabel,
                reviews: candidate.reviewCount,
                sources: candidate.sources.length,
              })),
            }),
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(18_000),
    });
    if (!response.ok) return { candidates, used: false };
    const rawContent = openRouterContent(await response.json()).trim();
    const firstBrace = rawContent.indexOf("{");
    const lastBrace = rawContent.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return { candidates, used: false };
    const parsed = JSON.parse(rawContent.slice(firstBrace, lastBrace + 1)) as { ordered_ids?: unknown };
    if (!Array.isArray(parsed.ordered_ids)) return { candidates, used: false };
    const order = parsed.ordered_ids.filter((id): id is string => typeof id === "string");
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const ranked = order.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
    for (const candidate of candidates) if (!ranked.includes(candidate)) ranked.push(candidate);
    return { candidates: ranked, used: ranked.length > 0 };
  } catch {
    return { candidates, used: false };
  }
}

function labelCandidates(candidates: Candidate[]) {
  const priced = candidates.filter((candidate) => candidate.priceValue !== null);
  const cheapest = priced.length
    ? priced.reduce((best, candidate) => (candidate.priceValue ?? Infinity) < (best.priceValue ?? Infinity) ? candidate : best)
    : null;
  const reviewed = candidates.reduce<Candidate | null>((best, candidate) =>
    (candidate.reviewCount ?? 0) > (best?.reviewCount ?? 0) ? candidate : best
  , null);
  return candidates.map((candidate, index) => {
    let popularity = candidate.popularity;
    if (candidate === cheapest && priced.length > 1) popularity = "Выгодная цена";
    else if (candidate === reviewed && (candidate.reviewCount ?? 0) > 0) popularity = "Больше всего отзывов";
    else if ((candidate.ratingValue ?? 0) >= 4.7) popularity = "Высокая оценка";
    else if (candidate.sources.length > 1) popularity = "Сравнено " + candidate.sources.length + " источника";
    else if (index === 0) popularity = "Лучшее совпадение";
    return { ...candidate, popularity };
  });
}

function publicCandidate(candidate: Candidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    priceLabel: candidate.priceLabel,
    ratingLabel: candidate.ratingLabel,
    popularity: candidate.popularity,
    sourceCount: candidate.sources.length,
    sources: candidate.sources,
  };
}

export async function POST(request: Request) {
  let body: { query?: unknown; externalSearchConsent?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "Введите запрос для поиска" }, { status: 400 });
  }
  if (body.externalSearchConsent !== true) {
    return Response.json({ error: "Подтвердите передачу текста запроса внешнему AI-поиску" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 120) {
    return Response.json({ error: "Запрос должен содержать от 2 до 120 символов" }, { status: 400 });
  }
  if (/@|(?:\+?\d[\s()-]*){10,}/.test(query)) {
    return Response.json({ error: "Не добавляйте в поисковый запрос телефон или e-mail" }, { status: 400 });
  }

  const intent = inferIntent(query);
  const marketQuery = catalogueQuery(query);
  let candidates: Candidate[] = [];
  if (intent === "cs2") {
    candidates = await lisCandidatesFor(query);
  } else {
    const [wbResult, storeResult, reviewResult, jinaStoreResult, jinaReviewResult] = await Promise.allSettled([
      wildberriesCandidates(marketQuery),
      duckSearch(marketQuery, intent, "магазин"),
      duckSearch(marketQuery, intent, "обзор"),
      jinaSearch(marketQuery, intent, "магазин"),
      jinaSearch(marketQuery, intent, "обзор"),
    ]);
    const wbItems = wbResult.status === "fulfilled" ? wbResult.value : [];
    const stores = [...(storeResult.status === "fulfilled" ? storeResult.value : []), ...(jinaStoreResult.status === "fulfilled" ? jinaStoreResult.value : [])]
      .filter((result, position, all) => all.findIndex((item) => item.url === result.url) === position);
    const reviews = [...(reviewResult.status === "fulfilled" ? reviewResult.value : []), ...(jinaReviewResult.status === "fulfilled" ? jinaReviewResult.value : [])]
      .filter((result, position, all) => all.findIndex((item) => item.url === result.url) === position);
    candidates = mergeMarketCandidates(query, wbItems, stores, reviews);
  }

  if (!candidates.length) {
    return Response.json({
      error: "Не удалось получить подтверждённые карточки из магазинов. Попробуйте уточнить модель, бренд или характеристики.",
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }

  const ranked = await rankWithOpenRouter(query, candidates);
  const products = labelCandidates(ranked.candidates).map(publicCandidate);
  const checkedAt = new Date().toISOString();
  return Response.json({
    query,
    intent,
    engine: ranked.used ? "openrouter-live-market" : intent === "cs2" ? "cs2-live-catalog" : "live-market",
    checkedAt,
    summary: intent === "cs2"
      ? "Найдены реальные позиции актуального каталога LIS-SKINS. Для каждой показаны точная карточка и ссылки на профильные CS2-маркеты."
      : "PricePulse изучил доступные карточки магазинов и обзоры. Цены, оценки и ссылки взяты с найденных страниц, а не созданы из текста запроса.",
    products,
  }, { headers: { "cache-control": "no-store" } });
}

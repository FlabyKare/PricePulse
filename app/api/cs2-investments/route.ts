import { and, asc, gte, inArray, lt } from "drizzle-orm";
import { cs2MarketSnapshots } from "@/db/schema";

type LisItem = { name: string; price: number; unlocked_price?: number; url: string; count: number };
type ItemType = "Скин" | "Наклейка" | "Кейс / капсула";
type MarketSource = { title: string; url: string; description: string; publisher: string };
type HistoryPoint = { priceUsd: number; capturedAt: string };

const LIS_EXPORT_URL = "https://lis-skins.com/market_export_json/csgo.json";
const CATALOGUE_TTL_MS = 5 * 60 * 1000;
const RESPONSE_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_BUCKET_SECONDS = 6 * 60 * 60;
let catalogueCache: { items: LisItem[]; expiresAt: number } | null = null;
let responseCache: { payload: Record<string, unknown>; expiresAt: number } | null = null;

const seedSources: MarketSource[] = [
  { title: "Новости Counter-Strike", url: "https://www.counter-strike.net/news", description: "Официальные обновления, турниры и изменения экономики предметов.", publisher: "Counter-Strike" },
  { title: "Steam Community Market", url: "https://steamcommunity.com/market/search?appid=730", description: "Официальная площадка Steam для проверки цены и объёма предложений.", publisher: "Steam" },
  { title: "Каталог предметов CS2", url: "https://lis-skins.com/market/csgo/", description: "Текущие цены и доступные предложения предметов CS2.", publisher: "LIS-SKINS" },
  { title: "Ликвидность капсул CS2", url: "https://www.steamanalyst.com/liquidity?type=Capsule", description: "Публичный обзор ликвидности капсул и пакетов.", publisher: "SteamAnalyst" },
];

function clean(value: string, limit = 420) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
}

async function catalogue() {
  if (catalogueCache && catalogueCache.expiresAt > Date.now()) return catalogueCache.items;
  const response = await fetch(LIS_EXPORT_URL, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(9_000) });
  if (!response.ok) throw new Error(`LIS-SKINS вернул ошибку ${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error("Каталог LIS-SKINS имеет неизвестный формат");
  const items = payload.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const url = safeUrl(item.url);
    return typeof item.name === "string" && typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0 && url
      ? [{ name: clean(item.name, 160), price: item.price, unlocked_price: typeof item.unlocked_price === "number" ? item.unlocked_price : undefined, url, count: typeof item.count === "number" ? Math.max(0, item.count) : 0 }]
      : [];
  });
  catalogueCache = { items, expiresAt: Date.now() + CATALOGUE_TTL_MS };
  return items;
}

function itemType(name: string): ItemType | null {
  if (/^Sticker\s*\|/i.test(name)) return "Наклейка";
  if (/\b(?:Case|Capsule|Package)\b/i.test(name)) return "Кейс / капсула";
  if (/^(?:StatTrak™\s+|Souvenir\s+)?(?:AK-47|AWP|M4A1-S|M4A4|Glock-18|USP-S|Desert Eagle|FAMAS|Galil AR|MP9|MAC-10|P250|Five-SeveN|Tec-9)\s*\|/i.test(name)) return "Скин";
  return null;
}

function itemKey(item: LisItem) {
  try { return new URL(item.url).pathname.replace(/\/+$/, "").split("/").pop() || encodeURIComponent(item.name); } catch { return encodeURIComponent(item.name); }
}

function releaseYear(name: string) {
  const matches = [...name.matchAll(/\b(20(?:1[4-9]|2[0-6]))\b/g)].map((match) => Number(match[1]));
  return matches.length ? Math.min(...matches) : null;
}

function baseScore(item: LisItem, type: ItemType) {
  const year = releaseYear(item.name);
  let score = type === "Наклейка" ? 48 : type === "Кейс / капсула" ? 51 : 43;
  if (/\bHolo\b/i.test(item.name)) score += 10;
  if (/\bGold\b|Foil/i.test(item.name)) score += 8;
  if (year && year <= 2021) score += Math.min(14, (2022 - year) * 2);
  if (year && year >= 2025) score += 3;
  if (/AK-47|AWP|M4A1-S|Glock-18|USP-S/i.test(item.name)) score += 8;
  if (item.price >= 1 && item.price <= 250) score += 6;
  if (item.count >= 2 && item.count <= 25) score += 7;
  if (item.count > 25) score += 3;
  return Math.max(0, Math.min(86, score));
}

function chooseUniverse(items: LisItem[]) {
  const ranked = items.flatMap((item) => {
    const type = itemType(item.name);
    return type && item.count > 0 && item.price >= 0.5 && item.price <= 5_000 ? [{ item, type, score: baseScore(item, type) }] : [];
  }).sort((a, b) => b.score - a.score || b.item.count - a.item.count);
  const limits: Record<ItemType, number> = { "Наклейка": 4, "Кейс / капсула": 3, "Скин": 4 };
  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    if (selected.filter((item) => item.type === candidate.type).length >= limits[candidate.type]) continue;
    const family = candidate.item.name.replace(/\s*\([^)]*\)\s*$/, "").toLocaleLowerCase("en");
    if (selected.some((item) => item.item.name.replace(/\s*\([^)]*\)\s*$/, "").toLocaleLowerCase("en") === family)) continue;
    selected.push(candidate);
    if (selected.length >= 11) break;
  }
  return selected;
}

async function publicSources(): Promise<MarketSource[]> {
  try {
    const response = await fetch(`https://s.jina.ai/${encodeURIComponent("CS2 market latest stickers capsules skins collection update price report")}`, {
      headers: { accept: "application/json", "x-retain-images": "none" }, cache: "no-store", signal: AbortSignal.timeout(6_500),
    });
    if (!response.ok) return seedSources;
    const payload = await response.json() as { data?: unknown };
    const web = Array.isArray(payload.data) ? payload.data.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const url = safeUrl(item.url);
      const title = typeof item.title === "string" ? clean(item.title, 150) : "";
      const description = typeof item.description === "string" ? clean(item.description, 330) : "";
      if (!url || !title) return [];
      let publisher = "Источник";
      try { publisher = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep fallback */ }
      return [{ title, url, description, publisher }];
    }).slice(0, 7) : [];
    return [...web, ...seedSources].filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index).slice(0, 10);
  } catch { return seedSources; }
}

async function historyFor(keys: string[]) {
  const result = new Map<string, HistoryPoint[]>();
  if (!keys.length) return result;
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { getDb } = await import("@/db");
    const db = getDb();
    const rows = await db.select({ itemKey: cs2MarketSnapshots.itemKey, priceUsd: cs2MarketSnapshots.priceUsd, capturedAt: cs2MarketSnapshots.capturedAt })
      .from(cs2MarketSnapshots)
      .where(and(inArray(cs2MarketSnapshots.itemKey, keys), gte(cs2MarketSnapshots.capturedAt, since)))
      .orderBy(asc(cs2MarketSnapshots.capturedAt));
    rows.forEach((row) => result.set(row.itemKey, [...(result.get(row.itemKey) ?? []), { priceUsd: row.priceUsd, capturedAt: row.capturedAt }]));
  } catch { /* Local previews and first migration boot can work without history. */ }
  return result;
}

async function persistSnapshots(items: Array<{ item: LisItem; type: ItemType }>) {
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    const bucket = Math.floor(Date.now() / 1000 / SNAPSHOT_BUCKET_SECONDS);
    await db.insert(cs2MarketSnapshots).values(items.map(({ item, type }) => ({
      itemKey: itemKey(item), name: item.name, itemType: type, priceUsd: item.price,
      lisOffers: item.count, sourceUrl: item.url, bucket,
    }))).onConflictDoNothing();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await db.delete(cs2MarketSnapshots).where(lt(cs2MarketSnapshots.capturedAt, cutoff));
  } catch { /* Live ranking remains available if D1 is temporarily unavailable. */ }
}

function momentum(points: HistoryPoint[], current: number) {
  if (points.length < 2 || !points[0]?.priceUsd) return null;
  return Math.round(((current - points[0].priceUsd) / points[0].priceUsd) * 10_000) / 100;
}

function reasons(item: LisItem, type: ItemType, change: number | null) {
  const year = releaseYear(item.name);
  const result: string[] = [];
  if (type === "Наклейка" && /Holo/i.test(item.name)) result.push("Holo-эффект поддерживает спрос со стороны крафтов");
  if (type === "Наклейка" && /Gold|Foil/i.test(item.name)) result.push("Редкая финишная версия предмета");
  if (year && year <= 2021) result.push(`Старый турнирный выпуск ${year} года с ограниченным пополнением`);
  if (year && year >= 2025) result.push("Свежий событийный предмет: возможен импульс, но высок риск переоценки");
  if (type === "Скин" && /AK-47|AWP|M4A1-S|Glock-18|USP-S/i.test(item.name)) result.push("Популярное оружие поддерживает игровую ликвидность");
  if (type === "Кейс / капсула") result.push("Расходуемый предмет: открытия постепенно уменьшают доступный запас");
  if (item.count <= 10) result.push(`На LIS-SKINS сейчас ${item.count} предложений — это локальный, не глобальный остаток`);
  if (change !== null) result.push(`За период наблюдения PricePulse: ${change > 0 ? "+" : ""}${change}%`);
  return result.slice(0, 4);
}

function catalysts(type: ItemType) {
  if (type === "Наклейка") return ["рост числа крафтов", "завершение продаж выпуска", "результаты команды или игрока"];
  if (type === "Кейс / капсула") return ["вывод из активного дропа", "рост числа открытий", "снижение доступных предложений"];
  return ["ротация коллекций", "визуальные изменения в обновлениях", "рост спроса на оружие и trade-up"];
}

export async function GET() {
  if (responseCache && responseCache.expiresAt > Date.now()) return Response.json(responseCache.payload, { headers: { "cache-control": "private, max-age=60" } });
  try {
    const [items, sources] = await Promise.all([catalogue(), publicSources()]);
    const universe = chooseUniverse(items);
    const keys = universe.map(({ item }) => itemKey(item));
    const history = await historyFor(keys);
    const ideas = universe.map(({ item, type, score }) => {
      const key = itemKey(item);
      const points = history.get(key) ?? [];
      const change = momentum(points, item.price);
      const potentialScore = Math.max(0, Math.min(100, Math.round(score + (change === null ? 0 : Math.max(-12, Math.min(12, change / 2))))));
      const exactSteam = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(item.name)}`;
      const sourceUrls = [item.url, exactSteam, ...sources.slice(0, 2).map((source) => source.url)];
      return {
        id: key,
        name: item.name,
        itemType: type,
        priceUsd: item.price,
        priceLabel: `$${item.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
        lisOffers: item.count,
        momentum30d: change,
        historyPoints: points.length,
        potentialScore,
        scoreLabel: change !== null && change >= 5 ? "Есть ценовой импульс" : potentialScore >= 70 ? "Сильный кандидат для наблюдения" : "Наблюдать",
        horizon: type === "Кейс / капсула" ? "6–18 месяцев" : type === "Наклейка" && (releaseYear(item.name) ?? 2026) <= 2021 ? "3–12 месяцев" : "1–6 месяцев",
        confidence: points.length >= 3 ? "средняя" : "низкая — копим историю",
        risk: potentialScore >= 72 && points.length >= 3 ? "высокий" : "очень высокий",
        reasons: reasons(item, type, change),
        catalysts: catalysts(type),
        sourceUrls,
        itemUrl: item.url,
      };
    }).sort((a, b) => b.potentialScore - a.potentialScore).slice(0, 9);
    await persistSnapshots(universe);
    const payload = {
      updatedAt: new Date().toISOString(),
      mode: "live-cs2-market",
      methodology: "Баллы учитывают тип предмета, возраст выпуска, вариант Holo/Gold, популярность оружия, текущую цену, число предложений LIS-SKINS и накопленную PricePulse динамику. Балл — эвристика, а не вероятность роста.",
      disclaimer: "Предметы CS2 крайне волатильны и не являются финансовыми активами. Это кандидаты для исследования, не гарантия роста. Проверяйте цену, ликвидность и новости в нескольких источниках.",
      ideas,
      sources,
    };
    responseCache = { payload, expiresAt: Date.now() + RESPONSE_TTL_MS };
    return Response.json(payload, { headers: { "cache-control": "private, max-age=60" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось обновить CS2-радар" }, { status: 502 });
  }
}

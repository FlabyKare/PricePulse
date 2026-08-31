import { and, eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { profileStates } from "@/db/schema";
import { findLisSkinsItem, isLisSkinsUrl, parseCbrUsdRate, rubPriceFromUsd, type LisSkinsExportItem } from "@/lib/lis-skins";
import {
  applyObservedPrice,
  isPriceCheckDue,
  priceNotification,
  type MonitoredProduct,
} from "@/lib/price-monitor";

type RuntimeEnv = { BOT_TOKEN?: string; TELEGRAM_BOT_ID?: string };

const MAX_PROFILES_PER_RUN = 25;
const MAX_CHECKS_PER_RUN = 12;
const LIS_EXPORT_URL = "https://lis-skins.com/market_export_json/csgo.json";
const CBR_RATES_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const SUPPORTED_DOMAINS = ["ozon.ru", "market.yandex.ru", "wildberries.ru", "wb.ru", "dns-shop.ru", "mvideo.ru", "citilink.ru", "lamoda.ru", "goldapple.ru", "letu.ru", "avito.ru", "hoff.ru", "vseinstrumenti.ru", "exist.ru", "emex.ru", "autodoc.ru"];
let lisCache: { items: LisSkinsExportItem[]; rate: number; expiresAt: number } | null = null;

function parseProducts(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as MonitoredProduct[] : [];
  } catch {
    return [];
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (symbol) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[symbol] ?? symbol);
}

function formatRub(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

async function verifiedMonitorToken(request: Request, runtime: RuntimeEnv) {
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!presented) return null;
  const configuredToken = runtime.BOT_TOKEN?.trim();
  if (configuredToken) return presented === configuredToken ? presented : null;
  const configuredBotId = runtime.TELEGRAM_BOT_ID?.trim();
  if (!configuredBotId) return null;
  try {
    const response = await fetch(`https://api.telegram.org/bot${presented}/getMe`, {
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json() as { ok?: boolean; result?: { id?: string | number } };
    return response.ok && body.ok && String(body.result?.id ?? "") === configuredBotId ? presented : null;
  } catch {
    return null;
  }
}

async function lisCatalogue() {
  if (lisCache && lisCache.expiresAt > Date.now()) return lisCache;
  const [catalogueResponse, ratesResponse] = await Promise.all([
    fetch(LIS_EXPORT_URL, { signal: AbortSignal.timeout(12_000) }),
    fetch(CBR_RATES_URL, { signal: AbortSignal.timeout(8_000) }),
  ]);
  if (!catalogueResponse.ok || !ratesResponse.ok) throw new Error("Источник цен временно недоступен");
  const items = await catalogueResponse.json() as LisSkinsExportItem[];
  const rate = parseCbrUsdRate(await ratesResponse.text());
  if (!Array.isArray(items) || !rate) throw new Error("Источник цен вернул некорректные данные");
  lisCache = { items, rate: rate * 1.03, expiresAt: Date.now() + 5 * 60 * 1000 };
  return lisCache;
}

function isSupportedStore(url: URL) {
  const host = url.hostname.toLocaleLowerCase("en").replace(/^www\./, "");
  return SUPPORTED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function rubPriceFromPage(html: string) {
  const decoded = html.replace(/&nbsp;|&#160;/gi, " ").replace(/&rub;|&#8381;/gi, "₽");
  const matches = [...decoded.matchAll(/(?:^|[^\d])((?:\d{1,3}(?:[\s\u00a0]\d{3})+|\d{2,8})(?:[,.]\d{1,2})?)\s*(?:₽|руб(?:\.|лей)?)/gim)];
  for (const match of matches) {
    const price = Number(match[1].replace(/[\s\u00a0]/g, "").replace(",", "."));
    if (Number.isFinite(price) && price > 0 && price <= 100_000_000) return price;
  }
  return null;
}

async function resolvePrice(product: MonitoredProduct) {
  if (isLisSkinsUrl(product.url)) {
    const catalogue = await lisCatalogue();
    const item = findLisSkinsItem(catalogue.items, product.url);
    if (!item?.price || item.price <= 0) throw new Error("Товар не найден в LIS-SKINS");
    return rubPriceFromUsd(item.price, catalogue.rate);
  }
  const url = new URL(product.url);
  if (url.protocol !== "https:" || !isSupportedStore(url)) throw new Error("Магазин не поддерживается");
  const response = await fetch(url.href, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ru-RU,ru;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; PricePulse/1.0; +https://pricepulse-app.bokcerkbr.chatgpt.site)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Магазин вернул ${response.status}`);
  const price = rubPriceFromPage((await response.text()).slice(0, 500_000));
  if (!price) throw new Error("Цена не распознана");
  return price;
}

async function sendPriceNotification(
  token: string,
  chatId: string,
  webAppUrl: string,
  product: MonitoredProduct,
  notification: NonNullable<ReturnType<typeof priceNotification>>,
) {
  const title = notification.targetReached ? "🎯 <b>Целевая цена достигнута</b>" : "🔔 <b>Цена изменилась</b>";
  const direction = notification.percent > 0 ? "выросла" : "снизилась";
  const text = [
    title,
    "",
    `<b>${escapeHtml(product.name)}</b>`,
    `Цена ${direction} на ${Math.abs(notification.percent).toLocaleString("ru-RU")}%.`,
    `Было: <s>${formatRub(notification.previous)}</s>`,
    `Стало: <b>${formatRub(notification.next)}</b>`,
  ].join("\n");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "Открыть PricePulse", web_app: { url: webAppUrl } }]] },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Telegram API: ${response.status}`);
}

export async function POST(request: Request) {
  const runtime = env as unknown as RuntimeEnv;
  if (!runtime.BOT_TOKEN?.trim() && !runtime.TELEGRAM_BOT_ID?.trim()) {
    return Response.json({ error: "Telegram-бот не настроен" }, { status: 503 });
  }
  const token = await verifiedMonitorToken(request, runtime);
  if (!token) return Response.json({ error: "Недостаточно прав" }, { status: 401 });

  const db = getDb();
  const profiles = await db.select().from(profileStates).limit(MAX_PROFILES_PER_RUN);
  const webAppUrl = new URL(request.url).origin;
  const now = Date.now();
  const capturedAt = new Date(now).toISOString();
  let checked = 0;
  let notified = 0;
  let failed = 0;

  for (const profile of profiles) {
    if (checked >= MAX_CHECKS_PER_RUN) break;
    const products = parseProducts(profile.productsJson);
    let profileChanged = false;
    const notifications: Array<{ product: MonitoredProduct; value: NonNullable<ReturnType<typeof priceNotification>> }> = [];

    for (let index = 0; index < products.length && checked < MAX_CHECKS_PER_RUN; index += 1) {
      const product = products[index];
      if (!product || !product.url || !isPriceCheckDue(product, now)) continue;
      checked += 1;
      try {
        const nextPrice = await resolvePrice(product);
        const notification = priceNotification(product, nextPrice);
        products[index] = applyObservedPrice(product, nextPrice, capturedAt);
        profileChanged = true;
        if (notification) notifications.push({ product, value: notification });
      } catch {
        failed += 1;
      }
    }

    if (!profileChanged) continue;
    const [saved] = await db.update(profileStates).set({
      productsJson: JSON.stringify(products),
      revision: sql`${profileStates.revision} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(profileStates.userId, profile.userId),
      eq(profileStates.revision, profile.revision),
    )).returning({ revision: profileStates.revision });
    if (!saved) continue;

    for (const item of notifications) {
      try {
        await sendPriceNotification(token, profile.userId, webAppUrl, item.product, item.value);
        notified += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return Response.json({ ok: true, profiles: profiles.length, checked, notified, failed }, {
    headers: { "cache-control": "no-store" },
  });
}

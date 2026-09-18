import { and, eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { profileStates, telegramUsers } from "@/db/schema";
import { verifiedBotToken } from "@/lib/bot-auth";
import { isLisSkinsUrl } from "@/lib/lis-skins";
import { alertSettings, applyObservedPrice, calibratedPrice, priceNotification, type MonitoredProduct } from "@/lib/price-monitor";
import { assertSafePublicProductUrl, inferredNameFromUrl } from "@/lib/store-product";
import { POST as discoverProduct } from "@/app/api/discover/route";
import { POST as resolveProduct } from "@/app/api/products/resolve/route";

type BotAction = "consent" | "list" | "find" | "add" | "delete" | "alert" | "check" | "search" | "history" | "interval";
type Payload = {
  userId?: unknown;
  action?: unknown;
  input?: unknown;
  productId?: unknown;
  manualPrice?: unknown;
  mode?: unknown;
  threshold?: unknown;
  query?: unknown;
  page?: unknown;
  hours?: unknown;
};
type Runtime = { PRICEPULSE_ACCESS_MODE?: string; ALLOWED_TELEGRAM_USER_IDS?: string };
type Product = MonitoredProduct & {
  category?: string;
  oldPrice?: number;
  art?: string;
  artClass?: string;
  favorite?: boolean;
  imageUrl?: string;
};
type Resolved = {
  source: string;
  name: string;
  url: string;
  priceRub: number | null;
  count?: number;
  imageUrl?: string | null;
};
type State = typeof profileStates.$inferSelect;

const MAX_PRODUCTS = 250;

function productsFrom(state: State | undefined): Product[] {
  try {
    const products = JSON.parse(state?.productsJson ?? "[]");
    return Array.isArray(products) ? products as Product[] : [];
  } catch {
    return [];
  }
}

function deletedFrom(state: State | undefined): number[] {
  try {
    const ids = JSON.parse(state?.deletedProductIdsJson ?? "[]");
    return Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

async function delegatedPost(
  request: Request,
  path: string,
  body: unknown,
  handler: (request: Request) => Promise<Response>,
) {
  const response = await handler(new Request(new URL(path, request.url), {
    method: "POST",
    headers: {
      authorization: request.headers.get("authorization") ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }));
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Источник временно недоступен");
  return data;
}

async function saveMutation<T>(
  userId: string,
  change: (products: Product[], tombstones: number[]) => { products: Product[]; tombstones: number[]; result: T },
): Promise<T> {
  const db = getDb();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [stored] = await db.select().from(profileStates).where(eq(profileStates.userId, userId)).limit(1);
    const next = change(productsFrom(stored), deletedFrom(stored));
    if (next.products.length > MAX_PRODUCTS) throw new Error("Достигнут лимит в 250 товаров");
    const productsJson = JSON.stringify(next.products);
    if (productsJson.length > 700_000) throw new Error("Профиль превысил допустимый размер");
    const deletedProductIdsJson = JSON.stringify(next.tombstones.slice(-500));
    if (!stored) {
      try {
        await db.insert(profileStates).values({
          userId,
          productsJson,
          deletedProductIdsJson,
        });
        return next.result;
      } catch {
        continue;
      }
    }
    const [saved] = await db.update(profileStates).set({
      productsJson,
      deletedProductIdsJson,
      revision: sql`${profileStates.revision} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(profileStates.userId, userId),
      eq(profileStates.revision, stored.revision),
    )).returning({ revision: profileStates.revision });
    if (saved) return next.result;
  }
  throw new Error("Профиль изменился одновременно. Повторите команду");
}

export async function POST(request: Request) {
  const token = await verifiedBotToken(request);
  if (!token) return error("Недостаточно прав", 401);
  let body: Payload;
  try { body = await request.json() as Payload; }
  catch { return error("Некорректная команда"); }
  const userId = typeof body.userId === "string" ? body.userId : "";
  const action = body.action as BotAction;
  if (!/^\d{1,20}$/.test(userId)) return error("Некорректный Telegram ID");
  if (!["consent", "list", "find", "add", "delete", "alert", "check", "search", "history", "interval"].includes(action)) return error("Неизвестная команда");
  const runtime = env as unknown as Runtime;
  if (runtime.PRICEPULSE_ACCESS_MODE?.trim().toLowerCase() !== "public") {
    const allowed = new Set((runtime.ALLOWED_TELEGRAM_USER_IDS ?? "").split(",").map((value) => value.trim()));
    if (!allowed.has(userId)) return error("PricePulse работает в закрытом персональном режиме", 403);
  }

  try {
    const db = getDb();
    if (action === "search") {
      const query = typeof body.query === "string" ? body.query.trim() : "";
      const data = await delegatedPost(request, "/api/discover", { query, externalSearchConsent: true }, discoverProduct);
      return Response.json(data, { headers: { "cache-control": "no-store" } });
    }
    if (action === "consent") {
      await db.insert(telegramUsers).values({
        id: userId,
        firstName: "Telegram user",
        lastAuthAt: Math.floor(Date.now() / 1000),
      }).onConflictDoNothing();
      return Response.json({ ok: true });
    }
    const [user] = await db.select({ id: telegramUsers.id }).from(telegramUsers).where(eq(telegramUsers.id, userId)).limit(1);
    if (!user && ["add", "alert", "check", "delete", "interval"].includes(action)) {
      return error("Сначала подтвердите хранение профиля командой /agree", 428);
    }
    const [state] = await db.select().from(profileStates).where(eq(profileStates.userId, userId)).limit(1);
    const products = productsFrom(state);
    if (action === "list") {
      const page = Number(body.page ?? 1);
      if (!Number.isInteger(page) || page < 1 || page > 25) return error("Укажите страницу от 1 до 25");
      return Response.json({ products: products.slice((page - 1) * 10, page * 10), total: products.length });
    }
    if (action === "find") {
      const query = typeof body.query === "string" ? body.query.trim().toLocaleLowerCase("ru") : "";
      if (query.length < 2 || query.length > 100) return error("Укажите от 2 до 100 символов для поиска");
      return Response.json({ products: products.filter((product) =>
        `${product.name} ${product.source}`.toLocaleLowerCase("ru").includes(query)).slice(0, 25) });
    }

    const productId = Number(body.productId);
    if (action !== "add" && (!Number.isSafeInteger(productId) || productId <= 0)) return error("Укажите ID товара из /list");
    if (action === "history") {
      const product = products.find((item) => item.id === productId);
      if (!product) return error("Карточка не найдена. Посмотрите ID в /list", 404);
      return Response.json({ product, history: (product.priceHistory ?? []).slice(-10) });
    }
    if (action === "interval") {
      const hours = Number(body.hours);
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) return error("Период проверки должен быть от 1 до 168 часов");
      const updated = await saveMutation(userId, (current, tombstones) => {
        const product = current.find((item) => item.id === productId);
        if (!product) throw new Error("Карточка не найдена. Посмотрите ID в /list");
        const next: Product = { ...product, period: hours, nextCheck: `через ${hours} ч` };
        return { products: current.map((item) => item.id === productId ? next : item), tombstones, result: next };
      });
      return Response.json({ product: updated });
    }
    if (action === "delete") {
      const deleted = await saveMutation(userId, (current, tombstones) => {
        const product = current.find((item) => item.id === productId);
        if (!product) throw new Error("Карточка не найдена. Посмотрите ID в /list");
        return {
          products: current.filter((item) => item.id !== productId),
          tombstones: [...new Set([...tombstones, productId])],
          result: product,
        };
      });
      return Response.json({ deleted });
    }
    if (action === "alert") {
      const threshold = Number(body.threshold);
      const mode = body.mode === "percent" ? "percent" : "amount";
      const max = mode === "percent" ? 100 : 100_000_000;
      const min = mode === "percent" ? 0.1 : 1;
      if (!Number.isFinite(threshold) || (threshold !== 0 && threshold < min) || threshold > max) {
        return error(mode === "percent" ? "Порог должен быть от 0,1% до 100%" : "Порог должен быть от 1 до 100 000 000 ₽");
      }
      const updated = await saveMutation(userId, (current, tombstones) => {
        const product = current.find((item) => item.id === productId);
        if (!product) throw new Error("Карточка не найдена. Посмотрите ID в /list");
        const next: Product = {
          ...product,
          alertMode: mode,
          alertThreshold: threshold || undefined,
          alertReferencePrice: threshold ? product.price : undefined,
          alertCheckPending: false,
        };
        return { products: current.map((item) => item.id === productId ? next : item), tombstones, result: next };
      });
      return Response.json({ product: updated });
    }
    if (action === "add") {
      const input = typeof body.input === "string" ? body.input.trim() : "";
      const manualPrice = Number(body.manualPrice);
      if (!input || input.length > 2048) return error("Передайте ссылку на товар или артикул WB/Ozon");
      let resolved: Resolved;
      try {
        resolved = await delegatedPost(request, "/api/products/resolve", { input }, resolveProduct) as Resolved;
      } catch (resolveError) {
        if (!(manualPrice > 0)) throw resolveError;
        const url = new URL(input);
        assertSafePublicProductUrl(url);
        resolved = {
          source: url.hostname.replace(/^www\./, "").split(".")[0]!.toUpperCase(),
          name: inferredNameFromUrl(url) || "Товар",
          url: url.href,
          priceRub: null,
        };
      }
      const price = Number.isFinite(manualPrice) && manualPrice > 0 ? manualPrice : Number(resolved.priceRub);
      if (!Number.isFinite(price) || price <= 0) return error("Цена не определилась. Укажите её вручную: /add ссылка | 4500");
      const finalPrice = isLisSkinsUrl(resolved.url) ? Math.round(price * 100) / 100 : Math.round(price);
      const created = await saveMutation(userId, (current, tombstones) => {
        const existing = current.find((item) => item.url === resolved.url);
        if (existing) throw new Error(`Товар уже отслеживается под ID ${existing.id}`);
        let id = Date.now();
        while (current.some((item) => item.id === id)) id += 1;
        const now = new Date().toISOString();
        const isLis = isLisSkinsUrl(resolved.url);
        const product: Product = {
          id, name: resolved.name, source: resolved.source, url: resolved.url,
          category: isLis ? "CS2" : "Другое",
          price: finalPrice, oldPrice: finalPrice, change: 0,
          period: 3, nextCheck: "первый чек через 2 мин",
          art: isLis ? "CS" : "+", artClass: isLis ? "violet" : "blue",
          favorite: false,
          imageUrl: resolved.imageUrl ?? undefined,
          lastResolvedPrice: resolved.priceRub ?? undefined,
          priceCalibration: manualPrice > 0 && resolved.priceRub && manualPrice !== resolved.priceRub
            ? { sourcePrice: resolved.priceRub, visiblePrice: finalPrice } : undefined,
          priceHistory: [{ price: finalPrice, capturedAt: now }],
          alertMode: "amount", alertCheckPending: false,
          offers: [{
            id: `${id}-${resolved.source}`, store: resolved.source,
            price: finalPrice, url: resolved.url,
            note: resolved.priceRub ? "Цена распознана автоматически" : "Цена указана вручную",
          }],
        };
        return { products: [product, ...current], tombstones, result: product };
      });
      return Response.json({ product: created });
    }
    const product = products.find((item) => item.id === productId);
    if (!product) return error("Карточка не найдена. Посмотрите ID в /list", 404);
    const resolved = await delegatedPost(request, "/api/products/resolve", {
      input: product.url, name: product.name, region: product.storeRegion?.code,
    }, resolveProduct) as Resolved;
    if (!resolved.priceRub || resolved.priceRub <= 0) return error("Магазин не отдал актуальную цену — карточка не изменена", 502);
    const sourcePrice = resolved.priceRub;
    const price = isLisSkinsUrl(product.url) ? sourcePrice : calibratedPrice(product, sourcePrice);
    const checked = await saveMutation(userId, (current, tombstones) => {
      const previous = current.find((item) => item.id === productId);
      if (!previous) throw new Error("Карточка удалена в другой сессии");
      const notice = priceNotification(previous, price);
      const updated = applyObservedPrice(previous, price, new Date().toISOString(), sourcePrice);
      const settings = alertSettings(previous);
      const next = {
        ...updated,
        alertReferencePrice: settings ? (notice ? price : settings.reference) : undefined,
        alertCheckPending: false,
      };
      return {
        products: current.map((item) => item.id === productId ? next : item),
        tombstones,
        result: { product: next, notification: notice },
      };
    });
    return Response.json(checked);
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Не удалось выполнить команду", 400);
  }
}

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { profileStates, telegramUsers } from "@/db/schema";
import { authenticateTelegramRequest } from "@/lib/telegram-auth";

type ProfileStatePayload = {
  products?: unknown;
  collections?: unknown;
  palette?: unknown;
  currency?: unknown;
  revision?: unknown;
  deletedProductIds?: unknown;
};

const MAX_STATE_BYTES = 750_000;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function responseState(stored: typeof profileStates.$inferSelect) {
  return {
    products: parseJson(stored.productsJson, []),
    collections: parseJson(stored.collectionsJson, []),
    palette: parseJson(stored.paletteJson, {}),
    currency: stored.currency,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
  };
}

function validatedState(payload: ProfileStatePayload) {
  if (!Array.isArray(payload.products) || payload.products.length > 250) {
    throw new Error("Список товаров повреждён или слишком большой");
  }
  if (!Array.isArray(payload.collections) || payload.collections.length > 100) {
    throw new Error("Список подборок повреждён или слишком большой");
  }
  if (!payload.palette || typeof payload.palette !== "object" || Array.isArray(payload.palette)) {
    throw new Error("Палитра повреждена");
  }

  const revision = Number(payload.revision);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error("Версия профиля повреждена");
  }
  const deletedProductIds = Array.isArray(payload.deletedProductIds)
    ? payload.deletedProductIds.filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0)
    : [];
  if (deletedProductIds.length > 250 || (payload.deletedProductIds !== undefined && deletedProductIds.length !== (payload.deletedProductIds as unknown[]).length)) {
    throw new Error("Список удалённых товаров повреждён");
  }

  const productsJson = JSON.stringify(payload.products);
  const collectionsJson = JSON.stringify(payload.collections);
  const paletteJson = JSON.stringify(payload.palette);
  const currency = payload.currency;
  if (currency !== "RUB" && currency !== "USD" && currency !== "EUR") {
    throw new Error("Неизвестная валюта");
  }
  if (productsJson.length + collectionsJson.length + paletteJson.length > MAX_STATE_BYTES) {
    throw new Error("Профиль превысил допустимый размер");
  }
  return { productsJson, collectionsJson, paletteJson, currency, revision, deletedProductIds };
}

function productIds(products: unknown) {
  if (!Array.isArray(products)) return new Set<number>();
  return new Set(products.flatMap((product) => {
    if (!product || typeof product !== "object") return [];
    const id = Number((product as { id?: unknown }).id);
    return Number.isSafeInteger(id) && id > 0 ? [id] : [];
  }));
}

async function upsertTelegramUser(user: NonNullable<Awaited<ReturnType<typeof authenticateTelegramRequest>>["user"]>) {
  const db = getDb();
  await db.insert(telegramUsers).values({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    languageCode: user.languageCode,
    photoUrl: user.photoUrl,
    lastAuthAt: user.authDate,
  }).onConflictDoUpdate({
    target: telegramUsers.id,
    set: {
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      languageCode: user.languageCode,
      photoUrl: user.photoUrl,
      lastAuthAt: user.authDate,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    },
  });
}

async function conflictResponse(userId: string, message = "Профиль изменился в другой сессии. Загружена свежая версия.") {
  const db = getDb();
  const [current] = await db.select().from(profileStates).where(eq(profileStates.userId, userId)).limit(1);
  return Response.json({
    error: message,
    conflict: true,
    state: current ? responseState(current) : null,
  }, { status: 409, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.user) return auth.response;

  try {
    await upsertTelegramUser(auth.user);
    const db = getDb();
    const [stored] = await db.select().from(profileStates).where(eq(profileStates.userId, auth.user.id)).limit(1);
    return Response.json({
      profile: auth.user,
      state: stored ? responseState(stored) : null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить профиль" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.user) return auth.response;

  try {
    const payload = await request.json() as ProfileStatePayload;
    const state = validatedState(payload);
    await upsertTelegramUser(auth.user);
    const db = getDb();
    const [stored] = await db.select().from(profileStates).where(eq(profileStates.userId, auth.user.id)).limit(1);

    if (!stored) {
      if (state.revision !== 0) return conflictResponse(auth.user.id);
      try {
        const [created] = await db.insert(profileStates).values({
          userId: auth.user.id,
          productsJson: state.productsJson,
          collectionsJson: state.collectionsJson,
          paletteJson: state.paletteJson,
          currency: state.currency,
          revision: 1,
        }).returning({
          revision: profileStates.revision,
          updatedAt: profileStates.updatedAt,
        });
        return Response.json({ saved: true, ...created }, { headers: { "cache-control": "no-store" } });
      } catch {
        return conflictResponse(auth.user.id);
      }
    }

    if (stored.revision !== state.revision) return conflictResponse(auth.user.id);

    const storedProductIds = productIds(parseJson(stored.productsJson, []));
    const nextProductIds = productIds(payload.products);
    const allowedDeletions = new Set(state.deletedProductIds);
    const unexpectedlyMissing = [...storedProductIds].filter((id) => !nextProductIds.has(id) && !allowedDeletions.has(id));
    if (unexpectedlyMissing.length) {
      return conflictResponse(auth.user.id, "Сервер защитил сохранённые карточки от случайного сброса. Загружена последняя облачная версия.");
    }

    const [saved] = await db.update(profileStates).set({
      productsJson: state.productsJson,
      collectionsJson: state.collectionsJson,
      paletteJson: state.paletteJson,
      currency: state.currency,
      revision: sql`${profileStates.revision} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(profileStates.userId, auth.user.id),
      eq(profileStates.revision, state.revision),
    )).returning({
      revision: profileStates.revision,
      updatedAt: profileStates.updatedAt,
    });

    if (!saved) return conflictResponse(auth.user.id);
    return Response.json({ saved: true, ...saved }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить профиль";
    return Response.json({ error: message }, { status: /поврежд|размер|валют|Версия/.test(message) ? 400 : 500 });
  }
}

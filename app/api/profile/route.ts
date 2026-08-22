import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { profileStates, telegramUsers } from "@/db/schema";
import { authenticateTelegramRequest } from "@/lib/telegram-auth";

type ProfileStatePayload = {
  products?: unknown;
  collections?: unknown;
  palette?: unknown;
};

const MAX_STATE_BYTES = 750_000;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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

  const productsJson = JSON.stringify(payload.products);
  const collectionsJson = JSON.stringify(payload.collections);
  const paletteJson = JSON.stringify(payload.palette);
  if (productsJson.length + collectionsJson.length + paletteJson.length > MAX_STATE_BYTES) {
    throw new Error("Профиль превысил допустимый размер");
  }
  return { productsJson, collectionsJson, paletteJson };
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

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.user) return auth.response;

  try {
    await upsertTelegramUser(auth.user);
    const db = getDb();
    const [stored] = await db.select().from(profileStates).where(eq(profileStates.userId, auth.user.id)).limit(1);
    return Response.json({
      profile: auth.user,
      state: stored ? {
        products: parseJson(stored.productsJson, []),
        collections: parseJson(stored.collectionsJson, []),
        palette: parseJson(stored.paletteJson, {}),
        revision: stored.revision,
        updatedAt: stored.updatedAt,
      } : null,
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
    await db.insert(profileStates).values({
      userId: auth.user.id,
      ...state,
    }).onConflictDoUpdate({
      target: profileStates.userId,
      set: {
        ...state,
        revision: sql`${profileStates.revision} + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
    const [saved] = await db.select({
      revision: profileStates.revision,
      updatedAt: profileStates.updatedAt,
    }).from(profileStates).where(eq(profileStates.userId, auth.user.id)).limit(1);
    return Response.json({ saved: true, ...saved }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить профиль";
    return Response.json({ error: message }, { status: /поврежд|размер/.test(message) ? 400 : 500 });
  }
}

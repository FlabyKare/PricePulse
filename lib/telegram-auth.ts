import { env } from "cloudflare:workers";
import { verifyTelegramInitData } from "./telegram-init-data";

type RuntimeEnv = {
  BOT_TOKEN?: string;
  TELEGRAM_BOT_ID?: string;
};

function allowedTelegramIds() {
  return new Set((process.env.ALLOWED_TELEGRAM_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value)));
}

export function privateAccessEnabled() {
  return process.env.PRICEPULSE_ACCESS_MODE?.trim().toLocaleLowerCase("en") !== "public";
}

export async function authenticateTelegramRequest(request: Request) {
  const runtime = env as unknown as RuntimeEnv;
  const botToken = runtime.BOT_TOKEN?.trim() || null;
  const botId = runtime.TELEGRAM_BOT_ID?.trim() || botToken?.split(":", 1)[0] || null;
  if (!botToken && !botId) {
    return {
      user: null,
      response: Response.json(
        { error: "Telegram-вход ещё не настроен на сервере", code: "telegram_auth_not_configured" },
        { status: 503 },
      ),
    };
  }

  const initData = request.headers.get("x-telegram-init-data")?.trim() ?? "";
  if (!initData) {
    return {
      user: null,
      response: Response.json(
        { error: "Откройте PricePulse через Telegram-бота", code: "telegram_auth_required" },
        { status: 401 },
      ),
    };
  }

  const user = await verifyTelegramInitData(initData, { botToken, botId });
  if (!user) {
    return {
      user: null,
      response: Response.json(
        { error: "Сессия Telegram устарела. Закройте и снова откройте мини-приложение", code: "telegram_auth_invalid" },
        { status: 401 },
      ),
    };
  }

  if (privateAccessEnabled() && !allowedTelegramIds().has(user.id)) {
    return {
      user: null,
      response: Response.json(
        { error: "PricePulse работает в закрытом персональном режиме", code: "private_access_required" },
        { status: 403 },
      ),
    };
  }

  return { user, response: null };
}

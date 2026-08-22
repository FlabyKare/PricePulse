import { env } from "cloudflare:workers";
import { verifyTelegramInitData } from "./telegram-init-data";

type RuntimeEnv = {
  BOT_TOKEN?: string;
  TELEGRAM_BOT_ID?: string;
};

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

  return { user, response: null };
}

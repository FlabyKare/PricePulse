export const DEFAULT_WEBAPP_URL = "https://pricepulse-app.bokcerkbr.chatgpt.site";

export const START_MESSAGE = [
  "👋 <b>PricePulse готов к работе</b>",
  "",
  "Открывайте приложение, добавляйте товары и следите за изменением цен.",
].join("\n");

export const HELP_MESSAGE = [
  "<b>Команды PricePulse</b>",
  "",
  "/start — запустить бота",
  "/app — открыть приложение",
  "/help — показать помощь",
].join("\n");

export function normalizeWebAppUrl(value = DEFAULT_WEBAPP_URL) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("WEBAPP_URL must use HTTPS");
  }
  return url.toString().replace(/\/$/, "");
}

export function parseCommand(text = "") {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s|$)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function buildAppKeyboard(webAppUrl) {
  return {
    inline_keyboard: [[{ text: "Открыть PricePulse", web_app: { url: webAppUrl } }]],
  };
}

export function buildSendMessage(chatId, webAppUrl, text = START_MESSAGE) {
  return {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: buildAppKeyboard(webAppUrl),
  };
}

export async function handleUpdate({ client, update, webAppUrl }) {
  const message = update?.message;
  if (!message?.chat?.id || typeof message.text !== "string") return false;

  const command = parseCommand(message.text);
  const text = command === "help" ? HELP_MESSAGE : START_MESSAGE;

  if (command && !["start", "app", "help"].includes(command)) {
    await client.call(
      "sendMessage",
      buildSendMessage(
        message.chat.id,
        webAppUrl,
        "Не знаю такой команды. Нажмите кнопку ниже, чтобы открыть PricePulse.",
      ),
    );
    return true;
  }

  await client.call("sendMessage", buildSendMessage(message.chat.id, webAppUrl, text));
  return true;
}

export class TelegramClient {
  constructor({ token, fetchImpl = globalThis.fetch, apiRoot = "https://api.telegram.org" }) {
    if (!token) throw new Error("BOT_TOKEN is required");
    if (typeof fetchImpl !== "function") throw new Error("A Fetch API implementation is required");

    this.token = token;
    this.fetchImpl = fetchImpl;
    this.apiRoot = apiRoot.replace(/\/$/, "");
  }

  async call(method, payload = {}, { signal } = {}) {
    const response = await this.fetchImpl(`${this.apiRoot}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Telegram API ${method} returned invalid JSON`);
    }

    if (!response.ok || !data.ok) {
      throw new Error(`Telegram API ${method} failed: ${data.description ?? response.status}`);
    }

    return data.result;
  }
}

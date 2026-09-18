import { randomBytes } from "node:crypto";

export const DEFAULT_WEBAPP_URL = "https://pricepulse-app.bokcerkbr.chatgpt.site";

export const START_MESSAGE = [
  "👋 <b>PricePulse готов к работе</b>",
  "",
  "Добавляйте товары и проверяйте цены прямо здесь, без открытия приложения.",
  "Отправьте /help, чтобы увидеть команды.",
].join("\n");

export const HELP_MESSAGE = [
  "<b>Команды PricePulse</b>",
  "",
  "/add ссылка — добавить товар",
  "/add WB 123456789 — добавить по артикулу",
  "/add ссылка | 4500 — указать цену вручную",
  "/list — мои товары; /list 2 — следующая страница",
  "/find название — найти среди своих товаров",
  "/search запрос — найти варианты в магазинах",
  "/check ID — проверить цену сейчас",
  "/history ID — последние замеры цены",
  "/interval ID 6 — проверять каждые 6 часов",
  "/alert ID 5000 — уведомить при изменении на ±5000 ₽",
  "/alert ID 10% — уведомить при изменении на ±10%",
  "/alert ID 0 — отключить уведомления",
  "/delete ID — удалить карточку",
  "/agree — согласиться на хранение профиля",
  "/app — открыть мини-приложение",
  "",
  "ID товара указан в /list. Поиск в интернете требует отдельного подтверждения.",
  "Условия хранения данных: https://pricepulse-app.bokcerkbr.chatgpt.site/legal",
].join("\n");

const pendingSearches = new Map();
const SEARCH_CONSENT_MS = 5 * 60 * 1000;

export function normalizeWebAppUrl(value = DEFAULT_WEBAPP_URL) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("WEBAPP_URL must use HTTPS");
  return url.toString().replace(/\/$/, "");
}

export function parseCommand(text = "") {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s|$)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function commandArgument(text) {
  return text.trim().replace(/^\/[a-z0-9_]+(?:@[a-z0-9_]+)?\s*/i, "").trim();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (symbol) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[symbol]);
}

function rub(price) {
  const fraction = String(price).includes(".") ? 2 : 0;
  return `${Number(price).toLocaleString("ru-RU", { maximumFractionDigits: fraction })} ₽`;
}

function productLine(product) {
  const threshold = Number(product.alertThreshold) > 0
    ? ` · порог ±${product.alertMode === "percent" ? `${product.alertThreshold}%` : rub(product.alertThreshold)}`
    : " · уведомления выключены";
  return `<b>#${product.id}</b> · ${escapeHtml(product.name)}\n${rub(product.price)} · ${escapeHtml(product.source)}${threshold}`;
}

export function buildAppKeyboard(webAppUrl) {
  return { inline_keyboard: [[{ text: "Открыть PricePulse", web_app: { url: webAppUrl } }]] };
}

export function buildSendMessage(chatId, webAppUrl, text = START_MESSAGE, replyMarkup) {
  return {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: replyMarkup ?? buildAppKeyboard(webAppUrl),
  };
}

export async function runBotAction({ token, webAppUrl, userId, action, payload = {}, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${normalizeWebAppUrl(webAppUrl)}/api/bot/action`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ userId: String(userId), action, ...payload }),
    signal: AbortSignal.timeout(60_000),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`PricePulse вернул некорректный ответ (${response.status})`); }
  if (!response.ok) throw new Error(result?.error || `PricePulse недоступен (${response.status})`);
  return result;
}

async function sendSearchResults({ client, chatId, webAppUrl, query, runAction }) {
  const result = await runAction("search", { query });
  const products = Array.isArray(result.products) ? result.products.slice(0, 5) : [];
  if (!products.length) {
    await client.call("sendMessage", buildSendMessage(chatId, webAppUrl, "Подтверждённых товаров не найдено. Попробуйте уточнить модель или бюджет."));
    return;
  }
  await client.call("sendMessage", buildSendMessage(chatId, webAppUrl,
    `<b>Найдено по запросу «${escapeHtml(query)}»</b>\nПроверенные карточки с прямыми ссылками. Цена и рейтинг могут измениться у продавца.`));
  for (const [index, product] of products.entries()) {
    const rating = product.ratingLabel ? ` · ${escapeHtml(product.ratingLabel)}` : "";
    const reviews = Number(product.reviewCount) > 0 ? ` · ${product.reviewCount} отзывов` : "";
    const source = product.sources?.find((item) => item.kind === "магазин" && item.verified && /^https:\/\//.test(item.url));
    const keyboard = source ? {
      inline_keyboard: [[{ text: "Открыть товар в магазине", url: source.url }]],
    } : buildAppKeyboard(webAppUrl);
    await client.call("sendMessage", buildSendMessage(chatId, webAppUrl,
      `${index + 1}. <b>${escapeHtml(product.name)}</b>\n${escapeHtml(product.priceLabel || "Цена уточняется")}${rating}${reviews}`,
      keyboard));
  }
}

export async function handleUpdate({ client, update, webAppUrl, runAction }) {
  const callback = update?.callback_query;
  if (callback) {
    const key = typeof callback.data === "string" ? callback.data.match(/^search:([a-f0-9]{24})$/)?.[1] : null;
    const pending = key ? pendingSearches.get(key) : null;
    if (!pending || pending.expiresAt < Date.now() || String(callback.from?.id) !== pending.userId
      || callback.message?.chat?.type !== "private" || String(callback.message.chat.id) !== pending.userId) {
      await client.call("answerCallbackQuery", { callback_query_id: callback.id, text: "Подтверждение устарело. Повторите /search.", show_alert: true });
      return true;
    }
    pendingSearches.delete(key);
    await client.call("answerCallbackQuery", { callback_query_id: callback.id, text: "Ищем товары…" });
    try {
      await sendSearchResults({ client, chatId: callback.message.chat.id, webAppUrl, query: pending.query, runAction });
    } catch (error) {
      await client.call("sendMessage", buildSendMessage(callback.message.chat.id, webAppUrl, escapeHtml(error.message)));
    }
    return true;
  }

  const message = update?.message;
  if (!message?.chat?.id || typeof message.text !== "string") return false;
  const command = parseCommand(message.text);
  const chatId = message.chat.id;
  const send = (text, replyMarkup) => client.call("sendMessage", buildSendMessage(chatId, webAppUrl, text, replyMarkup));
  if (command === "start" || command === "app") {
    await send(START_MESSAGE);
    return true;
  }
  if (command === "help") {
    await send(HELP_MESSAGE);
    return true;
  }
  if (!command) {
    await send("Добавьте товар командой /add ссылка или посмотрите команды в /help.");
    return true;
  }
  if (message.chat.type !== "private" || !message.from?.id || String(message.from.id) !== String(chatId)) {
    await send("Управлять личными товарами можно только в личном чате с ботом.");
    return true;
  }
  const argument = commandArgument(message.text);
  const userId = String(message.from.id);
  try {
    if (command === "agree") {
      await runAction("consent", {});
      await send("Профиль подключён по вашему Telegram ID. Карточки будут общими с мини-приложением. Удалить все данные можно в профиле приложения.");
    } else if (command === "list" || command === "my") {
      const page = argument ? Number(argument) : 1;
      if (!Number.isInteger(page) || page < 1 || page > 25) return await send("Укажите страницу от 1 до 25: /list 2"), true;
      const result = await runAction("list", { page });
      const products = Array.isArray(result.products) ? result.products : [];
      await send(products.length
        ? `<b>Мои товары · страница ${page}</b>\n\n${products.map(productLine).join("\n\n")}\n\nВсего: ${result.total ?? products.length}`
        : page === 1 ? "Пока нет товаров. Добавьте первый: /add ссылка" : "На этой странице товаров нет.");
    } else if (command === "find") {
      if (argument.length < 2) return await send("Напишите название: /find монитор"), true;
      const result = await runAction("find", { query: argument });
      const products = Array.isArray(result.products) ? result.products.slice(0, 10) : [];
      await send(products.length ? `<b>Мои товары по запросу «${escapeHtml(argument)}»</b>\n\n${products.map(productLine).join("\n\n")}`
        : "В ваших карточках ничего не найдено. Для поиска в магазинах используйте /search запрос.");
    } else if (command === "search") {
      if (argument.length < 2 || argument.length > 120) return await send("Напишите запрос от 2 до 120 символов: /search монитор 27 дюймов"), true;
      for (const [id, pending] of pendingSearches) {
        if (pending.expiresAt < Date.now()) pendingSearches.delete(id);
      }
      if (pendingSearches.size >= 100) pendingSearches.delete(pendingSearches.keys().next().value);
      const key = randomBytes(12).toString("hex");
      pendingSearches.set(key, { userId, query: argument, expiresAt: Date.now() + SEARCH_CONSENT_MS });
      await send(`Передать текст «${escapeHtml(argument)}» внешним поисковым сервисам для подбора товаров? Telegram ID и профиль не передаются. Подтверждение действует 5 минут.`, {
        inline_keyboard: [[{ text: "Да, искать", callback_data: `search:${key}` }]],
      });
    } else if (command === "add") {
      const [input, priceText, extra] = argument.split("|").map((part) => part.trim());
      if (!input || extra !== undefined) return await send("Используйте /add ссылка или /add ссылка | 4500. Артикул: /add WB 123456789"), true;
      const manualPrice = priceText ? Number(priceText.replace(/\s/g, "").replace(",", ".")) : undefined;
      if (priceText && (!Number.isFinite(manualPrice) || manualPrice <= 0)) return await send("Цена должна быть числом больше нуля: /add ссылка | 4500"), true;
      const result = await runAction("add", { input, manualPrice });
      await send(`✅ <b>Товар добавлен</b>\n${productLine(result.product)}\n\nПроверка каждые 3 часа. Уведомления включаются отдельно: /alert ${result.product.id} 5000 или /alert ${result.product.id} 10%`);
    } else if (command === "delete") {
      const productId = Number(argument);
      if (!Number.isSafeInteger(productId) || productId <= 0) return await send("Укажите ID из /list: /delete 123456789"), true;
      const result = await runAction("delete", { productId });
      await send(`🗑 Карточка «${escapeHtml(result.deleted.name)}» удалена из чата и приложения.`);
    } else if (command === "alert") {
      const match = argument.match(/^(\d+)\s+([\d\s,.]+)(%)?$/);
      if (!match) return await send("Пример: /alert ID 5000 или /alert ID 10%"), true;
      const productId = Number(match[1]);
      const threshold = Number(match[2].replace(/\s/g, "").replace(",", "."));
      const mode = match[3] ? "percent" : "amount";
      const result = await runAction("alert", { productId, threshold, mode });
      await send(threshold === 0
        ? `Уведомления для «${escapeHtml(result.product.name)}» выключены. Проверка цены продолжится.`
        : `🔔 Порог для «${escapeHtml(result.product.name)}»: ±${mode === "percent" ? `${threshold}%` : rub(threshold)} от текущей цены. Следующая проверка — по расписанию.`);
    } else if (command === "interval") {
      const match = argument.match(/^(\d+)\s+(\d+)$/);
      if (!match) return await send("Пример: /interval ID 6 — проверять каждые 6 часов"), true;
      const result = await runAction("interval", { productId: Number(match[1]), hours: Number(match[2]) });
      await send(`Период проверки «${escapeHtml(result.product.name)}»: каждые ${result.product.period} ч.`);
    } else if (command === "history") {
      const productId = Number(argument);
      if (!Number.isSafeInteger(productId) || productId <= 0) return await send("Укажите ID из /list: /history 123456789"), true;
      const result = await runAction("history", { productId });
      const history = Array.isArray(result.history) ? result.history : [];
      await send(history.length
        ? `<b>${escapeHtml(result.product.name)}</b> · последние замеры\n\n${history.map((point) => {
          const time = new Date(point.capturedAt);
          const label = Number.isNaN(time.getTime()) ? "Замер" : time.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
          return `${escapeHtml(label)} — <b>${rub(point.price)}</b>`;
        }).join("\n")}`
        : "История этого товара пока пуста.");
    } else if (command === "check" || command === "price") {
      const productId = Number(argument);
      if (!Number.isSafeInteger(productId) || productId <= 0) return await send("Укажите ID из /list: /check 123456789"), true;
      const result = await runAction("check", { productId });
      const notice = result.notification ? "\n🔔 Заданный порог достигнут." : "";
      await send(`<b>${escapeHtml(result.product.name)}</b>\nАктуальная цена: <b>${rub(result.product.price)}</b>${notice}\n\nПроверяйте итоговую цену у продавца.`);
    } else {
      await send("Не знаю такой команды. Отправьте /help, чтобы увидеть доступные действия.");
    }
  } catch (error) {
    await send(`Не получилось выполнить команду: ${escapeHtml(error.message)}`);
  }
  return true;
}

export async function runPriceMonitor({ token, webAppUrl, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${normalizeWebAppUrl(webAppUrl)}/api/notifications/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`Price monitor returned invalid JSON (${response.status})`); }
  if (!response.ok || !result?.ok) throw new Error(result?.error || `Price monitor failed: ${response.status}`);
  return result;
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
    try { data = await response.json(); }
    catch { throw new Error(`Telegram API ${method} returned invalid JSON`); }
    if (!response.ok || !data.ok) throw new Error(`Telegram API ${method} failed: ${data.description ?? response.status}`);
    return data.result;
  }
}

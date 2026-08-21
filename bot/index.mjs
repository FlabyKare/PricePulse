import {
  DEFAULT_WEBAPP_URL,
  TelegramClient,
  handleUpdate,
  normalizeWebAppUrl,
} from "./telegram.mjs";

const token = process.env.BOT_TOKEN?.trim();
const webAppUrl = normalizeWebAppUrl(process.env.WEBAPP_URL?.trim() || DEFAULT_WEBAPP_URL);
const pollingTimeout = Math.min(Math.max(Number(process.env.BOT_POLLING_TIMEOUT) || 30, 5), 50);

if (!token) {
  console.error("[bot] BOT_TOKEN is missing. Add it to Railway Variables.");
  process.exit(1);
}

const client = new TelegramClient({ token });
let stopping = false;
let activeRequest;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[bot] ${signal} received, stopping polling`);
  activeRequest?.abort();
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function run() {
  const bot = await client.call("getMe");

  await client.call("deleteWebhook", { drop_pending_updates: false });
  await client.call("setMyCommands", {
    commands: [
      { command: "start", description: "Запустить PricePulse" },
      { command: "app", description: "Открыть приложение" },
      { command: "help", description: "Помощь" },
    ],
  });

  console.log(`[bot] @${bot.username} connected; Mini App: ${webAppUrl}`);

  let offset = 0;
  let retryDelay = 1_000;

  while (!stopping) {
    activeRequest = new AbortController();

    try {
      const updates = await client.call(
        "getUpdates",
        {
          offset,
          timeout: pollingTimeout,
          allowed_updates: ["message"],
        },
        { signal: activeRequest.signal },
      );

      retryDelay = 1_000;

      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try {
          await handleUpdate({ client, update, webAppUrl });
        } catch (error) {
          console.error(`[bot] update ${update.update_id} failed: ${error.message}`);
        }
      }
    } catch (error) {
      if (stopping && error.name === "AbortError") break;

      console.error(`[bot] polling failed: ${error.message}; retrying in ${retryDelay} ms`);
      await delay(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    } finally {
      activeRequest = undefined;
    }
  }

  console.log("[bot] polling stopped");
}

run().catch((error) => {
  console.error(`[bot] fatal error: ${error.message}`);
  process.exitCode = 1;
});

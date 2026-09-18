type BotRuntime = { BOT_TOKEN?: string; TELEGRAM_BOT_ID?: string };

export async function verifiedBotToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!presented) return null;
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as BotRuntime;
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

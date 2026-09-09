export function privateAccessEnabled() {
  return process.env.PRICEPULSE_ACCESS_MODE?.trim().toLocaleLowerCase("en") !== "public";
}

export async function requirePrivateTelegramAccess(request: Request) {
  const hostname = new URL(request.url).hostname.toLocaleLowerCase("en");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return null;
  if (!privateAccessEnabled()) return null;
  const { authenticateTelegramRequest } = await import("./telegram-auth");
  const auth = await authenticateTelegramRequest(request);
  return auth.user ? null : auth.response;
}
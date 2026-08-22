export type TelegramProfile = {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  photoUrl: string | null;
  authDate: number;
};

type VerificationOptions = {
  botToken?: string | null;
  botId?: string | null;
  now?: number;
  maxAgeSeconds?: number;
};

const encoder = new TextEncoder();
const TELEGRAM_PUBLIC_KEY = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";

function hexBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function base64UrlBytes(value: string) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function dataCheckString(params: URLSearchParams, excluded: string[]) {
  return [...params.entries()]
    .filter(([key]) => !excluded.includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

async function verifyWithBotToken(params: URLSearchParams, botToken: string) {
  const hash = params.get("hash");
  const expected = hash ? hexBytes(hash) : null;
  if (!expected) return false;

  const webAppKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", webAppKey, encoder.encode(botToken));
  const validationKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    validationKey,
    expected,
    encoder.encode(dataCheckString(params, ["hash"])),
  );
}

async function verifyWithTelegramSignature(params: URLSearchParams, botId: string) {
  if (!/^\d+$/.test(botId)) return false;
  const signature = base64UrlBytes(params.get("signature") ?? "");
  const publicKey = hexBytes(TELEGRAM_PUBLIC_KEY);
  if (!signature || !publicKey) return false;

  const key = await crypto.subtle.importKey("raw", publicKey, "Ed25519", false, ["verify"]);
  const body = `${botId}:WebAppData\n${dataCheckString(params, ["hash", "signature"])}`;
  return crypto.subtle.verify("Ed25519", key, signature, encoder.encode(body));
}

export async function verifyTelegramInitData(
  rawInitData: string,
  options: VerificationOptions,
): Promise<TelegramProfile | null> {
  if (!rawInitData || rawInitData.length > 16_000) return null;
  const params = new URLSearchParams(rawInitData);
  const authDate = Number(params.get("auth_date"));
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 86_400;
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > now + 60 || now - authDate > maxAgeSeconds) {
    return null;
  }

  let verified = false;
  if (options.botToken) verified = await verifyWithBotToken(params, options.botToken);
  if (!verified && options.botId) verified = await verifyWithTelegramSignature(params, options.botId);
  if (!verified) return null;

  let unsafeUser: unknown;
  try {
    unsafeUser = JSON.parse(params.get("user") ?? "null");
  } catch {
    return null;
  }
  if (!unsafeUser || typeof unsafeUser !== "object") return null;
  const user = unsafeUser as Record<string, unknown>;
  if ((typeof user.id !== "number" && typeof user.id !== "string") || !String(user.id).trim()) return null;
  const firstName = typeof user.first_name === "string" ? user.first_name.trim() : "";
  if (!firstName) return null;

  return {
    id: String(user.id),
    firstName,
    lastName: typeof user.last_name === "string" && user.last_name.trim() ? user.last_name.trim() : null,
    username: typeof user.username === "string" && user.username.trim() ? user.username.trim() : null,
    languageCode: typeof user.language_code === "string" && user.language_code.trim() ? user.language_code.trim() : null,
    photoUrl: typeof user.photo_url === "string" && /^https:\/\//.test(user.photo_url) ? user.photo_url : null,
    authDate,
  };
}

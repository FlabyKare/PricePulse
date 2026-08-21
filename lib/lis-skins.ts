export type LisSkinsExportItem = {
  name: string;
  price: number;
  unlocked_price?: number;
  url: string;
  count: number;
};

const LIS_HOSTS = new Set(["lis-skins.com", "www.lis-skins.com", "app.lis-skins.com"]);

export function isLisSkinsUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && LIS_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function getLisSkinsSlug(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !LIS_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Поддерживаются только ссылки lis-skins.com");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const marketIndex = parts.findIndex((part) => part.toLowerCase() === "market");
  if (marketIndex < 0 || parts[marketIndex + 1]?.toLowerCase() !== "csgo" || !parts[marketIndex + 2]) {
    throw new Error("Нужна ссылка на товар CS2 из раздела market");
  }

  return decodeURIComponent(parts[marketIndex + 2]).toLowerCase();
}

export function findLisSkinsItem(items: LisSkinsExportItem[], rawUrl: string) {
  const requestedSlug = getLisSkinsSlug(rawUrl);
  return items.find((item) => {
    try {
      return getLisSkinsSlug(item.url) === requestedSlug;
    } catch {
      return false;
    }
  });
}

export function parseCbrUsdRate(xml: string) {
  const usdBlock = (xml.match(/<Valute\b[^>]*>[\s\S]*?<\/Valute>/gi) ?? [])
    .find((block) => /<CharCode>USD<\/CharCode>/i.test(block));
  const value = usdBlock?.match(/<VunitRate>([^<]+)<\/VunitRate>/i)?.[1]
    ?? usdBlock?.match(/<Value>([^<]+)<\/Value>/i)?.[1];
  const rate = Number(value?.replace(",", "."));
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function rubPriceFromUsd(priceUsd: number, exchangeRate: number) {
  return Math.round(priceUsd * exchangeRate * 100) / 100;
}

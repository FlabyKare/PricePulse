const CBR_RATES_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type RatePayload = {
  base: "RUB";
  rates: { RUB: 1; USD: number; EUR: number };
  updatedAt: string;
};

let rateCache: { payload: RatePayload; expiresAt: number } | null = null;

function parseRate(xml: string, code: "USD" | "EUR") {
  const block = (xml.match(/<Valute\b[^>]*>[\s\S]*?<\/Valute>/gi) ?? [])
    .find((item) => new RegExp(`<CharCode>${code}<\\/CharCode>`, "i").test(item));
  const rawValue = block?.match(/<VunitRate>([^<]+)<\/VunitRate>/i)?.[1]
    ?? block?.match(/<Value>([^<]+)<\/Value>/i)?.[1];
  const nominal = Number(block?.match(/<Nominal>([^<]+)<\/Nominal>/i)?.[1]?.replace(",", ".") ?? "1");
  const value = Number(rawValue?.replace(",", "."));
  const rate = value / nominal;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export async function GET() {
  if (rateCache && rateCache.expiresAt > Date.now()) {
    return Response.json(rateCache.payload, { headers: { "cache-control": "public, max-age=3600" } });
  }

  try {
    const response = await fetch(CBR_RATES_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`ЦБ РФ вернул ошибку ${response.status}`);
    const xml = await response.text();
    const usd = parseRate(xml, "USD");
    const eur = parseRate(xml, "EUR");
    if (!usd || !eur) throw new Error("Не удалось прочитать курсы USD и EUR");

    const payload: RatePayload = {
      base: "RUB",
      rates: { RUB: 1, USD: usd, EUR: eur },
      updatedAt: new Date().toISOString(),
    };
    rateCache = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
    return Response.json(payload, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Курсы валют временно недоступны" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

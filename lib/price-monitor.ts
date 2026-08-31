export type MonitoredPricePoint = { price: number; capturedAt: string };

export type MonitoredProduct = {
  id: number;
  name: string;
  url: string;
  source?: string;
  price: number;
  oldPrice?: number;
  change?: number;
  period: number;
  nextCheck?: string;
  target?: number;
  priceHistory?: MonitoredPricePoint[];
  offers?: Array<{ id: string; store: string; price: number; url: string; note: string }>;
};

const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
const MIN_PRICE_CHANGE_PERCENT = 0.1;

export function isPriceCheckDue(product: MonitoredProduct, now = Date.now()) {
  const history = Array.isArray(product.priceHistory) ? product.priceHistory : [];
  const lastCapturedAt = history.at(-1)?.capturedAt;
  const lastChecked = lastCapturedAt ? Date.parse(lastCapturedAt) : 0;
  if (!Number.isFinite(lastChecked) || lastChecked <= 0) return true;
  const interval = history.length <= 1
    ? FIRST_CHECK_DELAY_MS
    : Math.max(1, Number(product.period) || 1) * 60 * 60 * 1000;
  return now - lastChecked >= interval;
}

export function applyObservedPrice(product: MonitoredProduct, price: number, capturedAt: string) {
  const previous = Number(product.price) > 0 ? Number(product.price) : price;
  const change = previous > 0 ? Math.round(((price - previous) / previous) * 1000) / 10 : 0;
  const history = [...(product.priceHistory ?? []), { price, capturedAt }].slice(-30);
  const source = product.source || "Магазин";
  const refreshedOffer = {
    id: product.offers?.find((offer) => offer.store === source)?.id ?? `${product.id}-${source}`,
    store: source,
    price,
    url: product.url,
    note: "Цена проверена автоматически",
  };
  return {
    ...product,
    oldPrice: previous,
    price,
    change,
    nextCheck: `через ${Math.max(1, Number(product.period) || 1)} ч`,
    priceHistory: history,
    offers: [refreshedOffer, ...(product.offers ?? []).filter((offer) => offer.store !== source)],
  };
}

export function priceNotification(product: MonitoredProduct, nextPrice: number) {
  const previous = Number(product.price);
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(nextPrice) || nextPrice <= 0) return null;
  const rawPercent = ((nextPrice - previous) / previous) * 100;
  const roundedPercent = Math.round(rawPercent * 10) / 10;
  const percent = Object.is(roundedPercent, -0) ? 0 : roundedPercent;
  const priceChanged = Math.round(nextPrice) !== Math.round(previous)
    && Math.abs(rawPercent) >= MIN_PRICE_CHANGE_PERCENT;
  const firstObservation = (product.priceHistory?.length ?? 0) <= 1;
  const targetReached = Number(product.target) > 0
    && nextPrice <= Number(product.target)
    && (previous > Number(product.target) || firstObservation);
  if (!priceChanged && !targetReached) return null;
  return {
    previous,
    next: nextPrice,
    percent,
    priceChanged,
    targetReached,
  };
}

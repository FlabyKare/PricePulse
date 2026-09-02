export type MonitoredPricePoint = { price: number; capturedAt: string };
export type AlertMode = "amount" | "percent";

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
  targetAlerted?: boolean;
  targetCheckPending?: boolean;
  alertMode?: AlertMode;
  alertThreshold?: number;
  alertReferencePrice?: number;
  alertCheckPending?: boolean;
  priceHistory?: MonitoredPricePoint[];
  offers?: Array<{ id: string; store: string; price: number; url: string; note: string }>;
};

const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
export function isPriceCheckDue(product: MonitoredProduct, now = Date.now()) {
  if (product.alertCheckPending === true || product.targetCheckPending === true) return true;
  const history = Array.isArray(product.priceHistory) ? product.priceHistory : [];
  const lastCapturedAt = history.at(-1)?.capturedAt;
  const lastChecked = lastCapturedAt ? Date.parse(lastCapturedAt) : 0;
  if (!Number.isFinite(lastChecked) || lastChecked <= 0) return true;
  const interval = history.length <= 1
    ? FIRST_CHECK_DELAY_MS
    : Math.max(1, Number(product.period) || 1) * 60 * 60 * 1000;
  return now - lastChecked >= interval;
}

export function alertSettings(product: MonitoredProduct) {
  const legacyThreshold = Number(product.target);
  const configuredThreshold = Number(product.alertThreshold);
  const threshold = Number.isFinite(configuredThreshold) && configuredThreshold > 0
    ? configuredThreshold
    : Number.isFinite(legacyThreshold) && legacyThreshold > 0 ? legacyThreshold : 0;
  if (!threshold) return null;
  const mode: AlertMode = product.alertMode === "percent" ? "percent" : "amount";
  const configuredReference = Number(product.alertReferencePrice);
  const currentPrice = Number(product.price);
  const reference = Number.isFinite(configuredReference) && configuredReference > 0 ? configuredReference : currentPrice;
  if (!Number.isFinite(reference) || reference <= 0) return null;
  return { mode, threshold, reference };
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
  const settings = alertSettings(product);
  if (!settings || !Number.isFinite(nextPrice) || nextPrice <= 0) return null;
  const deltaAmount = nextPrice - settings.reference;
  const rawPercent = (deltaAmount / settings.reference) * 100;
  const roundedPercent = Math.round(rawPercent * 10) / 10;
  const percent = Object.is(roundedPercent, -0) ? 0 : roundedPercent;
  const thresholdReached = settings.mode === "percent"
    ? Math.abs(rawPercent) >= settings.threshold
    : Math.abs(deltaAmount) >= settings.threshold;
  if (!thresholdReached) return null;
  return {
    previous: settings.reference,
    next: nextPrice,
    percent,
    deltaAmount,
    alertMode: settings.mode,
    alertThreshold: settings.threshold,
    thresholdReached: true,
  };
}
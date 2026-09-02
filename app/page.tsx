"use client";

import type { CSSProperties } from "react";
import { createContext, FormEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isLisSkinsUrl } from "@/lib/lis-skins";
import { mergeProfileRecords } from "@/lib/profile-state";
import { InvestmentsView, SmartDiscoveryView } from "./ai-views";

type Offer = {
  id: string;
  store: string;
  price: number;
  url: string;
  note: string;
};

type PricePoint = {
  price: number;
  capturedAt: string;
};

type Product = {
  id: number;
  name: string;
  source: string;
  url: string;
  category: string;
  price: number;
  oldPrice: number;
  change: number;
  period: number;
  nextCheck: string;
  art: string;
  artClass: string;
  favorite: boolean;
  imageUrl?: string;
  priceHistory?: PricePoint[];
  target?: number;
  targetAlerted?: boolean;
  targetCheckPending?: boolean;
  alertMode?: "amount" | "percent";
  alertThreshold?: number;
  alertReferencePrice?: number;
  alertCheckPending?: boolean;
  offers?: Offer[];
};

type ResolvedLisProduct = {
  source: "LIS-SKINS";
  name: string;
  url: string;
  priceUsd: number;
  priceRub: number;
  exchangeRate: number;
  count: number;
  approximate: boolean;
  imageUrl?: string | null;
};

type ResolvedStoreProduct = {
  source: string;
  name: string;
  url: string;
  priceRub: number | null;
  count: number;
  approximate: boolean;
  needsManualPrice: boolean;
  imageUrl?: string | null;
  resolvedBy: "page-content" | "url-fallback" | "safe-fallback" | "official-catalogue";
};

type Collection = {
  id: string;
  name: string;
  productIds: number[];
};

type Palette = {
  id: string;
  name: string;
  paper: string;
  ink: string;
  surface?: string;
  card: string;
  accent: string;
  accent2: string;
  accent3: string;
};

type CurrencyCode = "RUB" | "USD" | "EUR";
type PriceAlertSettings = { mode: "amount" | "percent"; threshold: number };
type CurrencyRates = { RUB: 1; USD: number; EUR: number };

type TelegramProfile = {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  photoUrl: string | null;
};

type ProfileApiResponse = {
  profile?: TelegramProfile;
  state?: {
    products: Product[];
    collections: Collection[];
    palette: Palette;
    currency: CurrencyCode;
    revision: number;
    updatedAt: string;
  } | null;
  saved?: boolean;
  revision?: number;
  conflict?: boolean;
  merged?: boolean;
  error?: string;
};

type ProfileSyncStatus = "local" | "loading" | "saving" | "synced" | "error";

type LegacyLocalState = {
  products: Product[] | null;
  collections: Collection[] | null;
  palette: Palette | null;
  currency: CurrencyCode | null;
  hasData: boolean;
};

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: {
      initData?: string;
      initDataUnsafe?: {
        user?: {
          id: string | number;
          first_name: string;
          last_name?: string;
          username?: string;
          language_code?: string;
          photo_url?: string;
        };
      };
      ready?: () => void;
      expand?: () => void;
      disableVerticalSwipes?: () => void;
      HapticFeedback?: { impactOccurred: (value: string) => void };
    };
  };
};

const initialProducts: Product[] = [
  {
    id: 1,
    name: "AK-47 | Nightwish",
    source: "LIS-SKINS",
    url: "https://lis-skins.com/market/csgo/ak-47-nightwish-field-tested/",
    category: "CS2",
    price: 4763,
    oldPrice: 5027,
    change: -5.2,
    period: 3,
    nextCheck: "через 42 мин",
    art: "AK",
    artClass: "violet",
    favorite: true,
    alertMode: "amount",
    alertThreshold: 500,
    alertReferencePrice: 4763,
    offers: [
      { id: "lis-ak", store: "LIS-SKINS", price: 4763, url: "https://lis-skins.com/market/csgo/ak-47-nightwish-field-tested/", note: "Моментальная выдача" },
      { id: "steam-ak", store: "STEAM", price: 5290, url: "https://steamcommunity.com/market/", note: "Баланс Steam" },
      { id: "market-ak", store: "CS.MARKET", price: 4898, url: "https://cs.market/", note: "Вывод на аккаунт" },
    ],
  },
  {
    id: 2,
    name: "M4A1-S | Player Two",
    source: "LIS-SKINS",
    url: "https://lis-skins.com/market/csgo/m4a1-s-player-two-minimal-wear/",
    category: "CS2",
    price: 8390,
    oldPrice: 8158,
    change: 2.8,
    period: 1,
    nextCheck: "через 18 мин",
    art: "M4",
    artClass: "amber",
    favorite: false,
    alertMode: "amount",
    alertThreshold: 500,
    alertReferencePrice: 8390,
    offers: [
      { id: "lis-m4", store: "LIS-SKINS", price: 8390, url: "https://lis-skins.com/market/csgo/m4a1-s-player-two-minimal-wear/", note: "Моментальная выдача" },
      { id: "steam-m4", store: "STEAM", price: 8970, url: "https://steamcommunity.com/market/", note: "Баланс Steam" },
      { id: "market-m4", store: "CS.MARKET", price: 8140, url: "https://cs.market/", note: "Лучшая цена" },
    ],
  },
  {
    id: 3,
    name: "Nike Air Max 95",
    source: "POIZON",
    url: "https://www.poizon.com/product/nike-air-max-95",
    category: "Кроссовки",
    price: 16890,
    oldPrice: 17490,
    change: -3.4,
    period: 6,
    nextCheck: "через 2 ч 14 мин",
    art: "95",
    artClass: "blue",
    favorite: true,
    alertMode: "percent",
    alertThreshold: 5,
    alertReferencePrice: 16890,
    offers: [
      { id: "poizon-95", store: "POIZON", price: 16890, url: "https://www.poizon.com/product/nike-air-max-95", note: "Проверка подлинности" },
      { id: "lamoda-95", store: "LAMODA", price: 17990, url: "https://www.lamoda.ru/", note: "Быстрая доставка" },
    ],
  },
  {
    id: 4,
    name: "AirPods Pro 2 USB-C",
    source: "OZON",
    url: "https://www.ozon.ru/product/airpods-pro-2-usb-c/",
    category: "Техника",
    price: 19990,
    oldPrice: 19990,
    change: 0,
    period: 12,
    nextCheck: "через 8 ч 02 мин",
    art: "PRO",
    artClass: "mint",
    favorite: false,
    offers: [
      { id: "ozon-pro", store: "OZON", price: 19990, url: "https://www.ozon.ru/product/airpods-pro-2-usb-c/", note: "Доставка завтра" },
      { id: "market-pro", store: "ЯНДЕКС МАРКЕТ", price: 20740, url: "https://market.yandex.ru/", note: "Кешбэк баллами" },
    ],
  },
];

const initialCollections: Collection[] = [
  { id: "cs2-dream", name: "CS2 · хочу купить", productIds: [1, 2] },
  { id: "best-drops", name: "Лучшие снижения", productIds: [1, 3] },
];

const palettes: Palette[] = [
  { id: "pulse", name: "Pulse", paper: "#f4f3ee", ink: "#151713", surface: "#151713", card: "#ffffff", accent: "#dfff54", accent2: "#b997e7", accent3: "#64bfd2" },
  { id: "sunset", name: "Sunset", paper: "#fff4ed", ink: "#281b1b", surface: "#281b1b", card: "#fffdf9", accent: "#ff7a4d", accent2: "#ffd166", accent3: "#8e79d9" },
  { id: "ocean", name: "Ocean", paper: "#eef6f8", ink: "#12272f", surface: "#12272f", card: "#ffffff", accent: "#42d6c3", accent2: "#6ea8fe", accent3: "#a78bfa" },
  { id: "berry", name: "Berry", paper: "#faf0f6", ink: "#2c1726", surface: "#2c1726", card: "#fffafd", accent: "#ff5c9a", accent2: "#b58cff", accent3: "#ffb45c" },
  { id: "ice", name: "Ice", paper: "#f2f7ff", ink: "#10233d", surface: "#10233d", card: "#ffffff", accent: "#79d6ff", accent2: "#7c8cff", accent3: "#b7f171" },
  { id: "sand", name: "Sand", paper: "#f8f1e3", ink: "#292318", surface: "#292318", card: "#fffdf7", accent: "#e7a94b", accent2: "#7fb7a5", accent3: "#d27b78" },
  { id: "forest", name: "Forest", paper: "#07140e", ink: "#e7f5ea", surface: "#10271b", card: "#0c1f16", accent: "#9be564", accent2: "#37b982", accent3: "#d2ad67" },
];

const defaultRates: CurrencyRates = { RUB: 1, USD: 0, EUR: 0 };
const CurrencyContext = createContext<{ currency: CurrencyCode; rates: CurrencyRates }>({
  currency: "RUB",
  rates: defaultRates,
});

function formatPriceValue(value: number, currency: CurrencyCode, rates: CurrencyRates) {
  const rate = rates[currency];
  if (!rate) return "—";
  const converted = currency === "RUB" ? value : value / rate;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
    maximumFractionDigits: currency === "RUB" ? 0 : 2,
  }).format(converted);
}

function usePriceFormatter() {
  const { currency, rates } = useContext(CurrencyContext);
  return (value: number) => formatPriceValue(value, currency, rates);
}

const MIN_FORECAST_POINTS = 3;
const MAX_HISTORY_POINTS = 60;

function normalizePriceHistory(history: PricePoint[] | undefined) {
  return (history ?? [])
    .filter((point) => Number.isFinite(point.price) && point.price > 0 && Number.isFinite(Date.parse(point.capturedAt)))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
    .slice(-MAX_HISTORY_POINTS);
}

function appendPriceObservation(history: PricePoint[] | undefined, price: number, capturedAt = new Date().toISOString()) {
  const normalized = normalizePriceHistory(history);
  if (!Number.isFinite(price) || price <= 0) return normalized;
  const roundedPrice = Math.round(price * 100) / 100;
  const last = normalized.at(-1);
  const capturedTime = Date.parse(capturedAt);
  if (last && last.price === roundedPrice && capturedTime - Date.parse(last.capturedAt) < 30 * 60 * 1000) return normalized;
  return [...normalized, { price: roundedPrice, capturedAt }].slice(-MAX_HISTORY_POINTS);
}

function forecastFor(product: Product) {
  const history = normalizePriceHistory(product.priceHistory);
  const values = history.length ? history.map((point) => point.price) : [product.price];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = maximum - minimum;
  const chart = values.slice(-14).map((value) => spread === 0 ? 46 : 18 + Math.round(((value - minimum) / spread) * 70));
  const first = values[0];
  const current = values.at(-1) ?? product.price;
  const delta = current - first;

  if (history.length < MIN_FORECAST_POINTS) {
    return {
      label: "Копим данные",
      text: `Нужно минимум ${MIN_FORECAST_POINTS} реальных замера цены`,
      tone: "collect",
      confidence: null,
      observedCount: history.length,
      trendPercent: 0,
      volatilityPercent: 0,
      deviationPercent: 0,
      chart,
      delta,
    };
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const volatilityPercent = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0;
  const deviationPercent = mean > 0 ? ((current - mean) / mean) * 100 : 0;
  const xMean = (values.length - 1) / 2;
  const slopeNumerator = values.reduce((sum, value, index) => sum + (index - xMean) * (value - mean), 0);
  const slopeDenominator = values.reduce((sum, _value, index) => sum + (index - xMean) ** 2, 0) || 1;
  const slope = slopeNumerator / slopeDenominator;
  const trendPercent = mean > 0 ? (slope * (values.length - 1) / mean) * 100 : 0;

  let label = "Наблюдать";
  let text = "Отклонение от средней пока недостаточно для действия";
  let tone = "watch";
  if (deviationPercent <= -3 && trendPercent <= 1) {
    label = "Цена привлекательна";
    text = "Цена ниже средней, а ускорение роста не подтверждено";
    tone = "buy";
  } else if (deviationPercent >= 3 && trendPercent > 0.5) {
    label = "Лучше подождать";
    text = "Цена выше средней и растёт — дождитесь стабилизации";
    tone = "wait";
  }

  const coverage = Math.min(1, history.length / 12);
  const signalStrength = Math.min(1, (Math.abs(deviationPercent) + Math.abs(trendPercent)) / 12);
  const consistentMoves = values.slice(1).filter((value, index) => Math.sign(value - values[index]) === Math.sign(trendPercent)).length;
  const consistency = values.length > 1 ? consistentMoves / (values.length - 1) : 0;
  const confidence = Math.round(Math.max(35, Math.min(90,
    40 + coverage * 25 + signalStrength * 20 + consistency * 10 - Math.min(20, volatilityPercent * 1.5),
  )));

  return {
    label,
    text,
    tone,
    confidence,
    observedCount: history.length,
    trendPercent,
    volatilityPercent,
    deviationPercent,
    chart,
    delta,
  };
}

function normalizeProduct(product: Product): Product {
  const normalizedHistory = normalizePriceHistory(product.priceHistory);
  const legacyThreshold = Number(product.target);
  const configuredThreshold = Number(product.alertThreshold);
  const alertThreshold = Number.isFinite(configuredThreshold) && configuredThreshold > 0
    ? configuredThreshold
    : Number.isFinite(legacyThreshold) && legacyThreshold > 0 ? legacyThreshold : undefined;
  const configuredReference = Number(product.alertReferencePrice);
  return {
    ...product,
    imageUrl: typeof product.imageUrl === "string" && /^https:\/\//i.test(product.imageUrl) ? product.imageUrl : undefined,
    priceHistory: normalizedHistory.length ? normalizedHistory : appendPriceObservation(undefined, product.price),
    alertMode: product.alertMode === "percent" ? "percent" : "amount",
    alertThreshold,
    alertReferencePrice: alertThreshold
      ? (Number.isFinite(configuredReference) && configuredReference > 0 ? configuredReference : product.price)
      : undefined,
    alertCheckPending: product.alertCheckPending === true || product.targetCheckPending === true,
    target: undefined,
    targetAlerted: undefined,
    targetCheckPending: undefined,
    offers: product.offers?.length
      ? product.offers
      : [{ id: `${product.id}-${product.source}`, store: product.source, price: product.price, url: product.url, note: "Основной магазин" }],
  };
}

async function resolveLisProduct(url: string) {
  const response = await fetch("/api/products/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const result = await response.json() as ResolvedLisProduct & { error?: string };
  if (!response.ok) throw new Error(result.error || "Не удалось получить цену LIS-SKINS");
  return result;
}

async function resolveStoreProduct(url: string, name = "") {
  const response = await fetch("/api/products/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, name }),
  });
  const result = await response.json() as ResolvedStoreProduct & { error?: string };
  if (!response.ok) throw new Error(result.error || "Не удалось распознать страницу магазина");
  return result;
}

function withResolvedLisPrice(product: Product, resolved: ResolvedLisProduct): Product {
  const placeholder = product.price === 1790 && product.oldPrice === 1790;
  const change = placeholder || product.price <= 0
    ? 0
    : Math.round(((resolved.priceRub - product.price) / product.price) * 1000) / 10;
  const lisOffer: Offer = {
    id: `${product.id}-lis-skins`,
    store: "LIS-SKINS",
    price: resolved.priceRub,
    url: resolved.url,
    note: `Официальный каталог · ${resolved.count} ${resolved.count === 1 ? "предложение" : "предложения"}`,
  };

  return {
    ...product,
    name: resolved.name,
    url: resolved.url,
    price: resolved.priceRub,
    oldPrice: placeholder ? resolved.priceRub : product.price,
    change,
    nextCheck: "проверено только что",
    imageUrl: resolved.imageUrl ?? product.imageUrl,
    priceHistory: appendPriceObservation(product.priceHistory, resolved.priceRub),
    offers: [lisOffer, ...(product.offers ?? []).filter((offer) => offer.store !== "LIS-SKINS")],
  };
}

function withResolvedStorePrice(product: Product, resolved: ResolvedStoreProduct): Product {
  if (!resolved.priceRub || resolved.priceRub <= 0) return product;
  const previousPrice = product.price > 0 ? product.price : resolved.priceRub;
  const change = previousPrice > 0
    ? Math.round(((resolved.priceRub - previousPrice) / previousPrice) * 1000) / 10
    : 0;
  const refreshedOffer: Offer = {
    id: product.offers?.find((offer) => offer.store === resolved.source)?.id ?? `${product.id}-${resolved.source}`,
    store: resolved.source,
    price: resolved.priceRub,
    url: resolved.url,
    note: "Цена проверена по странице магазина",
  };
  return {
    ...product,
    name: resolved.name || product.name,
    source: resolved.source || product.source,
    url: resolved.url,
    oldPrice: previousPrice,
    price: resolved.priceRub,
    change,
    nextCheck: "проверено только что",
    imageUrl: resolved.imageUrl ?? product.imageUrl,
    priceHistory: appendPriceObservation(product.priceHistory, resolved.priceRub),
    offers: [refreshedOffer, ...(product.offers ?? []).filter((offer) => offer.store !== resolved.source)],
  };
}

function offerUrlForProduct(offer: Offer, productName: string) {
  const store = `${offer.store} ${offer.url}`.toLocaleLowerCase("en");
  if (store.includes("steamcommunity") || store.includes("steam")) {
    return `https://steamcommunity.com/market/search?appid=730&q=${encodeURIComponent(productName)}`;
  }
  if (store.includes("market.csgo") || store.includes("cs.market")) {
    return `https://market.csgo.com/en/${encodeURIComponent(productName)}`;
  }
  return offer.url;
}

function haptic(style: "light" | "medium" = "light") {
  const telegram = (window as TelegramWindow).Telegram?.WebApp;
  telegram?.HapticFeedback?.impactOccurred(style);
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [collections, setCollections] = useState<Collection[]>(initialCollections);
  const [palette, setPalette] = useState<Palette>(palettes[0]);
  const [currency, setCurrency] = useState<CurrencyCode>("RUB");
  const [rates, setRates] = useState<CurrencyRates>(defaultRates);
  const [activeCategory, setActiveCategory] = useState("Все");
  const [activeNav, setActiveNav] = useState("Главная");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [toast, setToast] = useState("");
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [profile, setProfile] = useState<TelegramProfile | null>(null);
  const [syncStatus, setSyncStatus] = useState<ProfileSyncStatus>("loading");
  const [syncMessage, setSyncMessage] = useState("Подключаем Telegram-профиль…");
  const automaticRefreshStarted = useRef(false);
  const telegramInitData = useRef("");
  const profileRevision = useRef<number | null>(null);
  const skipNextRemoteSave = useRef(false);
  const pendingProductDeletions = useRef<Set<number>>(new Set());
  const remoteFetchInFlight = useRef(false);
  const legacyLocalState = useRef<LegacyLocalState | null>(null);
  const pendingMigrationKey = useRef<string | null>(null);

  useEffect(() => {
    const telegram = (window as TelegramWindow).Telegram?.WebApp;
    telegram?.ready?.();
    telegram?.expand?.();
    telegram?.disableVerticalSwipes?.();
    const initData = telegram?.initData?.trim() ?? "";
    telegramInitData.current = initData;

    const readStoredJson = <T,>(key: string): T | null => {
      const saved = window.localStorage.getItem(key);
      if (!saved) return null;
      try {
        return JSON.parse(saved) as T;
      } catch {
        window.localStorage.removeItem(key);
        return null;
      }
    };
    const savedProducts = readStoredJson<Product[]>("pricepulse-products");
    const savedCollections = readStoredJson<Collection[]>("pricepulse-collections");
    const savedPalette = readStoredJson<Palette>("pricepulse-palette");
    const savedCurrencyValue = window.localStorage.getItem("pricepulse-currency");
    const savedCurrency = savedCurrencyValue === "RUB" || savedCurrencyValue === "USD" || savedCurrencyValue === "EUR"
      ? savedCurrencyValue
      : null;
    legacyLocalState.current = {
      products: Array.isArray(savedProducts) ? savedProducts.map(normalizeProduct) : null,
      collections: Array.isArray(savedCollections) ? savedCollections : null,
      palette: savedPalette?.accent ? savedPalette : null,
      currency: savedCurrency,
      hasData: Boolean(savedProducts || savedCollections || savedPalette || savedCurrency),
    };

    if (!initData) {
      if (legacyLocalState.current.products) setProducts(legacyLocalState.current.products);
      if (legacyLocalState.current.collections) setCollections(legacyLocalState.current.collections);
      if (legacyLocalState.current.palette) setPalette(legacyLocalState.current.palette);
      if (legacyLocalState.current.currency) setCurrency(legacyLocalState.current.currency);
    }
    const savedProfile = window.localStorage.getItem("pricepulse-telegram-profile");
    if (savedProfile) {
      try {
        setProfile(JSON.parse(savedProfile) as TelegramProfile);
      } catch {
        window.localStorage.removeItem("pricepulse-telegram-profile");
      }
    }
    const sharedCode = window.location.hash.match(/collection=([^&]+)/)?.[1];
    if (sharedCode) {
      try {
        const payload = JSON.parse(decodeURIComponent(window.atob(sharedCode))) as { collection: Collection; products: Product[] };
        setProducts((current) => [...current, ...payload.products.map(normalizeProduct).filter((incoming) => !current.some((item) => item.id === incoming.id))]);
        setCollections((current) => current.some((item) => item.id === payload.collection.id) ? current : [payload.collection, ...current]);
        setSelectedCollection(payload.collection);
        setActiveNav("Главная");
        setToast("Товары из общей ссылки добавлены");
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        setToast("Не удалось открыть общую ссылку");
      }
    }

    const unsafeUser = telegram?.initDataUnsafe?.user;
    if (unsafeUser?.id && unsafeUser.first_name) {
      const telegramProfile: TelegramProfile = {
        id: String(unsafeUser.id),
        firstName: unsafeUser.first_name,
        lastName: unsafeUser.last_name?.trim() || null,
        username: unsafeUser.username?.trim() || null,
        languageCode: unsafeUser.language_code?.trim() || null,
        photoUrl: unsafeUser.photo_url?.trim() || null,
      };
      setProfile(telegramProfile);
      window.localStorage.setItem("pricepulse-telegram-profile", JSON.stringify(telegramProfile));
    }

    setLoaded(true);

    if (!initData) {
      setSyncStatus("local");
      setSyncMessage("");
      setCatalogReady(true);
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/profile", {
          headers: { "x-telegram-init-data": initData },
          cache: "no-store",
        });
        const body = await response.json() as ProfileApiResponse;
        if (!response.ok || !body.profile) throw new Error(body.error || "Не удалось войти через Telegram");
        setProfile((current) => {
          const mergedProfile: TelegramProfile = {
            ...body.profile!,
            username: body.profile!.username ?? current?.username ?? null,
            photoUrl: body.profile!.photoUrl ?? current?.photoUrl ?? null,
          };
          window.localStorage.setItem("pricepulse-telegram-profile", JSON.stringify(mergedProfile));
          return mergedProfile;
        });
        const migrationKey = "pricepulse-cloud-migrated:" + body.profile.id;
        const legacy = window.localStorage.getItem(migrationKey) === "1" ? null : legacyLocalState.current;
        const shouldMigrate = Boolean(legacy?.hasData);
        const cloudProducts = body.state?.products.map(normalizeProduct) ?? [];
        const cloudCollections = body.state?.collections ?? [];
        const nextProducts = shouldMigrate && legacy?.products
          ? mergeProfileRecords(legacy.products, cloudProducts)
          : (body.state ? cloudProducts : initialProducts);
        const nextCollections = shouldMigrate && legacy?.collections
          ? mergeProfileRecords(legacy.collections, cloudCollections)
          : (body.state ? cloudCollections : initialCollections);

        profileRevision.current = body.state?.revision ?? 0;
        skipNextRemoteSave.current = Boolean(body.state) && !shouldMigrate;
        pendingMigrationKey.current = shouldMigrate ? migrationKey : null;
        if (!shouldMigrate) window.localStorage.setItem(migrationKey, "1");
        setProducts(nextProducts);
        setCollections(nextCollections);
        const nextPalette = body.state?.palette?.accent ? body.state.palette : legacy?.palette;
        const nextCurrency = body.state?.currency ?? legacy?.currency;
        if (nextPalette?.accent) setPalette(nextPalette);
        if (nextCurrency === "RUB" || nextCurrency === "USD" || nextCurrency === "EUR") setCurrency(nextCurrency);
        setRemoteReady(true);
        setSyncStatus(shouldMigrate ? "saving" : "synced");
        setSyncMessage(shouldMigrate
          ? "Переносим карточки этого устройства в Telegram-профиль…"
          : "Товары и настройки сохранены в облачном профиле");
      } catch (error) {
        setSyncStatus("error");
        setSyncMessage(error instanceof Error ? error.message : "Не удалось подключить облачную память");
      } finally {
        setCatalogReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (loaded && !telegramInitData.current) window.localStorage.setItem("pricepulse-products", JSON.stringify(products));
  }, [products, loaded]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/rates", { cache: "no-store" });
        const body = await response.json() as { rates?: Partial<CurrencyRates> };
        if (!response.ok || !body.rates?.USD || !body.rates?.EUR) return;
        setRates({ RUB: 1, USD: body.rates.USD, EUR: body.rates.EUR });
      } catch {
        // RUB remains available when the rates provider is temporarily unavailable.
      }
    })();
  }, []);

  useEffect(() => {
    if (!catalogReady || automaticRefreshStarted.current) return;
    automaticRefreshStarted.current = true;
    const lisProducts = products.filter((product) => isLisSkinsUrl(product.url));
    if (!lisProducts.length) return;

    Promise.allSettled(lisProducts.map(async (product) => ({
      id: product.id,
      resolved: await resolveLisProduct(product.url),
    }))).then((results) => {
      const updates = new Map<number, ResolvedLisProduct>();
      results.forEach((result) => {
        if (result.status === "fulfilled") updates.set(result.value.id, result.value.resolved);
      });
      if (!updates.size) return;
      setProducts((current) => current.map((product) => {
        const resolved = updates.get(product.id);
        return resolved ? withResolvedLisPrice(product, resolved) : product;
      }));
    });
  }, [catalogReady, products]);

  useEffect(() => {
    if (!loaded || telegramInitData.current) return;
    window.localStorage.setItem("pricepulse-collections", JSON.stringify(collections));
    window.localStorage.setItem("pricepulse-palette", JSON.stringify(palette));
    window.localStorage.setItem("pricepulse-currency", currency);
  }, [collections, palette, currency, loaded]);

  useEffect(() => {
    if (!loaded || !remoteReady || !telegramInitData.current || profileRevision.current === null) return;
    if (skipNextRemoteSave.current) {
      skipNextRemoteSave.current = false;
      return;
    }
    setSyncStatus("saving");
    setSyncMessage(profileRevision.current === 0 ? "Переносим карточки в облачную память…" : "Сохраняем изменения…");
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const deletedProductIds = [...pendingProductDeletions.current];
          const response = await fetch("/api/profile", {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "x-telegram-init-data": telegramInitData.current,
            },
            body: JSON.stringify({ products, collections, palette, currency, revision: profileRevision.current, deletedProductIds }),
            keepalive: true,
          });
          const body = await response.json() as ProfileApiResponse;
          if (response.status === 409 && body.state) {
            profileRevision.current = body.state.revision;
            setProducts(mergeProfileRecords(
              body.state.products.map(normalizeProduct),
              products,
              deletedProductIds,
            ));
            setCollections(mergeProfileRecords(body.state.collections, collections));
            setSyncStatus("saving");
            setSyncMessage("Объединяем изменения с другого устройства…");
            return;
          }
          if (!response.ok) throw new Error(body.error || "Не удалось сохранить профиль");
          if (body.merged && body.state) {
            profileRevision.current = body.state.revision;
            skipNextRemoteSave.current = true;
            setProducts(body.state.products.map(normalizeProduct));
            setCollections(body.state.collections);
            if (body.state.palette?.accent) setPalette(body.state.palette);
            if (body.state.currency === "RUB" || body.state.currency === "USD" || body.state.currency === "EUR") setCurrency(body.state.currency);
          } else if (typeof body.revision === "number") {
            profileRevision.current = body.revision;
          }
          deletedProductIds.forEach((id) => pendingProductDeletions.current.delete(id));
          if (pendingMigrationKey.current) {
            window.localStorage.setItem(pendingMigrationKey.current, "1");
            pendingMigrationKey.current = null;
          }
          setSyncStatus("synced");
          setSyncMessage("Все карточки сохранены в Telegram-профиле");
        } catch (error) {
          setSyncStatus("error");
          setSyncMessage(error instanceof Error ? error.message : "Не удалось сохранить изменения");
        }
      })();
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [products, collections, palette, currency, loaded, remoteReady]);


  useEffect(() => {
    if (!remoteReady || syncStatus !== "synced" || !telegramInitData.current) return;
    let disposed = false;

    async function pullRemoteState() {
      if (disposed || document.hidden || remoteFetchInFlight.current) return;
      remoteFetchInFlight.current = true;
      try {
        const response = await fetch("/api/profile", {
          headers: { "x-telegram-init-data": telegramInitData.current },
          cache: "no-store",
        });
        const body = await response.json() as ProfileApiResponse;
        if (!response.ok || !body.state || body.state.revision <= (profileRevision.current ?? 0)) return;
        profileRevision.current = body.state.revision;
        pendingProductDeletions.current.clear();
        skipNextRemoteSave.current = true;
        setProducts(body.state.products.map(normalizeProduct));
        setCollections(body.state.collections);
        if (body.state.palette?.accent) setPalette(body.state.palette);
        if (body.state.currency === "RUB" || body.state.currency === "USD" || body.state.currency === "EUR") setCurrency(body.state.currency);
        if (body.profile) setProfile(body.profile);
        setSyncMessage("Получены свежие данные Telegram-профиля");
      } catch {
        // A short network interruption must not replace the last synchronized state.
      } finally {
        remoteFetchInFlight.current = false;
      }
    }

    const handleFocus = () => { void pullRemoteState(); };
    const handleVisibility = () => { if (!document.hidden) void pullRemoteState(); };
    const interval = window.setInterval(() => { void pullRemoteState(); }, 15_000);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [remoteReady, syncStatus]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const categories = useMemo(
    () => ["Все", ...Array.from(new Set(products.map((product) => product.category)))],
    [products],
  );

  const visibleProducts = useMemo(() => {
    let result = products;
    if (activeNav === "Избранное") result = result.filter((product) => product.favorite);
    if (activeCategory !== "Все") result = result.filter((product) => product.category === activeCategory);
    if (search.trim()) {
      const query = search.trim().toLocaleLowerCase("ru");
      result = result.filter((product) =>
        `${product.name} ${product.source} ${product.category}`.toLocaleLowerCase("ru").includes(query),
      );
    }
    return result;
  }, [products, activeCategory, activeNav, search]);

  const formatPrice = (value: number) => formatPriceValue(value, currency, rates);
  const totalValue = products.reduce((sum, product) => sum + product.price, 0);
  const favoriteCount = products.filter((product) => product.favorite).length;
  const summaryUnavailable = catalogReady && syncStatus === "error" && Boolean(telegramInitData.current);
  const displayName = profile?.firstName || "друг";
  const avatarLetter = displayName.slice(0, 1).toLocaleUpperCase("ru");
  const themeStyle = {
    "--paper": palette.paper,
    "--ink": palette.ink,
    "--surface": palette.surface ?? palettes.find((item) => item.id === palette.id)?.surface ?? "#151713",
    "--muted": `color-mix(in srgb, ${palette.ink} 58%, ${palette.paper})`,
    "--line": `color-mix(in srgb, ${palette.ink} 16%, ${palette.paper})`,
    "--card": palette.card,
    "--lime": palette.accent,
    "--accent-2": palette.accent2,
    "--accent-3": palette.accent3,
  } as CSSProperties;

  function toggleFavorite(id: number) {
    haptic();
    setProducts((current) =>
      current.map((product) =>
        product.id === id ? { ...product, favorite: !product.favorite } : product,
      ),
    );
  }

  function changeNav(item: string) {
    haptic();
    if (item === "Добавить") {
      setAddOpen(true);
      return;
    }
    setActiveNav(item);
    setActiveCategory("Все");
    setSearchOpen(false);
  }

  function addProduct(product: Product) {
    setProducts((current) => [product, ...current]);
    setActiveNav("Главная");
    setActiveCategory("Все");
    setAddOpen(false);
    setToast("Товар добавлен. Первый чек — через 2 минуты");
    haptic("medium");
  }

  function deleteProduct(id: number) {
    const product = products.find((item) => item.id === id);
    if (!product || !window.confirm(`Удалить карточку «${product.name}»?`)) return;
    pendingProductDeletions.current.add(id);
    setProducts((current) => current.filter((item) => item.id !== id));
    setCollections((current) => current.map((collection) => ({
      ...collection,
      productIds: collection.productIds.filter((productId) => productId !== id),
    })));
    setSelected(null);
    setToast(`Карточка «${product.name}» удалена`);
    haptic("medium");
  }

  async function checkPrice(id: number) {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    if (!isLisSkinsUrl(product.url)) {
      setToast("Автоматическая проверка пока доступна для LIS-SKINS");
      return;
    }
    setToast("Проверяем цену в каталоге LIS-SKINS…");
    try {
      const resolved = await resolveLisProduct(product.url);
      setProducts((current) => current.map((item) => item.id === id ? withResolvedLisPrice(item, resolved) : item));
      setToast(`Цена обновлена: ${formatPrice(resolved.priceRub)}`);
      haptic("medium");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось проверить цену");
    }
  }

  async function refreshAllPrices() {
    if (refreshingPrices) return;
    const supportedProducts = products.filter((product) => /^https?:\/\//i.test(product.url));
    if (!supportedProducts.length) {
      setToast("Нет товаров для автоматического обновления");
      return;
    }
    setRefreshingPrices(true);
    setToast(`Обновляем ${supportedProducts.length} цен…`);
    try {
      const results = await Promise.allSettled(supportedProducts.map(async (product) => {
        if (isLisSkinsUrl(product.url)) {
          return { id: product.id, lis: await resolveLisProduct(product.url) };
        }
        const store = await resolveStoreProduct(product.url, product.name);
        if (!store.priceRub || store.priceRub <= 0) throw new Error("Цена не распознана");
        return { id: product.id, store };
      }));
      const updates = new Map<number, { lis?: ResolvedLisProduct; store?: ResolvedStoreProduct }>();
      results.forEach((result) => {
        if (result.status === "fulfilled") updates.set(result.value.id, result.value);
      });
      if (updates.size) {
        setProducts((current) => current.map((product) => {
          const resolved = updates.get(product.id);
          if (resolved?.lis) return withResolvedLisPrice(product, resolved.lis);
          if (resolved?.store) return withResolvedStorePrice(product, resolved.store);
          return product;
        }));
      }
      setToast(updates.size
        ? `Обновлено цен: ${updates.size} из ${supportedProducts.length}`
        : "Не удалось обновить цены — попробуйте позже");
      haptic("medium");
    } finally {
      setRefreshingPrices(false);
    }
  }

  async function addOffer(productId: number, url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setToast("Нужна полная ссылка на магазин");
      return;
    }
    if (!isLisSkinsUrl(parsed.href)) {
      setToast("Автоцена для этого магазина пока не подключена");
      return;
    }
    try {
      const resolved = await resolveLisProduct(parsed.href);
      setProducts((current) => current.map((product) => {
        if (product.id !== productId) return product;
        const offer: Offer = {
          id: `${productId}-${Date.now()}`,
          store: "LIS-SKINS",
          price: resolved.priceRub,
          url: resolved.url,
          note: `Официальный каталог · ${resolved.count} ${resolved.count === 1 ? "предложение" : "предложения"}`,
        };
        return { ...product, offers: [...(product.offers ?? []).filter((item) => item.url !== resolved.url), offer] };
      }));
      setToast("Цена магазина получена из каталога LIS-SKINS");
      haptic("medium");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось добавить магазин");
    }
  }
  async function shareCollection(collection: Collection) {
    const collectionProducts = products.filter((product) => collection.productIds.includes(product.id));
    const code = window.btoa(encodeURIComponent(JSON.stringify({ collection, products: collectionProducts })));
    const shareUrl = `${window.location.origin}${window.location.pathname}#collection=${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: collection.name, text: "Моя подборка цен в PricePulse", url: shareUrl });
        setToast("Подборка отправлена");
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setToast("Ссылка на подборку скопирована");
      }
    } catch {
      setToast("Отправка отменена");
    }
    haptic();
  }

  return (
    <CurrencyContext.Provider value={{ currency, rates }}>
    <main className="app-shell" style={themeStyle}>
      <header className="topbar">
        <button className="brand" aria-label="PricePulse — на главную" onClick={() => changeNav("Главная")}>
          <span className="brand-mark">P<span /></span>
          <span>PricePulse</span>
        </button>
        <div className="top-actions">
          <button
            className={`icon-button ${searchOpen ? "active" : ""}`}
            aria-label="Поиск"
            onClick={() => setSearchOpen((value) => !value)}
          >
            ⌕
          </button>
          <button className="icon-button palette-button" aria-label="Выбрать цветовую палитру" onClick={() => setThemeOpen(true)}>
            ◐
          </button>
          <button className="icon-button notification" aria-label="Уведомления" onClick={() => setToast("Изменения цены приходят сообщением от бота")}>
            ♢<span />
          </button>
          <button className="avatar" aria-label={profile ? `Профиль ${displayName}` : "Профиль"} onClick={() => changeNav("Профиль")}>{avatarLetter}</button>
        </div>
      </header>

      {searchOpen && (
        <div className="search-row">
          <span>⌕</span>
          <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, магазин или категория" aria-label="Поиск товаров" />
          {search && <button onClick={() => setSearch("")} aria-label="Очистить поиск">×</button>}
        </div>
      )}

      {activeNav === "ИИ-поиск" ? (
        <SmartDiscoveryView products={products} />
      ) : activeNav === "Инвестиции" ? (
        <InvestmentsView />
      ) : activeNav === "Профиль" ? (
        <ProfileView products={products} palette={palette} profile={profile} syncStatus={syncStatus} syncMessage={syncMessage} refreshingPrices={refreshingPrices} currency={currency} ratesReady={rates.USD > 0 && rates.EUR > 0} onCurrency={setCurrency} onRefreshAll={refreshAllPrices} onTheme={() => setThemeOpen(true)} />
      ) : (
        <>
          <section className="welcome-row">
            <div>
              <p className="eyebrow">ДОБРЫЙ ВЕЧЕР, {displayName.toLocaleUpperCase("ru")}</p>
              <h1>{activeNav === "Избранное" ? "Избранные товары" : "Следи за ценой. Покупай вовремя."}</h1>
            </div>
            <button className="text-link" onClick={() => setToast("Все цены обновляются по заданному расписанию")}>Как это работает <span>↗</span></button>
          </section>

          <section className={`summary-card ${catalogReady ? "is-ready" : "is-loading"}`} aria-busy={!catalogReady}>
            {!catalogReady ? (
              <div className="summary-loader" role="status" aria-live="polite">
                <div className="summary-loader-copy" aria-hidden="true">
                  <span>СИНХРОНИЗИРУЕМ ПРОФИЛЬ</span>
                  <i className="summary-skeleton summary-skeleton-price" />
                  <i className="summary-skeleton summary-skeleton-change" />
                </div>
                <div className="summary-loader-stats" aria-hidden="true">
                  {[0, 1, 2].map((item) => <i className="summary-skeleton" key={item} />)}
                </div>
                <span className="sr-only">Загружаем ваши товары и актуальную стоимость</span>
              </div>
            ) : summaryUnavailable ? (
              <div className="summary-load-error" role="alert">
                <span>!</span>
                <div><b>Не удалось загрузить стоимость</b><small>{syncMessage || "Откройте приложение ещё раз"}</small></div>
              </div>
            ) : (
              <>
                <div className="summary-copy">
                  <p className="summary-label">СТОИМОСТЬ ВСЕХ ТОВАРОВ</p>
                  <strong>{formatPrice(totalValue)}</strong>
                  <div className="summary-change"><span>↓ 2,4%</span> за последние 7 дней</div>
                </div>
                <div className="summary-stats">
                  <div><span>Под наблюдением</span><b>{products.length}</b></div>
                  <div><span>Снижение цены</span><b className="good">{products.filter((item) => item.change < 0).length}</b></div>
                  <div><span>В избранном</span><b>{favoriteCount}</b></div>
                </div>
              </>
            )}
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-dot dot-one" />
            <div className="hero-dot dot-two" />
          </section>

          <section className="catalog-section">
            <div className="section-heading">
              <div>
                <h2>{activeNav === "Избранное" ? "Сохранённое" : "Мои товары"}</h2>
                <p>{visibleProducts.length} {visibleProducts.length === 1 ? "товар" : "товара"} · цены в {currency}</p>
              </div>
              <button className="outline-add" onClick={() => setAddOpen(true)}><span>＋</span> Добавить товар</button>
            </div>

            <div className="category-scroll" aria-label="Фильтр по категориям">
              {categories.map((category) => (
                <button key={category} className={activeCategory === category ? "selected" : ""} onClick={() => setActiveCategory(category)}>
                  {category}
                  {category !== "Все" && <small>{products.filter((item) => item.category === category).length}</small>}
                </button>
              ))}
            </div>

            {visibleProducts.length ? (
              <div className="product-grid">
                {visibleProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onFavorite={toggleFavorite} onDelete={deleteProduct} onOpen={setSelected} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div>⌕</div>
                <h3>Ничего не нашли</h3>
                <p>Попробуйте другой запрос или добавьте товар по ссылке.</p>
                <button onClick={() => setAddOpen(true)}>Добавить товар</button>
              </div>
            )}
          </section>
        </>
      )}

      <nav className="bottom-nav" aria-label="Основная навигация">
        {[
          { item: "Главная", icon: "⌂" },
          { item: "ИИ-поиск", icon: "✦" },
          { item: "Добавить", icon: "+" },
          { item: "Инвестиции", icon: null },
          { item: "Избранное", icon: "♡" },
        ].map(({ item, icon }) => (
          <button key={item} className={`${activeNav === item ? "current" : ""} ${item === "Добавить" ? "nav-add" : ""}`} onClick={() => changeNav(item)} aria-label={item}>
            <span className={item === "Инвестиции" ? "nav-investments-icon" : undefined}>
              {item === "Инвестиции" ? (
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              ) : icon}
            </span>
            <small>{item}</small>
          </button>
        ))}
      </nav>

      {addOpen && <AddProductModal onClose={() => setAddOpen(false)} onAdd={addProduct} categories={categories.filter((item) => item !== "Все")} />}
      {themeOpen && <ThemeModal palette={palette} onApply={(next) => { setPalette(next); setThemeOpen(false); setToast(`Палитра «${next.name}» включена`); }} onClose={() => setThemeOpen(false)} />}
      {collectionOpen && <CollectionModal products={products} onClose={() => setCollectionOpen(false)} onCreate={(collection) => { setCollections((current) => [collection, ...current]); setCollectionOpen(false); setToast("Подборка создана — теперь ей можно делиться"); }} />}
      {selectedCollection && (
        <CollectionDetailsModal
          collection={collections.find((collection) => collection.id === selectedCollection.id) ?? selectedCollection}
          products={products}
          onClose={() => setSelectedCollection(null)}
          onShare={shareCollection}
          onOpenProduct={(product) => { setSelectedCollection(null); setSelected(product); }}
        />
      )}
      {selected && (
        <ProductDetails
          product={products.find((product) => product.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onFavorite={toggleFavorite}
          onCheck={checkPrice}
          onAddOffer={addOffer}
          onDelete={deleteProduct}
          onAlert={(id, settings) => {
            const withAlert = (product: Product): Product => ({
              ...product,
              alertMode: settings?.mode,
              alertThreshold: settings?.threshold,
              alertReferencePrice: settings ? product.price : undefined,
              alertCheckPending: Boolean(settings),
              target: undefined,
              targetAlerted: undefined,
              targetCheckPending: undefined,
              nextCheck: settings ? "проверка порога в течение минуты" : `через ${product.period} ч`,
            });
            setProducts((current) => current.map((product) => product.id === id ? withAlert(product) : product));
            setSelected((current) => current ? withAlert(current) : current);
            if (settings) {
              const thresholdLabel = settings.mode === "percent"
                ? `${settings.threshold.toLocaleString("ru-RU")}%`
                : `${Math.round(settings.threshold).toLocaleString("ru-RU")} ₽`;
              setToast(`Уведомим при изменении на ±${thresholdLabel}`);
            } else {
              setToast("Уведомления об изменении цены отключены");
            }
          }}
          onPeriod={(id, period) => {
            setProducts((current) => current.map((product) => product.id === id ? { ...product, period, nextCheck: `через ${period} ч` } : product));
            setSelected((current) => current ? { ...current, period } : current);
            setToast(`Проверка настроена каждые ${period} ч`);
          }}
        />
      )}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
    </CurrencyContext.Provider>
  );
}

function ProductCard({ product, onFavorite, onDelete, onOpen }: { product: Product; onFavorite: (id: number) => void; onDelete: (id: number) => void; onOpen: (product: Product) => void }) {
  const formatPrice = usePriceFormatter();
  const forecast = forecastFor(product);
  return (
    <article className="product-card" role="button" tabIndex={0} onClick={() => onOpen(product)} onKeyDown={(event) => event.key === "Enter" && onOpen(product)}>
      <div className={`product-art ${product.artClass} ${product.imageUrl ? "has-preview" : ""}`}>
        <span>{product.art}</span>
        {product.imageUrl && <img src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.remove("has-preview"); }} />}
        <div className="art-grid" />
        <div className="source-badge">{product.source}</div>
        {(product.offers?.length ?? 0) > 1 && <div className="offer-count">{product.offers?.length} магазина</div>}
        <button className={`heart ${product.favorite ? "liked" : ""}`} aria-label={product.favorite ? "Убрать из избранного" : "Добавить в избранное"} onClick={(event) => { event.stopPropagation(); onFavorite(product.id); }}>
          {product.favorite ? "♥" : "♡"}
        </button>
        <button className="card-delete" aria-label={`Удалить ${product.name}`} onClick={(event) => { event.stopPropagation(); onDelete(product.id); }}>⌫</button>
      </div>
      <div className="product-body">
        <div className="product-title-row">
          <div><p>{product.category}</p><h3>{product.name}</h3></div>
          <span className={`trend ${product.change < 0 ? "down" : product.change > 0 ? "up" : "flat"}`}>
            {product.change < 0 ? "↓" : product.change > 0 ? "↑" : "—"} {Math.abs(product.change).toLocaleString("ru-RU")}%
          </span>
        </div>
        <div className="price-row"><strong>{formatPrice(product.price)}</strong><s>{product.change !== 0 ? formatPrice(product.oldPrice) : ""}</s></div>
        <div className={`prediction-row ${forecast.tone}`}><span>✦ {forecast.label}</span><small>{forecast.confidence === null ? `${forecast.observedCount}/${MIN_FORECAST_POINTS} замера` : `${forecast.confidence}% доверие`}</small></div>
        <div className="monitor-row">
          <span className="pulse-dot" />
          <p>Проверка каждые {product.period} ч</p>
          <time>{product.nextCheck}</time>
        </div>
      </div>
    </article>
  );
}

function AddProductModal({ onClose, onAdd, categories }: { onClose: () => void; onAdd: (product: Product) => void; categories: string[] }) {
  const [url, setUrl] = useState("");
  const [period, setPeriod] = useState(3);
  const [customPeriod, setCustomPeriod] = useState("");
  const [category, setCategory] = useState("CS2");
  const [customCategory, setCustomCategory] = useState("");
  const [alertMode, setAlertMode] = useState<PriceAlertSettings["mode"]>("amount");
  const [alertThreshold, setAlertThreshold] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualName, setManualName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lisUrlEntered = isLisSkinsUrl(url);

  async function submit(event: FormEvent) {
    event.preventDefault();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error();
    } catch {
      setError("Вставьте полную ссылку на страницу товара");
      return;
    }
    const finalPeriod = customPeriod ? Number(customPeriod) : period;
    if (!Number.isFinite(finalPeriod) || finalPeriod < 1) {
      setError("Минимальный период мониторинга — 1 час");
      return;
    }
    const isLis = isLisSkinsUrl(parsedUrl.href);
    const enteredPrice = Number(manualPrice.replace(/\s/g, "").replace(",", "."));
    const enteredAlert = alertThreshold ? Number(alertThreshold.replace(/\s/g, "").replace(",", ".")) : null;
    const alertLimit = alertMode === "percent" ? 100 : 100_000_000;
    const alertMinimum = alertMode === "percent" ? 0.1 : 1;
    if (enteredAlert !== null && (!Number.isFinite(enteredAlert) || enteredAlert < alertMinimum || enteredAlert > alertLimit)) {
      setError(alertMode === "percent"
        ? "Процент изменения должен быть от 0,1% до 100%"
        : "Сумма изменения должна быть от 1 до 100 000 000 ₽");
      return;
    }
    const normalizedAlert = enteredAlert === null
      ? undefined
      : alertMode === "percent" ? Math.round(enteredAlert * 10) / 10 : Math.round(enteredAlert);

    setLoading(true);
    setError("");
    try {
      let resolved: ResolvedStoreProduct | ResolvedLisProduct | null = null;
      try {
        resolved = isLis ? await resolveLisProduct(parsedUrl.href) : await resolveStoreProduct(parsedUrl.href, manualName.trim());
      } catch (resolveError) {
        if (isLis) throw resolveError;
      }

      const source = resolved?.source ?? parsedUrl.hostname.replace(/^www\./, "").toUpperCase();
      const pathName = decodeURIComponent(parsedUrl.pathname).split("/").filter(Boolean).pop() ?? "";
      const pathCandidate = pathName
        .replace(/\.(?:html?|aspx?)$/i, "")
        .replace(/[-_]?\d{5,}(?:[-_].*)?$/, "")
        .replace(/[-_]+/g, " ")
        .trim();
      const inferredName = /[\p{L}]{3}/u.test(pathCandidate)
        ? pathCandidate.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 80)
        : `Товар из ${source}`;
      const productName = manualName.trim() || resolved?.name || inferredName;
      const resolvedPrice = typeof resolved?.priceRub === "number" && resolved.priceRub > 0 ? resolved.priceRub : null;
      const currentPrice = resolvedPrice ?? enteredPrice;
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        setError("Цена не определилась автоматически — укажите её вручную");
        return;
      }

      const now = Date.now();
      const productUrl = resolved?.url ?? parsedUrl.href;
      onAdd({
        id: now,
        name: productName,
        source,
        url: productUrl,
        category: customCategory.trim() || category,
        price: currentPrice,
        oldPrice: currentPrice,
        change: 0,
        period: finalPeriod,
        nextCheck: "первый чек через 2 мин",
        art: isLis ? "CS" : "+",
        artClass: isLis ? "violet" : "blue",
        favorite: false,
        imageUrl: resolved?.imageUrl ?? undefined,
        priceHistory: [{ price: currentPrice, capturedAt: new Date(now).toISOString() }],
        alertMode,
        alertThreshold: normalizedAlert,
        alertReferencePrice: normalizedAlert ? currentPrice : undefined,
        alertCheckPending: false,
        offers: [{
          id: `${now}-${parsedUrl.hostname}`,
          store: source,
          price: currentPrice,
          url: productUrl,
          note: isLis && resolved
            ? `Официальный каталог · ${resolved.count} ${resolved.count === 1 ? "предложение" : "предложения"}`
            : resolvedPrice
              ? "Название и цена распознаны со страницы магазина"
              : resolved
                ? "Название распознано · цена указана вручную"
                : "Название и цена указаны вручную",
        }],
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось распознать товар");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="modal-kicker"><span>＋</span> НОВОЕ НАБЛЮДЕНИЕ</div>
        <h2 id="add-title">Добавить товар</h2>
        <p className="modal-lead">Вставьте ссылку — распознаем товар и начнём следить за ценой.</p>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="product-url">Ссылка на товар</label>
          <label className="url-field" htmlFor="product-url"><span>↗</span><input id="product-url" type="url" autoFocus value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} placeholder="https://lis-skins.com/market/..." /></label>
          <p className="field-hint">LIS-SKINS распознаётся автоматически по официальному каталогу</p>

          {!lisUrlEntered && url && (
            <div className="manual-price-field">
              <label className="field-label" htmlFor="manual-name">Название товара <span className="optional-label">если не распознается</span></label>
              <input id="manual-name" className="standalone-input product-name-fallback" value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Например, Apple AirPods Pro 2" />
              <label className="field-label manual-price-label" htmlFor="manual-price">Текущая цена <span className="optional-label">если не определится</span></label>
              <label className="price-input" htmlFor="manual-price"><input id="manual-price" inputMode="decimal" value={manualPrice} onChange={(event) => setManualPrice(event.target.value.replace(/[^\d,.\s]/g, ""))} placeholder="Например, 4 500" /><span>₽</span></label>
              <p className="field-hint">Ozon и другие поддерживаемые магазины проверяются по содержимому страницы, а не по названию в URL.</p>
            </div>
          )}

          <div className="form-grid">
            <div>
              <span className="field-label">Категория</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория товара">
                {categories.map((item) => <option key={item}>{item}</option>)}
                <option value="Другое">Другое</option>
              </select>
            </div>
            <div className="alert-field">
              <label className="field-label" htmlFor="alert-threshold">Уведомлять при изменении</label>
              <div className="alert-mode-switch" role="radiogroup" aria-label="Тип порога уведомления">
                <button type="button" role="radio" aria-checked={alertMode === "amount"} className={alertMode === "amount" ? "selected" : ""} onClick={() => { setAlertMode("amount"); setError(""); }}>₽ Сумма</button>
                <button type="button" role="radio" aria-checked={alertMode === "percent"} className={alertMode === "percent" ? "selected" : ""} onClick={() => { setAlertMode("percent"); setError(""); }}>% Процент</button>
              </div>
              <label className="price-input" htmlFor="alert-threshold">
                <input id="alert-threshold" inputMode="decimal" value={alertThreshold} onChange={(event) => setAlertThreshold(event.target.value.replace(/[^\d,.\s]/g, ""))} placeholder={alertMode === "percent" ? "Например, 10" : "Например, 50 000"} />
                <span>{alertMode === "percent" ? "%" : "₽"}</span>
              </label>
              <p className="field-hint">Считаем в обе стороны от цены на момент настройки</p>
            </div>
          </div>
          {category === "Другое" && <input className="standalone-input" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Название новой категории" aria-label="Новая категория" />}

          <span className="field-label frequency-label">Как часто проверять цену?</span>
          <div className="frequency-grid">
            {[1, 3, 6, 12, 24].map((hours) => (
              <button type="button" key={hours} className={period === hours && !customPeriod ? "picked" : ""} onClick={() => { setPeriod(hours); setCustomPeriod(""); }}>
                {hours === 24 ? "1 день" : `${hours} ч`}
              </button>
            ))}
          </div>
          <label className="custom-period" htmlFor="custom-period-hours">
            <span>Свой период</span>
            <input id="custom-period-hours" min="1" type="number" value={customPeriod} onChange={(event) => setCustomPeriod(event.target.value)} placeholder="—" aria-label="Свой период в часах" />
            <span>часов</span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="smart-note"><span>✦</span><p><b>Точный порог</b><br />Сообщим только когда цена изменится на заданную сумму или процент. После уведомления отсчёт начнётся заново.</p></div>
          <button className="primary-button" type="submit" disabled={loading}>{loading ? "Распознаём товар…" : "Начать мониторинг"} <span>→</span></button>
        </form>
      </section>
    </div>
  );
}
function ProductDetails({ product, onClose, onFavorite, onCheck, onPeriod, onAlert, onAddOffer, onDelete }: { product: Product; onClose: () => void; onFavorite: (id: number) => void; onCheck: (id: number) => void; onPeriod: (id: number, period: number) => void; onAlert: (id: number, settings?: PriceAlertSettings) => void; onAddOffer: (id: number, url: string) => void; onDelete: (id: number) => void }) {
  const formatPrice = usePriceFormatter();
  const [offerInputOpen, setOfferInputOpen] = useState(false);
  const [offerUrl, setOfferUrl] = useState("");
  const [forecastOpen, setForecastOpen] = useState(false);
  const [alertEditing, setAlertEditing] = useState(false);
  const [alertMode, setAlertMode] = useState<PriceAlertSettings["mode"]>(product.alertMode === "percent" ? "percent" : "amount");
  const [alertInput, setAlertInput] = useState(product.alertThreshold ? String(product.alertThreshold) : "");
  const [alertError, setAlertError] = useState("");
  const forecast = forecastFor(product);
  const offers = [...(product.offers ?? [])].sort((a, b) => a.price - b.price);

  function saveAlert(event: FormEvent) {
    event.preventDefault();
    const value = Number(alertInput.replace(/\s/g, "").replace(",", "."));
    const limit = alertMode === "percent" ? 100 : 100_000_000;
    const minimum = alertMode === "percent" ? 0.1 : 1;
    if (!Number.isFinite(value) || value < minimum || value > limit) {
      setAlertError(alertMode === "percent"
        ? "Введите процент от 0,1% до 100%"
        : "Введите сумму от 1 до 100 000 000 ₽");
      return;
    }
    const threshold = alertMode === "percent" ? Math.round(value * 10) / 10 : Math.round(value);
    onAlert(product.id, { mode: alertMode, threshold });
    setAlertEditing(false);
    setAlertError("");
  }

  function clearAlert() {
    onAlert(product.id, undefined);
    setAlertInput("");
    setAlertEditing(false);
    setAlertError("");
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal details-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="details-head">
          <div className={`detail-art ${product.artClass} ${product.imageUrl ? "has-preview" : ""}`}>
            <span>{product.art}</span>
            {product.imageUrl && <img src={product.imageUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.remove("has-preview"); }} />}
          </div>
          <div><p>{product.source} · {product.category}</p><h2 id="detail-title">{product.name}</h2></div>
          <button className={`heart detail-heart ${product.favorite ? "liked" : ""}`} onClick={() => onFavorite(product.id)} aria-label="Избранное">{product.favorite ? "♥" : "♡"}</button>
        </div>
        <div className="detail-price"><div><span>Текущая цена</span><strong>{formatPrice(product.price)}</strong></div><span className={`trend ${product.change <= 0 ? "down" : "up"}`}>{product.change <= 0 ? "↓" : "↑"} {Math.abs(product.change)}%</span></div>
        <div className="chart-card">
          <div className="chart-labels">
            <span>{forecast.observedCount} {forecast.observedCount === 1 ? "замер" : "замеров"}</span>
            <b>{forecast.delta === 0 ? "без изменения" : `${forecast.delta > 0 ? "+" : "−"}${formatPrice(Math.abs(forecast.delta))}`}</b>
          </div>
          <div className="bar-chart" aria-label="График реальных замеров цены">
            {forecast.chart.map((value, index) => <i key={index} style={{ height: `${value}%` }} />)}
          </div>
        </div>
        <button
          type="button"
          className={`forecast-card ${forecast.tone}`}
          onClick={() => setForecastOpen((current) => !current)}
          aria-expanded={forecastOpen}
          aria-controls={`forecast-method-${product.id}`}
        >
          <span className="forecast-icon">✦</span>
          <span className="forecast-copy">
            <small>{forecast.confidence === null ? "ДАННЫХ НЕДОСТАТОЧНО" : `СИГНАЛ · ДОВЕРИЕ МОДЕЛИ ${forecast.confidence}%`}</small>
            <b>{forecast.label}</b>
            <span>{forecast.text}</span>
          </span>
          <span className={`forecast-arrow ${forecastOpen ? "open" : ""}`}>→</span>
        </button>
        {forecastOpen && (
          <div className="forecast-method" id={`forecast-method-${product.id}`}>
            <b>Как считается сигнал</b>
            <p>Используем только сохранённые замеры этого товара: линейный тренд, отклонение текущей цены от средней и волатильность.</p>
            <dl>
              <div><dt>Замеров</dt><dd>{forecast.observedCount}</dd></div>
              <div><dt>Тренд</dt><dd>{forecast.trendPercent > 0 ? "+" : ""}{forecast.trendPercent.toFixed(1)}%</dd></div>
              <div><dt>От средней</dt><dd>{forecast.deviationPercent > 0 ? "+" : ""}{forecast.deviationPercent.toFixed(1)}%</dd></div>
              <div><dt>Волатильность</dt><dd>{forecast.volatilityPercent.toFixed(1)}%</dd></div>
            </dl>
            <small>Доверие модели — оценка качества сигнала, а не вероятность роста и не гарантия результата.</small>
          </div>
        )}
        <div className="target-row">
          <div className="target-summary">
            <span>Порог уведомления</span>
            <small>{product.alertThreshold
              ? `Отсчёт от ${formatPrice(product.alertReferencePrice || product.price)} · рост или снижение`
              : "Бот не присылает уведомления без заданного порога"}</small>
          </div>
          <button
            type="button"
            className="target-edit-button"
            onClick={() => {
              setAlertMode(product.alertMode === "percent" ? "percent" : "amount");
              setAlertInput(product.alertThreshold ? String(product.alertThreshold) : "");
              setAlertError("");
              setAlertEditing((current) => !current);
            }}
            aria-expanded={alertEditing}
            aria-controls={`alert-editor-${product.id}`}
          >
            <b>{product.alertThreshold
              ? (product.alertMode === "percent" ? `${product.alertThreshold.toLocaleString("ru-RU")}%` : formatPrice(product.alertThreshold))
              : "Не задан"}</b>
            <small>{alertEditing ? "Закрыть" : "Изменить"}</small>
          </button>
        </div>
        {alertEditing && (
          <form className="target-edit-form alert-edit-form" id={`alert-editor-${product.id}`} onSubmit={saveAlert}>
            <div className="alert-mode-switch compact" role="radiogroup" aria-label="Тип порога уведомления">
              <button type="button" role="radio" aria-checked={alertMode === "amount"} className={alertMode === "amount" ? "selected" : ""} onClick={() => { setAlertMode("amount"); setAlertError(""); }}>₽ Сумма</button>
              <button type="button" role="radio" aria-checked={alertMode === "percent"} className={alertMode === "percent" ? "selected" : ""} onClick={() => { setAlertMode("percent"); setAlertError(""); }}>% Процент</button>
            </div>
            <label className="price-input" htmlFor={`detail-alert-${product.id}`}>
              <input
                id={`detail-alert-${product.id}`}
                inputMode="decimal"
                min={alertMode === "percent" ? "0.1" : "1"}
                value={alertInput}
                onChange={(event) => { setAlertInput(event.target.value.replace(/[^\d,.\s]/g, "")); setAlertError(""); }}
                placeholder={alertMode === "percent" ? "Например, 10" : "Например, 50 000"}
                aria-label={alertMode === "percent" ? "Процент изменения цены" : "Сумма изменения цены"}
              />
              <span>{alertMode === "percent" ? "%" : "₽"}</span>
            </label>
            <button className="target-save-button" type="submit">Сохранить</button>
            {product.alertThreshold && <button className="target-clear-button" type="button" onClick={clearAlert}>Сбросить</button>}
            {alertError && <p className="form-error" role="alert">{alertError}</p>}
          </form>
        )}

        <div className="comparison-head">
          <div><span className="field-label">СРАВНЕНИЕ МАГАЗИНОВ</span><p>{offers.length} {offers.length === 1 ? "предложение" : "предложения"}</p></div>
          <button onClick={() => setOfferInputOpen((current) => !current)}>＋ Магазин</button>
        </div>
        <div className="offer-list">
          {offers.map((offer, index) => (
            <button key={offer.id} className="offer-row" onClick={() => window.open(offerUrlForProduct(offer, product.name), "_blank", "noopener,noreferrer")}>
              <span className="offer-rank">{index + 1}</span>
              <span><b>{offer.store}</b><small>{offer.note}</small></span>
              <span className="offer-price"><b>{formatPrice(offer.price)}</b>{index === 0 && <small>Лучшая цена</small>}</span>
              <span>↗</span>
            </button>
          ))}
        </div>
        {offerInputOpen && (
          <form className="offer-form" onSubmit={(event) => { event.preventDefault(); if (offerUrl) { onAddOffer(product.id, offerUrl); setOfferUrl(""); setOfferInputOpen(false); } }}>
            <input type="url" value={offerUrl} onChange={(event) => setOfferUrl(event.target.value)} placeholder="Ссылка на этот товар в другом магазине" aria-label="Ссылка на другой магазин" />
            <button type="submit">Добавить</button>
          </form>
        )}

        <span className="field-label frequency-label">Проверять цену</span>
        <div className="frequency-grid details-frequency">
          {[1, 3, 6, 12, 24].map((hours) => <button key={hours} className={product.period === hours ? "picked" : ""} onClick={() => onPeriod(product.id, hours)}>{hours === 24 ? "1 день" : `${hours} ч`}</button>)}
        </div>
        <div className="detail-actions">
          <button className="secondary-button" onClick={() => window.open(product.url, "_blank", "noopener,noreferrer")}>Открыть магазин ↗</button>
          <button className="primary-button" onClick={() => onCheck(product.id)}>Проверить сейчас</button>
        </div>
        <button className="delete-product-button" onClick={() => onDelete(product.id)}>⌫ Удалить карточку</button>
      </section>
    </div>
  );
}

function CollectionsView({ collections, products, onShare, onOpen, onCreate }: { collections: Collection[]; products: Product[]; onShare: (collection: Collection) => void; onOpen: (collection: Collection) => void; onCreate: () => void }) {
  const formatPrice = usePriceFormatter();
  return (
    <section className="collections-view">
      <div className="collections-title">
        <div><p className="eyebrow">ЦЕНЫ, КОТОРЫМИ МОЖНО ДЕЛИТЬСЯ</p><h1>Мои подборки</h1></div>
        <button className="outline-add collection-add" onClick={onCreate}><span>＋</span> Новая подборка</button>
      </div>
      <div className="collections-hero">
        <div><span>⇧</span><h2>Соберите товары вместе</h2><p>Откройте подборку, быстро просмотрите товары или отправьте одну ссылку другу.</p></div>
        <div className="shared-demo"><span>pricepulse.app</span><b>/collection/your-list</b><i>↗</i></div>
      </div>
      <div className="collection-grid">
        {collections.map((collection, collectionIndex) => {
          const items = products.filter((product) => collection.productIds.includes(product.id));
          const total = items.reduce((sum, item) => sum + item.price, 0);
          return (
            <article className="collection-card" key={collection.id}>
              <button
                type="button"
                className="collection-card-open"
                aria-label={`Открыть подборку ${collection.name}`}
                onClick={() => onOpen(collection)}
              >
              <div className={`collection-cover cover-${collectionIndex % 3}`}>
                <div className="collection-stack">
                  {items.slice(0, 3).map((item) => (
                    <span key={item.id} className={`${item.artClass} ${item.imageUrl ? "has-image" : ""}`}>
                      {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : item.art}
                    </span>
                  ))}
                </div>
              </div>
              <div className="collection-body">
                <p>{items.length} {items.length === 1 ? "товар" : "товара"} · {formatPrice(total)}</p>
                <h3>{collection.name}</h3>
                <span className="collection-open-label">Открыть товары <i>→</i></span>
              </div>
              </button>
              <button className="collection-share" type="button" onClick={() => void onShare(collection)} aria-label={`Поделиться подборкой ${collection.name}`}>↗</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CollectionDetailsModal({ collection, products, onClose, onShare, onOpenProduct }: { collection: Collection; products: Product[]; onClose: () => void; onShare: (collection: Collection) => void; onOpenProduct: (product: Product) => void }) {
  const formatPrice = usePriceFormatter();
  const items = products.filter((product) => collection.productIds.includes(product.id));
  const total = items.reduce((sum, product) => sum + product.price, 0);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal collection-details-modal" role="dialog" aria-modal="true" aria-labelledby="collection-details-title">
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="modal-kicker"><span>⇧</span> ПОДБОРКА</div>
        <h2 id="collection-details-title">{collection.name}</h2>
        <p className="modal-lead">{items.length} {items.length === 1 ? "товар" : "товара"} · всего {formatPrice(total)}</p>
        <div className="collection-details-list">
          {items.map((product) => (
            <button type="button" key={product.id} onClick={() => onOpenProduct(product)}>
              <span className={`mini-art ${product.artClass} ${product.imageUrl ? "has-image" : ""}`}>
                {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : product.art}
              </span>
              <span><b>{product.name}</b><small>{product.source} · {formatPrice(product.price)}</small></span>
              <i>→</i>
            </button>
          ))}
          {!items.length && <div className="collection-details-empty">В этой подборке пока нет доступных карточек.</div>}
        </div>
        <button className="secondary-button collection-share-button" type="button" onClick={() => void onShare(collection)}>Поделиться подборкой <span>↗</span></button>
      </section>
    </div>
  );
}

function CollectionModal({ products, onClose, onCreate }: { products: Product[]; onClose: () => void; onCreate: (collection: Collection) => void }) {
  const formatPrice = usePriceFormatter();
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal collection-modal" role="dialog" aria-modal="true" aria-labelledby="collection-title">
        <div className="modal-handle" /><button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="modal-kicker"><span>⇧</span> ОБЩАЯ ПОДБОРКА</div>
        <h2 id="collection-title">Новая подборка</h2>
        <p className="modal-lead">Выберите товары — приложение создаст ссылку для друзей.</p>
        <label className="field-label" htmlFor="collection-name">Название</label>
        <input className="standalone-input collection-name" id="collection-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, скины на август" />
        <span className="field-label collection-products-label">Товары</span>
        <div className="collection-product-list">
          {products.map((product) => {
            const checked = selectedIds.includes(product.id);
            return <button key={product.id} className={checked ? "checked" : ""} onClick={() => setSelectedIds((current) => checked ? current.filter((id) => id !== product.id) : [...current, product.id])}><span className={`mini-art ${product.artClass}`}>{product.art}</span><span><b>{product.name}</b><small>{formatPrice(product.price)}</small></span><i>{checked ? "✓" : "+"}</i></button>;
          })}
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" onClick={() => { if (!name.trim() || !selectedIds.length) { setError("Добавьте название и хотя бы один товар"); return; } onCreate({ id: `collection-${Date.now()}`, name: name.trim(), productIds: selectedIds }); }}>Создать подборку <span>→</span></button>
      </section>
    </div>
  );
}

function ThemeModal({ palette, onApply, onClose }: { palette: Palette; onApply: (palette: Palette) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<Palette>(palette);
  const previewStyle = { "--preview-paper": selected.paper, "--preview-ink": selected.ink, "--preview-surface": selected.surface ?? palettes.find((item) => item.id === selected.id)?.surface ?? "#151713", "--preview-card": selected.card, "--preview-accent": selected.accent, "--preview-accent-2": selected.accent2, "--preview-accent-3": selected.accent3 } as CSSProperties;
  const updateCustom = (key: keyof Pick<Palette, "paper" | "ink" | "card" | "accent" | "accent2" | "accent3">, value: string) => setSelected((current) => ({ ...current, surface: current.surface ?? palettes.find((item) => item.id === current.id)?.surface ?? "#151713", id: "custom", name: "Моя палитра", [key]: value }));
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal theme-modal" role="dialog" aria-modal="true" aria-labelledby="theme-title">
        <div className="modal-handle" /><button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="modal-kicker"><span>◐</span> ПЕРСОНАЛИЗАЦИЯ</div>
        <h2 id="theme-title">Ваша палитра</h2>
        <p className="modal-lead">Выберите настроение или соберите собственное из шести цветов.</p>
        <div className="theme-layout">
          <div className="palette-list">
            {palettes.map((item) => <button key={item.id} className={selected.id === item.id ? "active" : ""} onClick={() => setSelected(item)}><span className="palette-swatches">{[item.accent, item.accent2, item.accent3, item.paper].map((color) => <i key={color} style={{ background: color }} />)}</span><b>{item.name}</b><small>{selected.id === item.id ? "Выбрано" : "Применить"}</small></button>)}
          </div>
          <div className="theme-preview" style={previewStyle}>
            <span className="preview-brand">P</span><div><small>PRICEPULSE</small><b>Ваша тема</b><p>Цвета меняются сразу</p></div><i /><i /><i />
          </div>
        </div>
        <span className="field-label custom-colors-label">СВОИ ЦВЕТА</span>
        <div className="custom-colors">
          {([[
            "accent", "Акцент"], ["accent2", "Доп. 1"], ["accent3", "Доп. 2"], ["paper", "Фон"], ["card", "Карточки"], ["ink", "Текст"]] as const).map(([key, label]) => <label key={key}><input type="color" value={selected[key]} onChange={(event) => updateCustom(key, event.target.value)} /><span>{label}</span></label>)}
        </div>
        <button className="primary-button" onClick={() => onApply(selected)}>Применить палитру <span>→</span></button>
      </section>
    </div>
  );
}

function ProfileView({
  products,
  palette,
  profile,
  syncStatus,
  syncMessage,
  refreshingPrices,
  currency,
  ratesReady,
  onCurrency,
  onRefreshAll,
  onTheme,
}: {
  products: Product[];
  palette: Palette;
  profile: TelegramProfile | null;
  syncStatus: ProfileSyncStatus;
  syncMessage: string;
  refreshingPrices: boolean;
  currency: CurrencyCode;
  ratesReady: boolean;
  onCurrency: (currency: CurrencyCode) => void;
  onRefreshAll: () => Promise<void>;
  onTheme: () => void;
}) {
  const name = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") : "Telegram-профиль";
  const syncLabel = syncStatus === "synced"
    ? "Синхронизировано"
    : syncStatus === "saving"
      ? "Сохраняем…"
      : syncStatus === "loading"
        ? "Подключение…"
        : syncStatus === "error"
          ? "Ошибка синхронизации"
          : "";

  return (
    <section className="profile-view">
      <div className="profile-card">
        <div className="profile-avatar">{name.slice(0, 1).toLocaleUpperCase("ru")}</div>
        <div className="profile-identity">
          <p>TELEGRAM ACCOUNT</p>
          <h1>{name}</h1>
          <div className="profile-meta">
            {profile?.username && <span>@{profile.username}</span>}
            {profile?.id && <span>ID {profile.id}</span>}
          </div>
        </div>
        {syncLabel && <span className={`profile-sync-badge ${syncStatus}`}>{syncLabel}</span>}
      </div>
      {syncMessage && <p className={`profile-sync-note ${syncStatus}`}>{syncMessage}</p>}
      <div className="settings-card">
        <h2>Мониторинг</h2>
        <div className="setting-row"><span>Активных товаров</span><b>{products.length}</b></div>
        <div className="setting-row currency-setting">
          <span>Валюта</span>
          <div className="currency-switch" aria-label="Валюта отображения">
            {(["RUB", "USD", "EUR"] as CurrencyCode[]).map((code) => (
              <button
                type="button"
                key={code}
                className={currency === code ? "active" : ""}
                disabled={code !== "RUB" && !ratesReady}
                onClick={() => onCurrency(code)}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
        <button className="setting-row theme-setting" onClick={onTheme}><span>Цветовая палитра</span><b><i style={{ background: palette.accent }} /><i style={{ background: palette.accent2 }} /><i style={{ background: palette.accent3 }} /> {palette.name} →</b></button>
      </div>
      <div className="settings-card">
        <div className="features-heading"><h2>Новые возможности</h2><span>ОБНОВЛЕНО</span></div>
        <button className="idea-row feature-action" type="button" onClick={() => void onRefreshAll()} disabled={refreshingPrices} aria-busy={refreshingPrices}>
          <span className={refreshingPrices ? "refresh-spin" : ""}>↻</span><p><b>{refreshingPrices ? "Обновляем цены…" : "Обновить все цены"}</b><small>{refreshingPrices ? "Проверяем страницы магазинов" : "Проверить поддерживаемые товары прямо сейчас"}</small></p><i>{refreshingPrices ? "…" : "→"}</i>
        </button>
        <div className="idea-row enabled"><span>↯</span><p><b>Сравнение магазинов</b><small>Добавляйте предложения прямо в карточке</small></p><i>✓</i></div>
        <div className="idea-row enabled"><span>↘</span><p><b>Прогноз выгодной цены</b><small>Рекомендация на основе истории и тренда</small></p><i>✓</i></div>

        <div className="idea-row enabled"><span>✦</span><p><b>OpenRouter-ready</b><small>Автоматически включится после добавления серверного API-ключа</small></p><i>✓</i></div>
      </div>
    </section>
  );
}

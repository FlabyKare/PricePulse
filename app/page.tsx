"use client";

import type { CSSProperties } from "react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { isLisSkinsUrl } from "@/lib/lis-skins";

type Offer = {
  id: string;
  store: string;
  price: number;
  url: string;
  note: string;
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
  target?: number;
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
};

type DiscoverySource = {
  title: string;
  url: string;
  kind: "магазин" | "обзор" | "поиск";
};

type DiscoveryProduct = {
  id: string;
  name: string;
  description: string;
  priceLabel: string;
  ratingLabel: string;
  popularity: string;
  sourceCount: number;
  sources: DiscoverySource[];
};

type DiscoveryResponse = {
  query: string;
  engine: "openrouter" | "ai-web" | "smart-search";
  summary: string;
  products: DiscoveryProduct[];
  error?: string;
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
  card: string;
  accent: string;
  accent2: string;
  accent3: string;
};

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
    revision: number;
    updatedAt: string;
  } | null;
  error?: string;
};

type ProfileSyncStatus = "local" | "loading" | "saving" | "synced" | "error";

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: {
      initData?: string;
      ready?: () => void;
      expand?: () => void;
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
    target: 4500,
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
    target: 7900,
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
    target: 15500,
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
  { id: "pulse", name: "Pulse", paper: "#f4f3ee", ink: "#151713", card: "#ffffff", accent: "#dfff54", accent2: "#b997e7", accent3: "#64bfd2" },
  { id: "sunset", name: "Sunset", paper: "#fff4ed", ink: "#281b1b", card: "#fffdf9", accent: "#ff7a4d", accent2: "#ffd166", accent3: "#8e79d9" },
  { id: "ocean", name: "Ocean", paper: "#eef6f8", ink: "#12272f", card: "#ffffff", accent: "#42d6c3", accent2: "#6ea8fe", accent3: "#a78bfa" },
  { id: "berry", name: "Berry", paper: "#faf0f6", ink: "#2c1726", card: "#fffafd", accent: "#ff5c9a", accent2: "#b58cff", accent3: "#ffb45c" },
  { id: "ice", name: "Ice", paper: "#f2f7ff", ink: "#10233d", card: "#ffffff", accent: "#79d6ff", accent2: "#7c8cff", accent3: "#b7f171" },
  { id: "sand", name: "Sand", paper: "#f8f1e3", ink: "#292318", card: "#fffdf7", accent: "#e7a94b", accent2: "#7fb7a5", accent3: "#d27b78" },
];

const formatPrice = (value: number) =>
  new Intl.NumberFormat("ru-RU").format(value) + " ₽";

const chartValues = [56, 48, 52, 37, 43, 29, 22, 30, 18, 12];

function forecastFor(product: Product) {
  if (product.change <= -4) return { label: "Можно покупать", text: "Цена заметно ниже средней за неделю", tone: "buy", confidence: 86 };
  if (product.change > 1) return { label: "Лучше подождать", text: "Цена растёт — вероятна коррекция", tone: "wait", confidence: 74 };
  return { label: "Наблюдать", text: "Цена рядом со средним значением", tone: "watch", confidence: 68 };
}

function normalizeProduct(product: Product): Product {
  return {
    ...product,
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
    offers: [lisOffer, ...(product.offers ?? []).filter((offer) => offer.store !== "LIS-SKINS")],
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
  const [activeCategory, setActiveCategory] = useState("Все");
  const [activeNav, setActiveNav] = useState("Главная");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [toast, setToast] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [profile, setProfile] = useState<TelegramProfile | null>(null);
  const [syncStatus, setSyncStatus] = useState<ProfileSyncStatus>("loading");
  const [syncMessage, setSyncMessage] = useState("Подключаем Telegram-профиль…");
  const automaticRefreshStarted = useRef(false);
  const telegramInitData = useRef("");

  useEffect(() => {
    const saved = window.localStorage.getItem("pricepulse-products");
    if (saved) {
      try {
        setProducts((JSON.parse(saved) as Product[]).map(normalizeProduct));
      } catch {
        window.localStorage.removeItem("pricepulse-products");
      }
    }
    const savedCollections = window.localStorage.getItem("pricepulse-collections");
    if (savedCollections) {
      try {
        setCollections(JSON.parse(savedCollections) as Collection[]);
      } catch {
        window.localStorage.removeItem("pricepulse-collections");
      }
    }
    const savedPalette = window.localStorage.getItem("pricepulse-palette");
    if (savedPalette) {
      try {
        setPalette(JSON.parse(savedPalette) as Palette);
      } catch {
        window.localStorage.removeItem("pricepulse-palette");
      }
    }
    const sharedCode = window.location.hash.match(/collection=([^&]+)/)?.[1];
    if (sharedCode) {
      try {
        const payload = JSON.parse(decodeURIComponent(window.atob(sharedCode))) as { collection: Collection; products: Product[] };
        setProducts((current) => [...current, ...payload.products.map(normalizeProduct).filter((incoming) => !current.some((item) => item.id === incoming.id))]);
        setCollections((current) => current.some((item) => item.id === payload.collection.id) ? current : [payload.collection, ...current]);
        setActiveNav("Подборки");
        setToast(`Подборка «${payload.collection.name}» добавлена`);
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        setToast("Не удалось открыть ссылку на подборку");
      }
    }

    const telegram = (window as TelegramWindow).Telegram?.WebApp;
    telegram?.ready?.();
    telegram?.expand?.();
    const initData = telegram?.initData?.trim() ?? "";
    telegramInitData.current = initData;
    setLoaded(true);

    if (!initData) {
      setSyncStatus("local");
      setSyncMessage("Откройте приложение через @price_pulce_bot для облачной памяти");
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
        setProfile(body.profile);
        if (body.state) {
          setProducts(body.state.products.map(normalizeProduct));
          setCollections(body.state.collections);
          if (body.state.palette?.accent) setPalette(body.state.palette);
        }
        setRemoteReady(true);
        setSyncStatus("synced");
        setSyncMessage("Товары и подборки сохранены в облачном профиле");
      } catch (error) {
        setSyncStatus("error");
        setSyncMessage(error instanceof Error ? error.message : "Не удалось подключить облачную память");
      } finally {
        setCatalogReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (loaded) window.localStorage.setItem("pricepulse-products", JSON.stringify(products));
  }, [products, loaded]);

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
    if (!loaded) return;
    window.localStorage.setItem("pricepulse-collections", JSON.stringify(collections));
    window.localStorage.setItem("pricepulse-palette", JSON.stringify(palette));
  }, [collections, palette, loaded]);

  useEffect(() => {
    if (!loaded || !remoteReady || !telegramInitData.current) return;
    setSyncStatus("saving");
    setSyncMessage("Сохраняем изменения…");
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/profile", {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "x-telegram-init-data": telegramInitData.current,
            },
            body: JSON.stringify({ products, collections, palette }),
          });
          const body = await response.json() as { error?: string };
          if (!response.ok) throw new Error(body.error || "Не удалось сохранить профиль");
          setSyncStatus("synced");
          setSyncMessage("Все изменения сохранены в Telegram-профиле");
        } catch (error) {
          setSyncStatus("error");
          setSyncMessage(error instanceof Error ? error.message : "Не удалось сохранить изменения");
        }
      })();
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [products, collections, palette, loaded, remoteReady]);

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

  const totalValue = products.reduce((sum, product) => sum + product.price, 0);
  const favoriteCount = products.filter((product) => product.favorite).length;
  const displayName = profile?.firstName || "друг";
  const avatarLetter = displayName.slice(0, 1).toLocaleUpperCase("ru");
  const themeStyle = {
    "--paper": palette.paper,
    "--ink": palette.ink,
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
          <button className="icon-button notification" aria-label="Уведомления" onClick={() => setToast("Новых уведомлений пока нет")}>
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
        <DiscoveryView />
      ) : activeNav === "Профиль" ? (
        <ProfileView products={products} palette={palette} profile={profile} syncStatus={syncStatus} syncMessage={syncMessage} onTheme={() => setThemeOpen(true)} />
      ) : activeNav === "Подборки" ? (
        <CollectionsView collections={collections} products={products} onShare={shareCollection} onCreate={() => setCollectionOpen(true)} />
      ) : (
        <>
          <section className="welcome-row">
            <div>
              <p className="eyebrow">ДОБРЫЙ ВЕЧЕР, {displayName.toLocaleUpperCase("ru")}</p>
              <h1>{activeNav === "Избранное" ? "Избранные товары" : "Следи за ценой. Покупай вовремя."}</h1>
            </div>
            <button className="text-link" onClick={() => setToast("Все цены обновляются по заданному расписанию")}>Как это работает <span>↗</span></button>
          </section>

          <section className="summary-card">
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
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-dot dot-one" />
            <div className="hero-dot dot-two" />
          </section>

          <section className="catalog-section">
            <div className="section-heading">
              <div>
                <h2>{activeNav === "Избранное" ? "Сохранённое" : "Мои товары"}</h2>
                <p>{visibleProducts.length} {visibleProducts.length === 1 ? "товар" : "товара"} · цены в рублях</p>
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
          ["Главная", "⌂"],
          ["Подборки", "▦"],
          ["Добавить", "+"],
          ["ИИ-поиск", "✦"],
          ["Избранное", "♡"],
        ].map(([item, icon]) => (
          <button key={item} className={`${activeNav === item ? "current" : ""} ${item === "Добавить" ? "nav-add" : ""}`} onClick={() => changeNav(item)} aria-label={item}>
            <span>{icon}</span><small>{item}</small>
          </button>
        ))}
      </nav>

      {addOpen && <AddProductModal onClose={() => setAddOpen(false)} onAdd={addProduct} categories={categories.filter((item) => item !== "Все")} />}
      {themeOpen && <ThemeModal palette={palette} onApply={(next) => { setPalette(next); setThemeOpen(false); setToast(`Палитра «${next.name}» включена`); }} onClose={() => setThemeOpen(false)} />}
      {collectionOpen && <CollectionModal products={products} onClose={() => setCollectionOpen(false)} onCreate={(collection) => { setCollections((current) => [collection, ...current]); setCollectionOpen(false); setToast("Подборка создана — теперь ей можно делиться"); }} />}
      {selected && (
        <ProductDetails
          product={products.find((product) => product.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onFavorite={toggleFavorite}
          onCheck={checkPrice}
          onAddOffer={addOffer}
          onDelete={deleteProduct}
          onPeriod={(id, period) => {
            setProducts((current) => current.map((product) => product.id === id ? { ...product, period, nextCheck: `через ${period} ч` } : product));
            setSelected((current) => current ? { ...current, period } : current);
            setToast(`Проверка настроена каждые ${period} ч`);
          }}
        />
      )}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function ProductCard({ product, onFavorite, onDelete, onOpen }: { product: Product; onFavorite: (id: number) => void; onDelete: (id: number) => void; onOpen: (product: Product) => void }) {
  const forecast = forecastFor(product);
  return (
    <article className="product-card" role="button" tabIndex={0} onClick={() => onOpen(product)} onKeyDown={(event) => event.key === "Enter" && onOpen(product)}>
      <div className={`product-art ${product.artClass}`}>
        <span>{product.art}</span>
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
        <div className={`prediction-row ${forecast.tone}`}><span>✦ {forecast.label}</span><small>{forecast.confidence}%</small></div>
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
  const [target, setTarget] = useState("");
  const [manualPrice, setManualPrice] = useState("");
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
    if (!isLis && (!Number.isFinite(enteredPrice) || enteredPrice <= 0)) {
      setError("Для этого магазина укажите текущую цену вручную");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const resolved = isLis ? await resolveLisProduct(parsedUrl.href) : null;
      const pathName = decodeURIComponent(parsedUrl.pathname).split("/").filter(Boolean).pop() ?? "Новый товар";
      const inferredName = pathName.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 60);
      const currentPrice = resolved?.priceRub ?? enteredPrice;
      const now = Date.now();
      const source = resolved?.source ?? parsedUrl.hostname.replace(/^www\./, "").toUpperCase();
      const productUrl = resolved?.url ?? parsedUrl.href;
      onAdd({
        id: now,
        name: resolved?.name ?? inferredName,
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
        target: target ? Number(target) : undefined,
        offers: [{
          id: `${now}-${parsedUrl.hostname}`,
          store: source,
          price: currentPrice,
          url: productUrl,
          note: resolved ? `Официальный каталог · ${resolved.count} ${resolved.count === 1 ? "предложение" : "предложения"}` : "Цена указана вручную",
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
          <div className="url-field"><span>↗</span><input id="product-url" type="url" value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} placeholder="https://lis-skins.com/market/..." /></div>
          <p className="field-hint">LIS-SKINS распознаётся автоматически по официальному каталогу</p>

          {!lisUrlEntered && url && (
            <div className="manual-price-field">
              <label className="field-label" htmlFor="manual-price">Текущая цена</label>
              <div className="price-input"><input id="manual-price" inputMode="decimal" value={manualPrice} onChange={(event) => setManualPrice(event.target.value.replace(/[^\d,.\s]/g, ""))} placeholder="Например, 4 500" /><span>₽</span></div>
              <p className="field-hint">Для других магазинов цена пока указывается вручную</p>
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
            <div>
              <label className="field-label" htmlFor="target-price">Цена для уведомления</label>
              <div className="price-input"><input id="target-price" min="1" inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value.replace(/\D/g, ""))} placeholder="Например, 4 500" /><span>₽</span></div>
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
          <div className="custom-period">
            <span>Свой период</span>
            <input min="1" type="number" value={customPeriod} onChange={(event) => setCustomPeriod(event.target.value)} placeholder="—" aria-label="Свой период в часах" />
            <span>часов</span>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="smart-note"><span>✦</span><p><b>Умные уведомления</b><br />Сообщим в Telegram, когда цена достигнет цели или резко снизится.</p></div>
          <button className="primary-button" type="submit" disabled={loading}>{loading ? "Получаем актуальную цену…" : "Начать мониторинг"} <span>→</span></button>
        </form>
      </section>
    </div>
  );
}
function ProductDetails({ product, onClose, onFavorite, onCheck, onPeriod, onAddOffer, onDelete }: { product: Product; onClose: () => void; onFavorite: (id: number) => void; onCheck: (id: number) => void; onPeriod: (id: number, period: number) => void; onAddOffer: (id: number, url: string) => void; onDelete: (id: number) => void }) {
  const [offerInputOpen, setOfferInputOpen] = useState(false);
  const [offerUrl, setOfferUrl] = useState("");
  const forecast = forecastFor(product);
  const offers = [...(product.offers ?? [])].sort((a, b) => a.price - b.price);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal details-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="details-head">
          <div className={`detail-art ${product.artClass}`}>{product.art}</div>
          <div><p>{product.source} · {product.category}</p><h2 id="detail-title">{product.name}</h2></div>
          <button className={`heart detail-heart ${product.favorite ? "liked" : ""}`} onClick={() => onFavorite(product.id)} aria-label="Избранное">{product.favorite ? "♥" : "♡"}</button>
        </div>
        <div className="detail-price"><div><span>Текущая цена</span><strong>{formatPrice(product.price)}</strong></div><span className={`trend ${product.change <= 0 ? "down" : "up"}`}>{product.change <= 0 ? "↓" : "↑"} {Math.abs(product.change)}%</span></div>
        <div className="chart-card">
          <div className="chart-labels"><span>7 дней</span><b>{product.change <= 0 ? "−264 ₽" : "+232 ₽"}</b></div>
          <div className="bar-chart" aria-label="График изменения цены за 7 дней">
            {chartValues.map((value, index) => <i key={index} style={{ height: `${value + 18}%` }} />)}
          </div>
        </div>
        <div className={`forecast-card ${forecast.tone}`}>
          <span className="forecast-icon">✦</span>
          <div><small>ПРОГНОЗ · ТОЧНОСТЬ {forecast.confidence}%</small><b>{forecast.label}</b><p>{forecast.text}</p></div>
          <span className="forecast-arrow">→</span>
        </div>
        <div className="target-row"><span>Целевая цена</span><b>{product.target ? formatPrice(product.target) : "Не задана"}</b></div>

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

function CollectionsView({ collections, products, onShare, onCreate }: { collections: Collection[]; products: Product[]; onShare: (collection: Collection) => void; onCreate: () => void }) {
  return (
    <section className="collections-view">
      <div className="collections-title">
        <div><p className="eyebrow">ЦЕНЫ, КОТОРЫМИ МОЖНО ДЕЛИТЬСЯ</p><h1>Мои подборки</h1></div>
        <button className="outline-add collection-add" onClick={onCreate}><span>＋</span> Новая подборка</button>
      </div>
      <div className="collections-hero">
        <div><span>⇧</span><h2>Соберите товары вместе</h2><p>Отправьте одну ссылку — друг получит всю подборку с ценами и настройками мониторинга.</p></div>
        <div className="shared-demo"><span>pricepulse.app</span><b>/collection/your-list</b><i>↗</i></div>
      </div>
      <div className="collection-grid">
        {collections.map((collection, collectionIndex) => {
          const items = products.filter((product) => collection.productIds.includes(product.id));
          const total = items.reduce((sum, item) => sum + item.price, 0);
          return (
            <article className="collection-card" key={collection.id}>
              <div className={`collection-cover cover-${collectionIndex % 3}`}>
                <div className="collection-stack">
                  {items.slice(0, 3).map((item) => <span key={item.id} className={item.artClass}>{item.art}</span>)}
                </div>
                <button onClick={() => onShare(collection)} aria-label={`Поделиться подборкой ${collection.name}`}>↗</button>
              </div>
              <div className="collection-body"><p>{items.length} товара · {formatPrice(total)}</p><h3>{collection.name}</h3><button onClick={() => onShare(collection)}>Поделиться ссылкой <span>→</span></button></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CollectionModal({ products, onClose, onCreate }: { products: Product[]; onClose: () => void; onCreate: (collection: Collection) => void }) {
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
  const previewStyle = { "--preview-paper": selected.paper, "--preview-ink": selected.ink, "--preview-card": selected.card, "--preview-accent": selected.accent, "--preview-accent-2": selected.accent2, "--preview-accent-3": selected.accent3 } as CSSProperties;
  const updateCustom = (key: keyof Pick<Palette, "paper" | "ink" | "card" | "accent" | "accent2" | "accent3">, value: string) => setSelected((current) => ({ ...current, id: "custom", name: "Моя палитра", [key]: value }));
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

function DiscoveryView() {
  const [query, setQuery] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingQuery, setPendingQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [results, setResults] = useState<DiscoveryProduct[]>([]);
  const [selected, setSelected] = useState<DiscoveryProduct | null>(null);
  const prompts = ["Наушники до 20 000 ₽", "Робот-пылесос", "Телефон до 50 000 ₽", "Популярные скины CS2"];
  const consentStorageKey = "pricepulse-external-search-consent";

  useEffect(() => {
    setConsent(window.localStorage.getItem(consentStorageKey) === "true");
  }, []);

  async function searchProducts(value = query, consentGranted = consent) {
    const finalQuery = value.trim();
    if (finalQuery.length < 2) { setError("Опишите, какой товар хотите найти"); return; }
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (!consentGranted) {
      setQuery(finalQuery);
      setPendingQuery(finalQuery);
      setConsentOpen(true);
      setError("");
      return;
    }
    setQuery(finalQuery); setLoading(true); setError("");
    try {
      const response = await fetch("/api/discover", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: finalQuery, externalSearchConsent: true }),
      });
      const body = await response.json() as DiscoveryResponse;
      if (!response.ok) throw new Error(body.error || "Не удалось выполнить поиск");
      setResults(body.products); setSummary(body.summary);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Не удалось выполнить поиск");
    } finally { setLoading(false); }
  }

  function approveExternalSearch() {
    const queuedQuery = pendingQuery || query.trim();
    setConsent(true);
    window.localStorage.setItem(consentStorageKey, "true");
    setConsentOpen(false);
    setPendingQuery("");
    void searchProducts(queuedQuery, true);
  }

  return (
    <section className="discovery-view">
      <div className="discovery-hero">
        <div className="ai-orb">✦</div>
        <p className="eyebrow">AI-ПОИСК ПО ТОВАРАМ И ОТЗЫВАМ</p>
        <h1>Найдём популярное и сравним источники.</h1>
        <p className="discovery-lead">Опишите товар, бюджет или задачу. Умный поиск соберёт варианты, отзывы и прямые ссылки на магазины.</p>
        <form className="discovery-search" onSubmit={(event) => { event.preventDefault(); void searchProducts(); }}>
          <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setError(""); }} placeholder="Например: беспроводные наушники до 20 000 ₽" aria-label="Запрос для AI-поиска" />
          <button type="submit" disabled={loading}>{loading ? "Ищем…" : "Найти"} <span>→</span></button>
        </form>
        <p className="search-privacy-note"><span>✓</span> Первый поиск попросит разрешение передать только текст запроса. Выбор сохранится на этом устройстве.</p>
        <div className="prompt-chips">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => { setQuery(prompt); void searchProducts(prompt); }}>{prompt}</button>)}</div>
        {error && <p className="discovery-error" role="alert">{error}</p>}
      </div>

      {consentOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setConsentOpen(false)}>
          <section className="modal search-consent-modal" role="dialog" aria-modal="true" aria-labelledby="search-consent-title">
            <div className="modal-handle" />
            <button className="modal-close" onClick={() => setConsentOpen(false)} aria-label="Закрыть">×</button>
            <div className="modal-kicker"><span>✦</span> РАЗРЕШЕНИЕ НА AI-ПОИСК</div>
            <h2 id="search-consent-title">Разрешить поиск по интернету?</h2>
            <p className="modal-lead">Чтобы найти товары, PricePulse передаст только текст запроса сервисам Jina AI, Google и OpenRouter, если он подключён.</p>
            <div className="consent-points">
              <p><span>✓</span><b>Отправится:</b> запрос «{pendingQuery || query}»</p>
              <p><span>×</span><b>Не отправятся:</b> профиль Telegram, карточки и избранное</p>
            </div>
            <p className="consent-memory">Разрешение сохранится на этом устройстве. Его можно сбросить, очистив данные мини-приложения.</p>
            <div className="consent-actions">
              <button type="button" className="primary-button" onClick={approveExternalSearch}>Разрешить и найти <span>→</span></button>
              <button type="button" className="secondary-button" onClick={() => { setConsentOpen(false); setPendingQuery(""); }}>Отмена</button>
            </div>
          </section>
        </div>
      )}

      <div className="discovery-results-head">
        <div><h2>{results.length ? "AI-подборка" : "Начните с запроса"}</h2><p>{summary || "Карточки появятся здесь — нажмите на любую, чтобы увидеть несколько источников."}</p></div>
        {results.length > 0 && <span>{results.length} вариантов</span>}
      </div>
      {loading ? (
        <div className="discovery-loading"><span>✦</span><p>Сопоставляем популярность, отзывы и цены…</p></div>
      ) : results.length > 0 ? (
        <div className="discovery-grid">
          {results.map((item, index) => (
            <button className="discovery-card" key={item.id} onClick={() => setSelected(item)}>
              <div className={`discovery-art art-${index % 3}`}><span>{item.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</span><i>✦ AI</i></div>
              <div className="discovery-card-body">
                <span className="popularity-badge">{item.popularity}</span>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <div className="discovery-meta"><b>{item.priceLabel}</b><span>★ {item.ratingLabel}</span></div>
                <div className="discovery-open"><span>{item.sourceCount} источника</span><b>Сравнить →</b></div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="discovery-empty"><span>⌕</span><h3>Что хотите подобрать?</h3><p>Можно написать категорию, бюджет, бренд или задачу.</p></div>
      )}

      {selected && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <section className="modal discovery-modal" role="dialog" aria-modal="true" aria-labelledby="discovery-title">
            <div className="modal-handle" /><button className="modal-close" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            <div className="modal-kicker"><span>✦</span> ИСТОЧНИКИ AI-ПОДБОРКИ</div>
            <h2 id="discovery-title">{selected.name}</h2>
            <p className="modal-lead">{selected.description}</p>
            <div className="source-list">
              {selected.sources.map((source, index) => (
                <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                  <span>{index + 1}</span><div><small>{source.kind}</small><b>{source.title}</b></div><i>↗</i>
                </a>
              ))}
            </div>
            <p className="source-note">Цены и наличие меняются. Проверяйте итоговую стоимость на странице магазина.</p>
          </section>
        </div>
      )}
    </section>
  );
}
function ProfileView({
  products,
  palette,
  profile,
  syncStatus,
  syncMessage,
  onTheme,
}: {
  products: Product[];
  palette: Palette;
  profile: TelegramProfile | null;
  syncStatus: ProfileSyncStatus;
  syncMessage: string;
  onTheme: () => void;
}) {
  const name = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") : "Локальный профиль";
  const handle = profile?.username ? `@${profile.username}` : profile ? "Вход через Telegram" : "Без облачной синхронизации";
  const syncLabel = syncStatus === "synced"
    ? "Сохранено"
    : syncStatus === "saving"
      ? "Сохраняем…"
      : syncStatus === "loading"
        ? "Подключаем…"
        : syncStatus === "error"
          ? "Нужна настройка"
          : "Только на устройстве";

  return (
    <section className="profile-view">
      <div className="profile-card">
        <div className="profile-avatar">{name.slice(0, 1).toLocaleUpperCase("ru")}</div>
        <div><p>{profile ? "Telegram-профиль" : "Локальный режим"}</p><h1>{name}</h1><span>{handle}</span></div>
        <span className={`profile-sync-badge ${syncStatus}`}>{syncLabel}</span>
      </div>
      <p className={`profile-sync-note ${syncStatus}`}>{syncMessage}</p>
      <div className="settings-card">
        <h2>Мониторинг</h2>
        <div className="setting-row"><span>Активных товаров</span><b>{products.length}</b></div>
        <div className="setting-row"><span>Память профиля</span><b className={syncStatus === "synced" ? "status-on" : "status-warn"}>{syncLabel}</b></div>
        <div className="setting-row"><span>Авторизация</span><b>{profile ? "Telegram · без e-mail" : "Откройте через бота"}</b></div>
        <div className="setting-row"><span>Валюта</span><b>RUB</b></div>
        <button className="setting-row theme-setting" onClick={onTheme}><span>Цветовая палитра</span><b><i style={{ background: palette.accent }} /><i style={{ background: palette.accent2 }} /><i style={{ background: palette.accent3 }} /> {palette.name} →</b></button>
      </div>
      <div className="settings-card">
        <h2>Новые возможности</h2>
        <div className="idea-row enabled"><span>↯</span><p><b>Сравнение магазинов</b><small>Добавляйте предложения прямо в карточке</small></p><i>✓</i></div>
        <div className="idea-row enabled"><span>↘</span><p><b>Прогноз выгодной цены</b><small>Рекомендация на основе истории и тренда</small></p><i>✓</i></div>
        <div className="idea-row enabled"><span>⇧</span><p><b>Общие подборки</b><small>Сохраняются отдельно в каждом Telegram-профиле</small></p><i>✓</i></div>
        <div className="idea-row enabled"><span>✦</span><p><b>OpenRouter-ready</b><small>Автоматически включится после добавления серверного API-ключа</small></p><i>✓</i></div>
      </div>
    </section>
  );
}

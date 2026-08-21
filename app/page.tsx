"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
};

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: {
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
  },
];

const formatPrice = (value: number) =>
  new Intl.NumberFormat("ru-RU").format(value) + " ₽";

const chartValues = [56, 48, 52, 37, 43, 29, 22, 30, 18, 12];

function haptic(style: "light" | "medium" = "light") {
  const telegram = (window as TelegramWindow).Telegram?.WebApp;
  telegram?.HapticFeedback?.impactOccurred(style);
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [activeCategory, setActiveCategory] = useState("Все");
  const [activeNav, setActiveNav] = useState("Главная");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [toast, setToast] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("pricepulse-products");
    if (saved) {
      try {
        setProducts(JSON.parse(saved) as Product[]);
      } catch {
        window.localStorage.removeItem("pricepulse-products");
      }
    }
    const telegram = (window as TelegramWindow).Telegram?.WebApp;
    telegram?.ready?.();
    telegram?.expand?.();
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) window.localStorage.setItem("pricepulse-products", JSON.stringify(products));
  }, [products, loaded]);

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
  }

  function addProduct(product: Product) {
    setProducts((current) => [product, ...current]);
    setActiveNav("Главная");
    setActiveCategory("Все");
    setAddOpen(false);
    setToast("Товар добавлен. Первый чек — через 2 минуты");
    haptic("medium");
  }

  function checkPrice(id: number) {
    setProducts((current) =>
      current.map((product) =>
        product.id === id ? { ...product, nextCheck: `через ${product.period} ч` } : product,
      ),
    );
    setToast("Цена актуальна — проверено только что");
    haptic("medium");
  }

  return (
    <main className="app-shell">
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
          <button className="icon-button notification" aria-label="Уведомления" onClick={() => setToast("Новых уведомлений пока нет")}>
            ♢<span />
          </button>
          <button className="avatar" aria-label="Профиль Артёма" onClick={() => changeNav("Профиль")}>А</button>
        </div>
      </header>

      {searchOpen && (
        <div className="search-row">
          <span>⌕</span>
          <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, магазин или категория" aria-label="Поиск товаров" />
          {search && <button onClick={() => setSearch("")} aria-label="Очистить поиск">×</button>}
        </div>
      )}

      {activeNav === "Профиль" ? (
        <ProfileView products={products} />
      ) : (
        <>
          <section className="welcome-row">
            <div>
              <p className="eyebrow">ДОБРЫЙ ВЕЧЕР, АРТЁМ</p>
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
                  <ProductCard key={product.id} product={product} onFavorite={toggleFavorite} onOpen={setSelected} />
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
          ["Каталог", "▦"],
          ["Добавить", "+"],
          ["Избранное", "♡"],
          ["Профиль", "○"],
        ].map(([item, icon]) => (
          <button key={item} className={`${activeNav === item ? "current" : ""} ${item === "Добавить" ? "nav-add" : ""}`} onClick={() => changeNav(item)} aria-label={item}>
            <span>{icon}</span><small>{item}</small>
          </button>
        ))}
      </nav>

      {addOpen && <AddProductModal onClose={() => setAddOpen(false)} onAdd={addProduct} categories={categories.filter((item) => item !== "Все")} />}
      {selected && (
        <ProductDetails
          product={products.find((product) => product.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onFavorite={toggleFavorite}
          onCheck={checkPrice}
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

function ProductCard({ product, onFavorite, onOpen }: { product: Product; onFavorite: (id: number) => void; onOpen: (product: Product) => void }) {
  return (
    <article className="product-card" role="button" tabIndex={0} onClick={() => onOpen(product)} onKeyDown={(event) => event.key === "Enter" && onOpen(product)}>
      <div className={`product-art ${product.artClass}`}>
        <span>{product.art}</span>
        <div className="art-grid" />
        <div className="source-badge">{product.source}</div>
        <button className={`heart ${product.favorite ? "liked" : ""}`} aria-label={product.favorite ? "Убрать из избранного" : "Добавить в избранное"} onClick={(event) => { event.stopPropagation(); onFavorite(product.id); }}>
          {product.favorite ? "♥" : "♡"}
        </button>
      </div>
      <div className="product-body">
        <div className="product-title-row">
          <div><p>{product.category}</p><h3>{product.name}</h3></div>
          <span className={`trend ${product.change < 0 ? "down" : product.change > 0 ? "up" : "flat"}`}>
            {product.change < 0 ? "↓" : product.change > 0 ? "↑" : "—"} {Math.abs(product.change).toLocaleString("ru-RU")}%
          </span>
        </div>
        <div className="price-row"><strong>{formatPrice(product.price)}</strong><s>{product.change !== 0 ? formatPrice(product.oldPrice) : ""}</s></div>
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
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
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
    const pathName = decodeURIComponent(parsedUrl.pathname).split("/").filter(Boolean).pop() ?? "Новый товар";
    const inferredName = pathName.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 44);
    const isLis = parsedUrl.hostname.includes("lis-skins");
    onAdd({
      id: Date.now(),
      name: isLis ? inferredName.replace(/Field Tested/i, "(Field-Tested)") : inferredName,
      source: isLis ? "LIS-SKINS" : parsedUrl.hostname.replace(/^www\./, "").toUpperCase(),
      url,
      category: customCategory.trim() || category,
      price: 1790,
      oldPrice: 1790,
      change: 0,
      period: finalPeriod,
      nextCheck: "первый чек через 2 мин",
      art: isLis ? "CS" : "+",
      artClass: isLis ? "violet" : "blue",
      favorite: false,
      target: target ? Number(target) : undefined,
    });
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
          <p className="field-hint">Поддерживаем LIS-SKINS и ссылки на любые магазины</p>

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
          <button className="primary-button" type="submit">Начать мониторинг <span>→</span></button>
        </form>
      </section>
    </div>
  );
}

function ProductDetails({ product, onClose, onFavorite, onCheck, onPeriod }: { product: Product; onClose: () => void; onFavorite: (id: number) => void; onCheck: (id: number) => void; onPeriod: (id: number, period: number) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal details-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="details-head">
          <div className={`detail-art ${product.artClass}`}>{product.art}</div>
          <div><p>{product.source} · {product.category}</p><h2 id="detail-title">{product.name}</h2></div>
          <button className={`heart detail-heart ${product.favorite ? "liked" : ""}`} onClick={() => onFavorite(product.id)}>{product.favorite ? "♥" : "♡"}</button>
        </div>
        <div className="detail-price"><div><span>Текущая цена</span><strong>{formatPrice(product.price)}</strong></div><span className={`trend ${product.change <= 0 ? "down" : "up"}`}>{product.change <= 0 ? "↓" : "↑"} {Math.abs(product.change)}%</span></div>
        <div className="chart-card">
          <div className="chart-labels"><span>7 дней</span><b>−264 ₽</b></div>
          <div className="bar-chart" aria-label="График изменения цены за 7 дней">
            {chartValues.map((value, index) => <i key={index} style={{ height: `${value + 18}%` }} />)}
          </div>
        </div>
        <div className="target-row"><span>Целевая цена</span><b>{product.target ? formatPrice(product.target) : "Не задана"}</b></div>
        <span className="field-label frequency-label">Проверять цену</span>
        <div className="frequency-grid details-frequency">
          {[1, 3, 6, 12, 24].map((hours) => <button key={hours} className={product.period === hours ? "picked" : ""} onClick={() => onPeriod(product.id, hours)}>{hours === 24 ? "1 день" : `${hours} ч`}</button>)}
        </div>
        <div className="detail-actions">
          <button className="secondary-button" onClick={() => window.open(product.url, "_blank", "noopener,noreferrer")}>Открыть магазин ↗</button>
          <button className="primary-button" onClick={() => onCheck(product.id)}>Проверить сейчас</button>
        </div>
      </section>
    </div>
  );
}

function ProfileView({ products }: { products: Product[] }) {
  return (
    <section className="profile-view">
      <div className="profile-card">
        <div className="profile-avatar">А</div>
        <div><p>Telegram-профиль</p><h1>Артём</h1><span>@artem</span></div>
      </div>
      <div className="settings-card">
        <h2>Мониторинг</h2>
        <div className="setting-row"><span>Активных товаров</span><b>{products.length}</b></div>
        <div className="setting-row"><span>Уведомления в Telegram</span><b className="status-on">Включены</b></div>
        <div className="setting-row"><span>Валюта</span><b>RUB</b></div>
      </div>
      <div className="settings-card">
        <h2>Идеи для следующей версии</h2>
        <div className="idea-row"><span>↯</span><p><b>Сравнение магазинов</b><small>Один товар — несколько источников цены</small></p></div>
        <div className="idea-row"><span>↘</span><p><b>Прогноз выгодной цены</b><small>Подсказка, покупать сейчас или подождать</small></p></div>
        <div className="idea-row"><span>⇧</span><p><b>Общие подборки</b><small>Делиться категориями с друзьями</small></p></div>
      </div>
    </section>
  );
}

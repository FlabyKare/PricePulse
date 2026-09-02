"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ProductContext = {
  id: number;
  name: string;
  category: string;
  source: string;
  price: number;
  oldPrice: number;
  change: number;
  target?: number;
  offers?: Array<{ store: string; price: number; url: string }>;
};

type DiscoverySource = { title: string; url: string; kind: "магазин" | "обзор"; priceLabel?: string; ratingLabel?: string; verified: true };
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
type DiscoveryResponse = { summary: string; products: DiscoveryProduct[]; engine?: string; checkedAt?: string; error?: string };
type AssistantSource = { title: string; url: string; description: string };
type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; sources?: AssistantSource[] };
type AssistantResponse = { answer?: string; mode?: string; sources?: AssistantSource[]; followUps?: string[]; error?: string };

type InvestmentSource = { title: string; url: string; description: string; publisher: string };
type Cs2InvestmentIdea = {
  id: string;
  name: string;
  itemType: "Скин" | "Наклейка" | "Кейс / капсула";
  priceUsd: number;
  priceLabel: string;
  lisOffers: number;
  momentum30d: number | null;
  historyPoints: number;
  potentialScore: number;
  scoreLabel: string;
  horizon: string;
  confidence: string;
  risk: "высокий" | "очень высокий";
  reasons: string[];
  catalysts: string[];
  sourceUrls: string[];
  itemUrl: string;
};
type InvestmentsResponse = {
  updatedAt: string;
  mode: string;
  methodology: string;
  disclaimer: string;
  ideas: Cs2InvestmentIdea[];
  sources: InvestmentSource[];
  error?: string;
};

const consentStorageKey = "pricepulse-external-search-consent";


function fallbackInvestments(): InvestmentsResponse {
  const sources: InvestmentSource[] = [
    { title: "Новости Counter-Strike", url: "https://www.counter-strike.net/news", description: "Официальные обновления игры и турниров.", publisher: "Counter-Strike" },
    { title: "Торговая площадка Steam", url: "https://steamcommunity.com/market/search?appid=730", description: "Проверка спроса, предложений и истории цен.", publisher: "Steam Market" },
    { title: "Каталог CS2", url: "https://lis-skins.com/market/csgo/", description: "Текущие цены и предложения предметов.", publisher: "LIS-SKINS" },
  ];
  const steam = (name: string) => `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
  const candidates: Array<Pick<Cs2InvestmentIdea, "name" | "itemType" | "potentialScore" | "scoreLabel" | "horizon" | "reasons" | "catalysts">> = [
    {
      name: "Sticker | Natus Vincere (Holo) | Stockholm 2021",
      itemType: "Наклейка",
      potentialScore: 68,
      scoreLabel: "Кандидат в наблюдение",
      horizon: "6–18 месяцев",
      reasons: ["Турнирная наклейка с ограниченным выпуском", "Популярная команда и Holo-эффект"],
      catalysts: ["Рост интереса к старым турнирным коллекциям", "Сокращение доступного предложения"],
    },
    {
      name: "Stockholm 2021 Legends Sticker Capsule",
      itemType: "Кейс / капсула",
      potentialScore: 65,
      scoreLabel: "Следить за предложением",
      horizon: "12+ месяцев",
      reasons: ["Закрытая турнирная капсула", "Спрос связан с наклейками команд внутри"],
      catalysts: ["Уменьшение запаса капсул", "Рост цен на редкие вложения"],
    },
    {
      name: "AK-47 | Redline (Field-Tested)",
      itemType: "Скин",
      potentialScore: 61,
      scoreLabel: "Ликвидный ориентир",
      horizon: "3–12 месяцев",
      reasons: ["Узнаваемый скин на популярное оружие", "Обычно проще перепродать, чем нишевые предметы"],
      catalysts: ["Рост рынка CS2", "Спрос на крафты с наклейками"],
    },
    {
      name: "Recoil Case",
      itemType: "Кейс / капсула",
      potentialScore: 58,
      scoreLabel: "Спекулятивное наблюдение",
      horizon: "12+ месяцев",
      reasons: ["Дешёвый вход и понятный рыночный объём", "Потенциал зависит от изменения дропа"],
      catalysts: ["Переход в редкий пул", "Спрос на открытие кейсов"],
    },
  ];
  return {
    updatedAt: new Date().toISOString(),
    mode: "offline-cs2-watchlist",
    methodology: "Офлайн-список не содержит выдуманных цен. После восстановления соединения PricePulse подставит текущие цены LIS-SKINS, число предложений и собственную историю.",
    disclaimer: "Предметы CS2 волатильны, ликвидность и комиссии меняются. Оценка не гарантирует рост и не является командой к покупке.",
    sources,
    ideas: candidates.map((candidate, index) => ({
      id: `fallback-cs2-${index}`,
      ...candidate,
      priceUsd: 0,
      priceLabel: "Проверить цену",
      lisOffers: 0,
      momentum30d: null,
      historyPoints: 0,
      confidence: "нужна онлайн-проверка",
      risk: "очень высокий",
      sourceUrls: [steam(candidate.name), sources[2].url, sources[0].url],
      itemUrl: steam(candidate.name),
    })),
  };
}

export function SmartDiscoveryView({ products }: { products: ProductContext[] }) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"search" | "assistant">("search");
  const [query, setQuery] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [pendingAction, setPendingAction] = useState<"search" | "assistant">("search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [searchEngine, setSearchEngine] = useState("");
  const [results, setResults] = useState<DiscoveryProduct[]>([]);
  const [selected, setSelected] = useState<DiscoveryProduct | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(products[0]?.id ?? null);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [followUps, setFollowUps] = useState(["Стоит ли покупать сейчас?", "Сравни предложения", "Какие риски проверить?"]);
  const [messages, setMessages] = useState<AssistantMessage[]>([{
    id: "welcome",
    role: "assistant",
    content: "Выберите товар и задайте вопрос. Я учту цену, динамику и сохранённые предложения, а факты предложу проверить по публичным источникам.",
  }]);
  const prompts = ["Новый розовый Glock из коллекции CS2", "Наушники до 20 000 ₽", "Робот-пылесос", "Телефон до 50 000 ₽"];
  const selectedProduct = useMemo(() => products.find((product) => product.id === selectedProductId) ?? products[0] ?? null, [products, selectedProductId]);

  useEffect(() => { setConsent(window.localStorage.getItem(consentStorageKey) === "true"); }, []);
  useEffect(() => {
    if (selectedProductId === null && products[0]) setSelectedProductId(products[0].id);
  }, [products, selectedProductId]);

  function blurKeyboard() {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  async function searchProducts(value = query, consentGranted = consent) {
    const finalQuery = value.trim();
    if (finalQuery.length < 2) { setError("Опишите, какой товар хотите найти"); return; }
    blurKeyboard();
    if (!consentGranted) {
      setQuery(finalQuery); setPendingText(finalQuery); setPendingAction("search"); setConsentOpen(true); setError(""); return;
    }
    setQuery(finalQuery); setLoading(true); setError(""); setResults([]); setSummary(""); setSearchEngine(""); setSelected(null);
    try {
      const response = await fetch("/api/discover", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: finalQuery, externalSearchConsent: true }),
      });
      const body = await response.json() as DiscoveryResponse;
      if (!response.ok) throw new Error(body.error || "Не удалось выполнить поиск");
      if (!Array.isArray(body.products) || body.products.length === 0) throw new Error("Магазины не вернули подтверждённые карточки");
      setResults(body.products); setSummary(body.summary); setSearchEngine(body.engine ?? "live-market");
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Не удалось выполнить поиск");
    } finally { setLoading(false); }
  }

  async function askAssistant(value = assistantQuestion, consentGranted = consent) {
    const question = value.trim();
    if (question.length < 2) { setError("Напишите вопрос о товаре"); return; }
    blurKeyboard();
    if (!consentGranted) {
      setAssistantQuestion(question); setPendingText(question); setPendingAction("assistant"); setConsentOpen(true); setError(""); return;
    }
    const userMessage: AssistantMessage = { id: `user-${Date.now()}`, role: "user", content: question };
    setMessages((current) => [...current, userMessage]);
    setAssistantQuestion(""); setAssistantLoading(true); setError("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          product: selectedProduct,
          history: messages.filter((message) => message.id !== "welcome").map(({ role, content }) => ({ role, content })),
          externalSearchConsent: true,
        }),
      });
      const body = await response.json() as AssistantResponse;
      if (!response.ok || !body.answer) throw new Error(body.error || "Ассистент временно недоступен");
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: "assistant", content: body.answer!, sources: body.sources }]);
      if (body.followUps?.length) setFollowUps(body.followUps);
    } catch (assistantError) {
      setMessages((current) => [...current, { id: `assistant-error-${Date.now()}`, role: "assistant", content: assistantError instanceof Error ? assistantError.message : "Ассистент временно недоступен" }]);
    } finally { setAssistantLoading(false); }
  }

  function approveExternalAccess() {
    const queuedText = pendingText.trim();
    setConsent(true);
    window.localStorage.setItem(consentStorageKey, "true");
    setConsentOpen(false); setPendingText("");
    if (pendingAction === "assistant") void askAssistant(queuedText, true);
    else void searchProducts(queuedText, true);
  }

  return (
    <section className="discovery-view">
      <div className="ai-mode-switch" role="tablist" aria-label="Режим AI">
        <button role="tab" aria-selected={mode === "search"} className={mode === "search" ? "active" : ""} onClick={() => { setMode("search"); setError(""); }}>⌕ Поиск товаров</button>
        <button role="tab" aria-selected={mode === "assistant"} className={mode === "assistant" ? "active" : ""} onClick={() => { setMode("assistant"); setError(""); }}>✦ Ассистент</button>
      </div>

      {mode === "search" ? (
        <>
          <div className="discovery-hero">
            <div className="ai-orb">✦</div>
            <p className="eyebrow">УМНЫЙ ПОИСК ПО МАГАЗИНАМ</p>
            <h1>Изучим рынок и покажем реальные варианты.</h1>
            <p className="discovery-lead">Проверим живые карточки и покажем только основной товар с рейтингом от 4,5 и отзывами. Аксессуары исключаются, если вы не ищете их явно.</p>
            <form className="discovery-search" role="search" onSubmit={(event) => { event.preventDefault(); void searchProducts(); }}>
              <label className="discovery-query-field" htmlFor="discovery-query-input">
                <span className="sr-only">Что найти в интернете</span>
                <input ref={searchInputRef} id="discovery-query-input" name="query" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setError(""); }} placeholder="Например: новый розовый Glock из коллекции CS2" aria-describedby="discovery-search-help" />
              </label>
              <button type="submit" disabled={loading}>{loading ? "Ищем…" : "Найти"} <span>→</span></button>
            </form>
            <p className="search-privacy-note" id="discovery-search-help"><span>✓</span> Первый поиск попросит разрешение передать только текст запроса. Профиль и карточки не отправляются.</p>
            <div className="prompt-chips">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => { setQuery(prompt); void searchProducts(prompt); }}>{prompt}</button>)}</div>
            {error && <p className="discovery-error" role="alert">{error}</p>}
          </div>

          <div className="discovery-results-head">
            <div><h2>{results.length ? "Проверенная подборка" : "Начните с запроса"}</h2><p>{summary || "Покажем только найденные карточки товаров с прямыми ссылками — без подстановки запроса в страницы поиска."}</p></div>
            {results.length > 0 && <span>{results.length} вариантов · {searchEngine === "openrouter-live-market" ? "AI" : "LIVE"}</span>}
          </div>
          {loading ? (
            <div className="discovery-loading"><span>✦</span><p>Определяем категорию, проверяем профильные каталоги и отзывы…</p></div>
          ) : results.length > 0 ? (
            <div className="discovery-grid">
              {results.map((item, index) => (
                <button className="discovery-card" key={item.id} onClick={() => setSelected(item)}>
                  <div className={`discovery-art art-${index % 3}`}><span>{item.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</span><i>{searchEngine === "openrouter-live-market" ? "✦ AI" : "● LIVE"}</i></div>
                  <div className="discovery-card-body">
                    <span className="popularity-badge">{item.popularity}</span><h3>{item.name}</h3><p>{item.description}</p>
                    <div className="discovery-meta"><b>{item.priceLabel}</b><span>{item.ratingLabel}</span></div>
                    <div className="discovery-open"><span>{item.sourceCount} источников</span><b>Сравнить →</b></div>
                  </div>
                </button>
              ))}
            </div>
          ) : <div className="discovery-empty"><span>⌕</span><h3>Что хотите подобрать?</h3><p>Можно описать товар своими словами — даже без точного названия.</p></div>}
        </>
      ) : (
        <div className="assistant-layout">
          <section className="assistant-context">
            <p className="eyebrow">AI-КОНСУЛЬТАНТ ПО ПОКУПКЕ</p>
            <h1>Советуйтесь до того, как нажать «купить».</h1>
            <p>Ассистент учитывает карточку, динамику цены и предложения, а затем показывает источники для проверки.</p>
            <label>Товар для обсуждения</label>
            {products.length ? (
              <select value={selectedProduct?.id ?? ""} onChange={(event) => setSelectedProductId(Number(event.target.value))}>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            ) : <div className="assistant-no-product">Добавьте товар в мониторинг или опишите его прямо в вопросе.</div>}
            {selectedProduct && (
              <div className="assistant-product-stats">
                <span>Цена <b>{Math.round(selectedProduct.price).toLocaleString("ru-RU")} ₽</b></span>
                <span>Динамика <b className={selectedProduct.change <= 0 ? "good" : "bad"}>{selectedProduct.change > 0 ? "+" : ""}{selectedProduct.change}%</b></span>
                <span>Предложения <b>{selectedProduct.offers?.length ?? 1}</b></span>
              </div>
            )}
          </section>
          <section className="assistant-chat" aria-label="Диалог с AI-ассистентом">
            <div className="assistant-messages" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`assistant-message ${message.role}`}>
                  <small>{message.role === "assistant" ? "✦ PricePulse AI" : "Вы"}</small>
                  <p>{message.content}</p>
                  {!!message.sources?.length && <div className="assistant-sources">{message.sources.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">[{index + 1}] {source.title} ↗</a>)}</div>}
                </article>
              ))}
              {assistantLoading && <article className="assistant-message assistant typing"><small>✦ PricePulse AI</small><p>Сопоставляю цену, динамику и открытые источники…</p></article>}
            </div>
            <div className="assistant-followups">{followUps.map((prompt) => <button key={prompt} type="button" onClick={() => { setAssistantQuestion(prompt); void askAssistant(prompt); }}>{prompt}</button>)}</div>
            <form className="assistant-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void askAssistant(); }}>
              <textarea value={assistantQuestion} onChange={(event) => { setAssistantQuestion(event.target.value); setError(""); }} placeholder="Например: стоит ли покупать сейчас или подождать?" aria-label="Вопрос AI-ассистенту" rows={2} />
              <button type="submit" disabled={assistantLoading}>Спросить <span>→</span></button>
            </form>
            {error && <p className="assistant-error" role="alert">{error}</p>}
          </section>
        </div>
      )}

      {consentOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setConsentOpen(false)}>
          <section className="modal search-consent-modal" role="dialog" aria-modal="true" aria-labelledby="search-consent-title">
            <div className="modal-handle" /><button className="modal-close" onClick={() => setConsentOpen(false)} aria-label="Закрыть">×</button>
            <div className="modal-kicker"><span>✦</span> РАЗРЕШЕНИЕ НА AI</div>
            <h2 id="search-consent-title">Передать только текст запроса?</h2>
            <p className="modal-lead">PricePulse отправит текст сервисам поиска и OpenRouter, если он подключён. Данные Telegram, карточки и избранное не передаются.</p>
            <div className="consent-points"><p><span>✓</span><b>Отправится:</b> «{pendingText}»</p><p><span>×</span><b>Не отправятся:</b> профиль Telegram, карточки и избранное</p></div>
            <div className="consent-actions"><button type="button" className="primary-button" onClick={approveExternalAccess}>Разрешить и продолжить <span>→</span></button><button type="button" className="secondary-button" onClick={() => { setConsentOpen(false); setPendingText(""); }}>Отмена</button></div>
          </section>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <section className="modal discovery-modal" role="dialog" aria-modal="true" aria-labelledby="discovery-title">
            <div className="modal-handle" /><button className="modal-close" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            <div className="modal-kicker"><span>✦</span> ПРОФИЛЬНЫЕ ИСТОЧНИКИ</div><h2 id="discovery-title">{selected.name}</h2><p className="modal-lead">{selected.description}</p>
            <div className="source-list">{selected.sources.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span>{index + 1}</span><div><small>{source.kind} · прямая страница</small><b>{source.title}</b>{(source.priceLabel || source.ratingLabel) && <em>{[source.priceLabel, source.ratingLabel].filter(Boolean).join(" · ")}</em>}</div><i>↗</i></a>)}</div>
            <p className="source-note">Здесь только найденные прямые страницы товаров и обзоров, а не ссылки на поиск. Цена и наличие могут измениться — проверьте итог на сайте магазина.</p>
          </section>
        </div>
      )}
    </section>
  );
}

export function InvestmentsView() {
  const [data, setData] = useState<InvestmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"Все" | "Скины" | "Наклейки" | "Кейсы и капсулы">("Все");

  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/cs2-investments", { cache: "no-store" });
      const body = await response.json() as InvestmentsResponse;
      if (!response.ok) throw new Error(body.error || "Не удалось обновить CS2-радар");
      setData(body.ideas?.length ? body : fallbackInvestments());
    } catch {
      setData(fallbackInvestments());
      setError("Рынок сейчас не ответил — показываем офлайн-лист без выдуманных цен. Попробуйте обновить позже.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const visibleIdeas = useMemo(() => {
    const ideas = data?.ideas ?? [];
    if (filter === "Скины") return ideas.filter((idea) => idea.itemType === "Скин");
    if (filter === "Наклейки") return ideas.filter((idea) => idea.itemType === "Наклейка");
    if (filter === "Кейсы и капсулы") return ideas.filter((idea) => idea.itemType === "Кейс / капсула");
    return ideas;
  }, [data, filter]);

  function sourceLabel(url: string) {
    if (url.includes("lis-skins")) return "LIS-SKINS";
    if (url.includes("steamcommunity")) return "Steam Market";
    if (url.includes("counter-strike")) return "Новости CS2";
    return data?.sources.find((source) => source.url === url)?.publisher || "Источник";
  }

  return (
    <section className="investments-view">
      <div className="investments-hero cs2-investments-hero">
        <div>
          <p className="eyebrow">CS2 ИНВЕСТ-РАДАР</p>
          <h1>Конкретные предметы с потенциалом — и причины, почему.</h1>
          <p>PricePulse проверяет живые цены LIS-SKINS, доступное предложение и собственную историю. В списке — скины, наклейки и кейсы, а не абстрактные «рыночные темы».</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading}>{loading ? "Считаем…" : "Обновить радар"} <span>↻</span></button>
      </div>
      <div className="investment-warning"><span>!</span><p><b>Это оценка потенциала, не обещание роста.</b> Рынок предметов CS2 волатилен. Учитывайте комиссии, ликвидность, блокировку обмена и риск полной потери вложений.</p></div>
      {error && <p className="investment-error" role="alert">{error}</p>}
      {loading && !data ? <div className="investment-loading"><span>⌁</span><p>Сверяем каталог CS2, цены и накопленную историю…</p></div> : (
        <>
          <div className="investment-head">
            <div><h2>Кандидаты для наблюдения</h2><p>{data?.updatedAt ? `Обновлено ${new Date(data.updatedAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : ""}</p></div>
            <span>{visibleIdeas.length} предметов</span>
          </div>
          <div className="cs2-investment-filters" role="group" aria-label="Тип предмета">
            {(["Все", "Скины", "Наклейки", "Кейсы и капсулы"] as const).map((item) => <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}
          </div>
          <div className="investment-grid cs2-investment-grid">
            {visibleIdeas.map((idea, index) => (
              <article className="investment-card cs2-investment-card" key={idea.id}>
                <div className="investment-card-top"><span className={idea.risk === "очень высокий" ? "risk risk-very-high" : "risk risk-high"}>риск: {idea.risk}</span><i>{String(index + 1).padStart(2, "0")}</i></div>
                <small>{idea.itemType} · {idea.horizon}</small><h3>{idea.name}</h3>
                <div className="cs2-market-stats">
                  <div><small>Цена сейчас</small><b>{idea.priceLabel}</b></div>
                  <div><small>Предложений LIS</small><b>{idea.lisOffers || "—"}</b></div>
                  <div><small>Динамика 30 дней</small><b className={idea.momentum30d === null ? "" : idea.momentum30d >= 0 ? "positive" : "negative"}>{idea.momentum30d === null ? "копим историю" : `${idea.momentum30d > 0 ? "+" : ""}${idea.momentum30d}%`}</b></div>
                </div>
                <div className="cs2-score">
                  <div><span>Потенциал</span><b>{idea.potentialScore}/100</b></div>
                  <div className="cs2-score-track" aria-label={`Оценка потенциала ${idea.potentialScore} из 100`}><span style={{ width: `${idea.potentialScore}%` }} /></div>
                  <p>{idea.scoreLabel} · {idea.confidence}</p>
                </div>
                <div className="cs2-reasons"><b>Почему в списке</b><ul>{idea.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
                {!!idea.catalysts.length && <div className="cs2-catalysts"><b>Что может подтолкнуть цену</b><div>{idea.catalysts.map((catalyst) => <span key={catalyst}>{catalyst}</span>)}</div></div>}
                <div className="investment-card-links">{idea.sourceUrls.slice(0, 3).map((url) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{sourceLabel(url)} ↗</a>)}</div>
              </article>
            ))}
          </div>
          {!visibleIdeas.length && <div className="discovery-empty"><span>⌁</span><h3>Пока нет предметов этого типа</h3><p>Обновите радар — список зависит от текущего каталога и ликвидности.</p></div>}
          <section className="cs2-methodology"><p className="eyebrow">КАК СЧИТАЕТСЯ ОЦЕНКА</p><h2>Баллы — это фильтр, а не вероятность роста.</h2><p>{data?.methodology}</p></section>
          <section className="market-sources"><div><p className="eyebrow">ПУБЛИЧНЫЕ ИСТОЧНИКИ</p><h2>Где проверить каждый тезис</h2></div><div>{data?.sources.slice(0, 8).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><small>{source.publisher}</small><b>{source.title}</b><span>↗</span></a>)}</div></section>
          {data?.disclaimer && <p className="investment-disclaimer">{data.disclaimer}</p>}
        </>
      )}
    </section>
  );
}
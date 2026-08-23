"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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

type DiscoverySource = { title: string; url: string; kind: "магазин" | "обзор" | "поиск" };
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
type DiscoveryResponse = { summary: string; products: DiscoveryProduct[]; error?: string };
type AssistantSource = { title: string; url: string; description: string };
type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; sources?: AssistantSource[] };
type AssistantResponse = { answer?: string; mode?: string; sources?: AssistantSource[]; followUps?: string[]; error?: string };

type InvestmentSource = { title: string; url: string; description: string; publisher: string };
type InvestmentIdea = {
  id: string;
  title: string;
  assetClass: string;
  thesis: string;
  horizon: string;
  risk: "низкий" | "средний" | "высокий";
  confidence: "наблюдать" | "умеренная" | "повышенная";
  signals: string[];
  sourceUrls: string[];
};
type InvestmentsResponse = {
  updatedAt: string;
  mode: string;
  disclaimer: string;
  ideas: InvestmentIdea[];
  sources: InvestmentSource[];
  error?: string;
};

const consentStorageKey = "pricepulse-external-search-consent";


function fallbackInvestments(): InvestmentsResponse {
  const sources: InvestmentSource[] = [
    { title: "Финансовые рынки", url: "https://www.cbr.ru/financial_markets/", description: "Официальные данные Банка России.", publisher: "Банк России" },
    { title: "Новости Московской биржи", url: "https://www.moex.com/ru/news/", description: "Новости торгов и инструментов.", publisher: "Московская биржа" },
    { title: "РБК Инвестиции", url: "https://www.rbc.ru/quote/", description: "Публичные новости рынков и компаний.", publisher: "РБК" },
    { title: "БКС Экспресс", url: "https://t.me/bcs_express", description: "Публичный аналитический канал.", publisher: "БКС Экспресс" },
  ];
  return {
    updatedAt: new Date().toISOString(),
    mode: "offline-fallback",
    disclaimer: "Это базовый список тем из публичных источников, а не индивидуальная инвестиционная рекомендация. Обновите обзор при восстановлении сети и проверяйте первоисточники.",
    sources,
    ideas: [
      { id: "fallback-rates", title: "Ставка и облигации", assetClass: "Облигации", thesis: "Следить за решениями Банка России и изменением доходностей. Сравнивать срок, кредитный риск и ликвидность.", horizon: "3–18 месяцев", risk: "средний", confidence: "наблюдать", signals: ["Решения по ключевой ставке", "Доходности и сроки погашения"], sourceUrls: [sources[0].url, sources[1].url] },
      { id: "fallback-equities", title: "Компании с понятным денежным потоком", assetClass: "Акции", thesis: "Проверять долговую нагрузку, прибыль и дивидендную политику. Новостной импульс сам по себе недостаточен.", horizon: "12+ месяцев", risk: "высокий", confidence: "наблюдать", signals: ["Отчётность компаний", "Долг и свободный денежный поток"], sourceUrls: [sources[1].url, sources[2].url] },
      { id: "fallback-defensive", title: "Защитные активы и сырьё", assetClass: "Золото / сырьё", thesis: "Оценивать реакцию защитных активов на валюту, ставки и новости только как часть диверсифицированного портфеля.", horizon: "6–24 месяца", risk: "высокий", confidence: "наблюдать", signals: ["Курс рубля", "Ставки и инфляционные ожидания"], sourceUrls: [sources[0].url, sources[2].url] },
      { id: "fallback-digital", title: "Цифровые активы — только малой долей", assetClass: "Крипто / цифровые предметы", thesis: "Заранее определить допустимый убыток, проверить ликвидность площадки и не использовать заёмные средства.", horizon: "Спекулятивный", risk: "высокий", confidence: "наблюдать", signals: ["Ликвидность", "Регуляторные и платформенные риски"], sourceUrls: [sources[0].url, sources[3].url] },
    ],
  };
}

export function SmartDiscoveryView({ products }: { products: ProductContext[] }) {
  const [mode, setMode] = useState<"search" | "assistant">("search");
  const [query, setQuery] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [pendingAction, setPendingAction] = useState<"search" | "assistant">("search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
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
            <p className="eyebrow">КОНТЕКСТНЫЙ AI-ПОИСК</p>
            <h1>Поймём товар и найдём профильные площадки.</h1>
            <p className="discovery-lead">Для CS2 проверим LIS-SKINS и игровые маркеты, для техники — профильные магазины, для других категорий — свои доверенные источники.</p>
            <form className="discovery-search" onSubmit={(event) => { event.preventDefault(); void searchProducts(); }}>
              <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setError(""); }} placeholder="Например: новый розовый Glock из коллекции CS2" aria-label="Запрос для AI-поиска" />
              <button type="submit" disabled={loading}>{loading ? "Ищем…" : "Найти"} <span>→</span></button>
            </form>
            <p className="search-privacy-note"><span>✓</span> Первый поиск попросит разрешение передать только текст запроса. Профиль и карточки не отправляются.</p>
            <div className="prompt-chips">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => { setQuery(prompt); void searchProducts(prompt); }}>{prompt}</button>)}</div>
            {error && <p className="discovery-error" role="alert">{error}</p>}
          </div>

          <div className="discovery-results-head">
            <div><h2>{results.length ? "AI-подборка" : "Начните с запроса"}</h2><p>{summary || "Контекст запроса определит подходящие магазины и прямые ссылки на товары."}</p></div>
            {results.length > 0 && <span>{results.length} вариантов</span>}
          </div>
          {loading ? (
            <div className="discovery-loading"><span>✦</span><p>Определяем категорию, проверяем профильные каталоги и отзывы…</p></div>
          ) : results.length > 0 ? (
            <div className="discovery-grid">
              {results.map((item, index) => (
                <button className="discovery-card" key={item.id} onClick={() => setSelected(item)}>
                  <div className={`discovery-art art-${index % 3}`}><span>{item.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</span><i>✦ AI</i></div>
                  <div className="discovery-card-body">
                    <span className="popularity-badge">{item.popularity}</span><h3>{item.name}</h3><p>{item.description}</p>
                    <div className="discovery-meta"><b>{item.priceLabel}</b><span>★ {item.ratingLabel}</span></div>
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
            <div className="source-list">{selected.sources.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span>{index + 1}</span><div><small>{source.kind}</small><b>{source.title}</b></div><i>↗</i></a>)}</div>
            <p className="source-note">Цены и наличие меняются. Проверяйте итоговую стоимость и условия на странице магазина.</p>
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

  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/investments", { cache: "no-store" });
      const body = await response.json() as InvestmentsResponse;
      if (!response.ok) throw new Error(body.error || "Не удалось обновить рыночный обзор");
      setData(body.ideas?.length ? body : fallbackInvestments());
    } catch {
      setData(fallbackInvestments());
      setError("Внешние источники сейчас недоступны — показаны базовые темы. Нажмите «Обновить обзор» позже.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <section className="investments-view">
      <div className="investments-hero">
        <div><p className="eyebrow">РЫНОЧНЫЙ РАДАР</p><h1>Идеи из открытых источников. Без «тайных сигналов».</h1><p>PricePulse сопоставляет новости, публичную аналитику и официальные данные, показывает тезис, риск и ссылки для самостоятельной проверки.</p></div>
        <button onClick={() => void refresh()} disabled={loading}>{loading ? "Обновляем…" : "Обновить обзор"} <span>↻</span></button>
      </div>
      <div className="investment-warning"><span>!</span><p><b>Не индивидуальная рекомендация.</b> Ни одна карточка не является командой купить или продать. Не используйте заёмные средства и учитывайте риск полной потери капитала.</p></div>
      {error && <p className="investment-error" role="alert">{error}</p>}
      {loading && !data ? <div className="investment-loading"><span>↗</span><p>Читаем публичные источники и группируем рыночные темы…</p></div> : (
        <>
          <div className="investment-head"><div><h2>Темы для наблюдения</h2><p>{data?.updatedAt ? `Обновлено ${new Date(data.updatedAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : ""}</p></div><span>{data?.ideas.length ?? 0} идей</span></div>
          <div className="investment-grid">{data?.ideas.map((idea, index) => (
            <article className="investment-card" key={idea.id}>
              <div className="investment-card-top"><span className={`risk risk-${idea.risk}`}>риск: {idea.risk}</span><i>{String(index + 1).padStart(2, "0")}</i></div>
              <small>{idea.assetClass} · {idea.horizon}</small><h3>{idea.title}</h3><p>{idea.thesis}</p>
              {!!idea.signals.length && <ul>{idea.signals.map((signal) => <li key={signal}>{signal}</li>)}</ul>}
              <div className="investment-card-links">{idea.sourceUrls.slice(0, 3).map((url) => { const source = data.sources.find((item) => item.url === url); return <a key={url} href={url} target="_blank" rel="noopener noreferrer">{source?.publisher || "Источник"} ↗</a>; })}</div>
            </article>
          ))}</div>
          <section className="market-sources"><div><p className="eyebrow">ПУБЛИЧНЫЕ ИСТОЧНИКИ</p><h2>Откуда взяты сигналы</h2></div><div>{data?.sources.slice(0, 8).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><small>{source.publisher}</small><b>{source.title}</b><span>↗</span></a>)}</div></section>
          {data?.disclaimer && <p className="investment-disclaimer">{data.disclaimer}</p>}
        </>
      )}
    </section>
  );
}

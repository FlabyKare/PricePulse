import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://pricepulse-app.bokcerkbr.chatgpt.site"),
  title: "PricePulse — мониторинг цен",
  description: "Telegram Mini App для отслеживания цен, избранного и уведомлений о выгодных покупках.",
  openGraph: {
    title: "PricePulse — следи за ценой. Покупай вовремя.",
    description: "Сравнение магазинов, прогноз цены и общие подборки в одном Telegram Mini App.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1536,
        height: 1024,
        alt: "PricePulse — мониторинг выгодных цен",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PricePulse — следи за ценой. Покупай вовремя.",
    description: "Сравнение магазинов, прогноз цены и общие подборки.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f3ee",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js?63" />
      </head>
      <body>{children}</body>
    </html>
  );
}

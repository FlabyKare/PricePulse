import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://pricepulse-app.bokcerkbr.chatgpt.site"),
  title: "PricePulse — мониторинг цен",
  description: "Закрытое Telegram Mini App для личного мониторинга цен и сервисных уведомлений.",
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    title: "PricePulse — следи за ценой. Покупай вовремя.",
    description: "Личный мониторинг цен и сервисные уведомления в закрытом Telegram Mini App.",
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
    description: "Личный мониторинг цен в закрытом Telegram Mini App.",
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
        <Script src="https://telegram.org/js/telegram-web-app.js?63" strategy="beforeInteractive" />
      </head>
      <body>{children}</body>
    </html>
  );
}

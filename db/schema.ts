import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const telegramUsers = sqliteTable("telegram_users", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  username: text("username"),
  languageCode: text("language_code"),
  photoUrl: text("photo_url"),
  lastAuthAt: integer("last_auth_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const profileStates = sqliteTable("profile_states", {
  userId: text("user_id")
    .primaryKey()
    .references(() => telegramUsers.id, { onDelete: "cascade" }),
  productsJson: text("products_json").notNull().default("[]"),
  collectionsJson: text("collections_json").notNull().default("[]"),
  paletteJson: text("palette_json").notNull().default("{}"),
  currency: text("currency").notNull().default("RUB"),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});


export const cs2MarketSnapshots = sqliteTable("cs2_market_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemKey: text("item_key").notNull(),
  name: text("name").notNull(),
  itemType: text("item_type").notNull(),
  priceUsd: real("price_usd").notNull(),
  lisOffers: integer("lis_offers").notNull().default(0),
  sourceUrl: text("source_url").notNull(),
  bucket: integer("bucket").notNull(),
  capturedAt: text("captured_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_cs2_snapshots_item_bucket").on(table.itemKey, table.bucket),
  index("idx_cs2_snapshots_item_captured").on(table.itemKey, table.capturedAt),
]);

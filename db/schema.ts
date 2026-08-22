import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

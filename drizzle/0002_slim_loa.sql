CREATE TABLE `cs2_market_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_key` text NOT NULL,
	`name` text NOT NULL,
	`item_type` text NOT NULL,
	`price_usd` real NOT NULL,
	`lis_offers` integer DEFAULT 0 NOT NULL,
	`source_url` text NOT NULL,
	`bucket` integer NOT NULL,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cs2_snapshots_item_bucket` ON `cs2_market_snapshots` (`item_key`,`bucket`);--> statement-breakpoint
CREATE INDEX `idx_cs2_snapshots_item_captured` ON `cs2_market_snapshots` (`item_key`,`captured_at`);
CREATE TABLE `sync_applied` (
	`key` text PRIMARY KEY NOT NULL,
	`doc_id` text,
	`applied_at` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`stock_json` text,
	`created_at` integer NOT NULL,
	`pushed_at` integer,
	`applied_at` integer
);

CREATE TABLE `inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`title_ar` text NOT NULL,
	`body_ar` text NOT NULL,
	`title_en` text,
	`body_en` text,
	`url` text,
	`at` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `inbox_at` ON `inbox` (`at`);
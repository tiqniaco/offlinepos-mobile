CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`starts_day` integer,
	`ends_day` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`scope_json` text DEFAULT '{"all":true}' NOT NULL,
	`value_bp` integer,
	`value_minor` integer,
	`min_qty_milli` integer,
	`buy_qty_milli` integer,
	`get_qty_milli` integer,
	`get_product_id` text,
	`tiers_json` text,
	`coupon_code` text,
	`min_total_minor` integer,
	`max_uses` integer
);
--> statement-breakpoint
CREATE INDEX `offers_active` ON `offers` (`active`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `offers_coupon` ON `offers` (`coupon_code`);--> statement-breakpoint
ALTER TABLE `sales_docs` ADD `offer_discount_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_docs` ADD `coupon_code` text;--> statement-breakpoint
ALTER TABLE `sales_docs` ADD `coupon_offer_id` text;--> statement-breakpoint
ALTER TABLE `sales_docs` ADD `coupon_discount_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_lines` ADD `offer_id` text;--> statement-breakpoint
ALTER TABLE `sales_lines` ADD `offer_discount_minor` integer DEFAULT 0 NOT NULL;
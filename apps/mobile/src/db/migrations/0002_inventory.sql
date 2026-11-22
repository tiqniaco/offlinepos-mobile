CREATE TABLE `barcodes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`code` text NOT NULL,
	`product_id` text NOT NULL,
	`product_unit_id` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `barcodes_code` ON `barcodes` (`code`);--> statement-breakpoint
CREATE INDEX `barcodes_product` ON `barcodes` (`product_id`);--> statement-breakpoint
CREATE TABLE `batch_levels` (
	`batch_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	PRIMARY KEY(`batch_id`, `warehouse_id`)
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`product_id` text NOT NULL,
	`batch_no` text,
	`expiry_day` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `batches_product` ON `batches` (`product_id`);--> statement-breakpoint
CREATE INDEX `batches_expiry` ON `batches` (`expiry_day`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`parent_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE INDEX `categories_name` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `inventory_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`number` text,
	`warehouse_id` text NOT NULL,
	`reason` text,
	`note` text,
	`posted_at` integer,
	`business_day` integer,
	`hash` text,
	`prev_hash` text,
	`chain_seq` integer
);
--> statement-breakpoint
CREATE INDEX `inventory_docs_status` ON `inventory_docs` (`type`,`status`);--> statement-breakpoint
CREATE TABLE `inventory_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`doc_id` text NOT NULL,
	`product_id` text NOT NULL,
	`batch_id` text,
	`expected_milli` integer,
	`counted_milli` integer,
	`delta_milli` integer NOT NULL,
	`unit_cost_minor` integer,
	FOREIGN KEY (`doc_id`) REFERENCES `inventory_docs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_lines_doc` ON `inventory_lines` (`doc_id`);--> statement-breakpoint
CREATE INDEX `inventory_lines_product` ON `inventory_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_units` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`factor_milli` integer NOT NULL,
	`retail_price_minor` integer,
	`wholesale_price_minor` integer,
	`is_base` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_units_product` ON `product_units` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`name_en` text,
	`sku` text,
	`category_id` text,
	`group_id` text,
	`variant_label` text,
	`base_unit_id` text NOT NULL,
	`cost_minor` integer DEFAULT 0 NOT NULL,
	`retail_price_minor` integer DEFAULT 0 NOT NULL,
	`wholesale_price_minor` integer DEFAULT 0 NOT NULL,
	`tax_rate_bp` integer,
	`track_stock` integer DEFAULT true NOT NULL,
	`track_expiry` integer DEFAULT false NOT NULL,
	`low_stock_milli` integer,
	`image_path` text,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `product_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_name` ON `products` (`name`);--> statement-breakpoint
CREATE INDEX `products_category` ON `products` (`category_id`,`name`);--> statement-breakpoint
CREATE INDEX `products_group` ON `products` (`group_id`);--> statement-breakpoint
CREATE INDEX `products_deleted` ON `products` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `stock_levels` (
	`product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`avg_cost_minor` integer NOT NULL,
	`value_minor` integer NOT NULL,
	`last_movement_at` integer NOT NULL,
	PRIMARY KEY(`product_id`, `warehouse_id`)
);
--> statement-breakpoint
CREATE INDEX `stock_levels_qty` ON `stock_levels` (`qty_milli`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`batch_id` text,
	`qty_milli` integer NOT NULL,
	`unit_cost_minor` integer NOT NULL,
	`type` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_line_id` text,
	`reason` text,
	`business_day` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_mov_product` ON `stock_movements` (`product_id`,`warehouse_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `stock_mov_source` ON `stock_movements` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `stock_mov_day` ON `stock_movements` (`business_day`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`allows_fraction` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL
);

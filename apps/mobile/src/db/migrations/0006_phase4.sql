CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE TABLE `purchase_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`number` text,
	`supplier_id` text,
	`supplier_name` text,
	`supplier_ref` text,
	`original_doc_id` text,
	`issued_at` integer,
	`business_day` integer,
	`due_day` integer,
	`prices_include_vat` integer NOT NULL,
	`gross_minor` integer DEFAULT 0 NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`net_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer DEFAULT 0 NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`credit_minor` integer DEFAULT 0 NOT NULL,
	`note` text,
	`shift_id` text,
	`hash` text,
	`prev_hash` text,
	`chain_seq` integer,
	`posted_at` integer,
	`void_reason` text,
	`voided_by` text,
	`voided_at` integer
);
--> statement-breakpoint
CREATE INDEX `purchase_docs_type_status_day` ON `purchase_docs` (`type`,`status`,`business_day`);--> statement-breakpoint
CREATE INDEX `purchase_docs_supplier_day` ON `purchase_docs` (`supplier_id`,`business_day`);--> statement-breakpoint
CREATE INDEX `purchase_docs_original` ON `purchase_docs` (`original_doc_id`);--> statement-breakpoint
CREATE TABLE `purchase_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`doc_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`product_id` text NOT NULL,
	`product_unit_id` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`unit_name_snapshot` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`factor_milli` integer NOT NULL,
	`base_qty_milli` integer NOT NULL,
	`unit_cost_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`tax_rate_bp` integer NOT NULL,
	`net_minor` integer NOT NULL,
	`tax_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`base_unit_cost_minor` integer NOT NULL,
	`original_line_id` text,
	`business_day` integer,
	FOREIGN KEY (`doc_id`) REFERENCES `purchase_docs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `purchase_lines_doc` ON `purchase_lines` (`doc_id`);--> statement-breakpoint
CREATE INDEX `purchase_lines_product` ON `purchase_lines` (`product_id`,`business_day`);--> statement-breakpoint
CREATE INDEX `purchase_lines_original` ON `purchase_lines` (`original_line_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`number` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`opened_at` integer NOT NULL,
	`opening_float_minor` integer NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`expected_cash_minor` integer,
	`counted_cash_minor` integer,
	`difference_minor` integer,
	`summary_json` text,
	`note` text,
	`business_day` integer NOT NULL,
	`hash` text,
	`prev_hash` text,
	`chain_seq` integer
);
--> statement-breakpoint
CREATE INDEX `shifts_status` ON `shifts` (`status`,`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_number` ON `shifts` (`number`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`mobile` text,
	`address` text,
	`email` text,
	`tax_number` text,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `suppliers_name` ON `suppliers` (`name`);--> statement-breakpoint
CREATE INDEX `suppliers_mobile` ON `suppliers` (`mobile`);--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`number` text NOT NULL,
	`party_type` text,
	`party_id` text,
	`party_name` text,
	`category_id` text,
	`category_name` text,
	`method` text NOT NULL,
	`label` text,
	`amount_minor` integer NOT NULL,
	`sign` integer DEFAULT 1 NOT NULL,
	`note` text,
	`business_day` integer NOT NULL,
	`shift_id` text,
	`posted_at` integer NOT NULL,
	`hash` text,
	`prev_hash` text,
	`chain_seq` integer,
	`void_reason` text,
	`voided_by` text,
	`voided_at` integer
);
--> statement-breakpoint
CREATE INDEX `vouchers_type_day` ON `vouchers` (`type`,`business_day`);--> statement-breakpoint
CREATE INDEX `vouchers_party` ON `vouchers` (`party_type`,`party_id`,`business_day`);--> statement-breakpoint
CREATE INDEX `vouchers_shift` ON `vouchers` (`shift_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vouchers_number` ON `vouchers` (`number`);
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`code` text NOT NULL,
	`system_key` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
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
	`credit_limit_minor` integer,
	`price_tier` text DEFAULT 'retail' NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `customers_name` ON `customers` (`name`);--> statement-breakpoint
CREATE INDEX `customers_mobile` ON `customers` (`mobile`);--> statement-breakpoint
CREATE TABLE `integrity_chain` (
	`device_id` text NOT NULL,
	`chain_seq` integer NOT NULL,
	`doc_type` text NOT NULL,
	`doc_id` text NOT NULL,
	`hash` text NOT NULL,
	`prev_hash` text NOT NULL,
	`posted_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `chain_seq`)
);
--> statement-breakpoint
CREATE INDEX `integrity_chain_doc` ON `integrity_chain` (`doc_id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`business_day` integer NOT NULL,
	`memo` text
);
--> statement-breakpoint
CREATE INDEX `journal_entries_source` ON `journal_entries` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `journal_entries_day` ON `journal_entries` (`business_day`);--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`debit_minor` integer NOT NULL,
	`credit_minor` integer NOT NULL,
	`party_type` text,
	`party_id` text,
	`business_day` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `journal_lines_account_day` ON `journal_lines` (`account_id`,`business_day`);--> statement-breakpoint
CREATE INDEX `journal_lines_entry` ON `journal_lines` (`entry_id`);--> statement-breakpoint
CREATE TABLE `party_balances` (
	`party_type` text NOT NULL,
	`party_id` text NOT NULL,
	`balance_minor` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	PRIMARY KEY(`party_type`, `party_id`)
);
--> statement-breakpoint
CREATE TABLE `party_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`party_type` text NOT NULL,
	`party_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`debit_minor` integer NOT NULL,
	`credit_minor` integer NOT NULL,
	`business_day` integer NOT NULL,
	`due_day` integer
);
--> statement-breakpoint
CREATE INDEX `party_ledger_party_day` ON `party_ledger` (`party_type`,`party_id`,`business_day`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`kind` text NOT NULL,
	`direction` text NOT NULL,
	`method` text NOT NULL,
	`label` text,
	`amount_minor` integer NOT NULL,
	`party_type` text,
	`party_id` text,
	`doc_type` text,
	`doc_id` text,
	`shift_id` text,
	`business_day` integer NOT NULL,
	`posted_at` integer NOT NULL,
	`voided` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_day_method` ON `payments` (`business_day`,`method`);--> statement-breakpoint
CREATE INDEX `payments_doc` ON `payments` (`doc_type`,`doc_id`);--> statement-breakpoint
CREATE INDEX `payments_party` ON `payments` (`party_type`,`party_id`,`business_day`);--> statement-breakpoint
CREATE INDEX `payments_shift` ON `payments` (`shift_id`);--> statement-breakpoint
CREATE TABLE `sales_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`number` text,
	`customer_id` text,
	`customer_name` text,
	`price_tier` text DEFAULT 'retail' NOT NULL,
	`original_doc_id` text,
	`shift_id` text,
	`cashier_id` text,
	`issued_at` integer,
	`business_day` integer,
	`prices_include_vat` integer NOT NULL,
	`invoice_discount_json` text,
	`gross_minor` integer DEFAULT 0 NOT NULL,
	`line_discount_minor` integer DEFAULT 0 NOT NULL,
	`invoice_discount_minor` integer DEFAULT 0 NOT NULL,
	`net_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`rounding_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer DEFAULT 0 NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`credit_minor` integer DEFAULT 0 NOT NULL,
	`change_minor` integer DEFAULT 0 NOT NULL,
	`cash_tendered_minor` integer DEFAULT 0 NOT NULL,
	`note` text,
	`approved_by` text,
	`hash` text,
	`prev_hash` text,
	`chain_seq` integer,
	`posted_at` integer,
	`void_reason` text,
	`voided_by` text,
	`voided_at` integer,
	`print_count` integer DEFAULT 0 NOT NULL,
	`last_printed_at` integer
);
--> statement-breakpoint
CREATE INDEX `sales_docs_type_status_day` ON `sales_docs` (`type`,`status`,`business_day`);--> statement-breakpoint
CREATE INDEX `sales_docs_customer_day` ON `sales_docs` (`customer_id`,`business_day`);--> statement-breakpoint
CREATE INDEX `sales_docs_original` ON `sales_docs` (`original_doc_id`);--> statement-breakpoint
CREATE INDEX `sales_docs_posted` ON `sales_docs` (`posted_at`);--> statement-breakpoint
CREATE TABLE `sales_lines` (
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
	`unit_price_minor` integer NOT NULL,
	`catalog_price_minor` integer NOT NULL,
	`discount_json` text,
	`gross_minor` integer NOT NULL,
	`line_discount_minor` integer NOT NULL,
	`invoice_discount_minor` integer NOT NULL,
	`tax_rate_bp` integer NOT NULL,
	`net_minor` integer NOT NULL,
	`tax_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`unit_cost_minor` integer,
	`original_line_id` text,
	`business_day` integer,
	FOREIGN KEY (`doc_id`) REFERENCES `sales_docs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_lines_doc` ON `sales_lines` (`doc_id`);--> statement-breakpoint
CREATE INDEX `sales_lines_product_day` ON `sales_lines` (`product_id`,`business_day`);--> statement-breakpoint
CREATE INDEX `sales_lines_day` ON `sales_lines` (`business_day`);--> statement-breakpoint
CREATE INDEX `sales_lines_original` ON `sales_lines` (`original_line_id`);
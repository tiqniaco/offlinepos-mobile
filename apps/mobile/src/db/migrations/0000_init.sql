CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`at` integer NOT NULL,
	`user_id` text,
	`device_id` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`hash` text NOT NULL,
	`prev_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_seq` ON `audit_log` (`seq`);--> statement-breakpoint
CREATE INDEX `audit_entity` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `business` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`server_business_id` text NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`vat_registered` integer NOT NULL,
	`vat_number` text,
	`cr_number` text,
	`address` text,
	`phones_json` text DEFAULT '[]' NOT NULL,
	`logo_path` text,
	`timezone` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`code` text NOT NULL,
	`name` text,
	`platform` text NOT NULL,
	`is_current` integer NOT NULL,
	`activated_at` integer NOT NULL,
	`deactivated_at` integer
);
--> statement-breakpoint
CREATE TABLE `doc_sequences` (
	`device_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`prefix` text NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`device_id`, `doc_type`)
);
--> statement-breakpoint
CREATE TABLE `kv_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `licence_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`token` text,
	`last_checkin_at` integer,
	`last_server_time` integer,
	`max_seen_time` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`key` text,
	`name` text NOT NULL,
	`is_system` integer NOT NULL,
	`permissions_json` text NOT NULL,
	`max_item_discount_bp` integer NOT NULL,
	`max_invoice_discount_bp` integer NOT NULL,
	`hlc` text NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`device_id` text,
	`name` text NOT NULL,
	`role_id` text NOT NULL,
	`pin_hash` text NOT NULL,
	`pin_salt` text NOT NULL,
	`pin_params` text NOT NULL,
	`biometric_enabled` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`failed_pin_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`color` text NOT NULL,
	`hlc` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `users_role` ON `users` (`role_id`);
CREATE TABLE `anchor_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`chain_seq` integer NOT NULL,
	`chain_head` text NOT NULL,
	`audit_seq` integer NOT NULL,
	`audit_head` text NOT NULL,
	`server_time` integer NOT NULL,
	`sig` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `anchor_receipts_device` ON `anchor_receipts` (`device_id`,`chain_seq`);
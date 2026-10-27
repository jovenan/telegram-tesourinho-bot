CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`bill_due_date` text,
	`installment_number` integer,
	`total_installments` integer,
	`mcc` text,
	`provider_category` text,
	`state` text NOT NULL,
	`tab` text,
	`source` text,
	`merchant_key` text,
	`category` text,
	`suggestion` text,
	`suggestion_kind` text,
	`duplicate` text,
	`closing_day` integer DEFAULT false NOT NULL,
	`batch_order` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_transactions_by_state` ON `bank_transactions` (`state`);
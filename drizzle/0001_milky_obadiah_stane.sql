CREATE TABLE `admin_access` (
	`email` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`role` text NOT NULL,
	`permissions` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `platform_owner` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`classified_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resident_push_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`resident_id` text NOT NULL,
	`updated_at` text NOT NULL
);

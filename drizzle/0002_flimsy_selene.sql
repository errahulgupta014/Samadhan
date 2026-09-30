CREATE TABLE `admin_access_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`actor` text NOT NULL,
	`subject` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `media` ADD `uploader` text;
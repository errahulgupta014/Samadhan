CREATE TABLE `admin_login_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bucket` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_login_failures_bucket_idx` ON `admin_login_failures` (`bucket`,`at`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ip_hash` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `admin_sessions_user_idx` ON `admin_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`iterations` integer NOT NULL,
	`must_change_password` integer DEFAULT 0 NOT NULL,
	`is_default_password` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_idx` ON `admin_users` (lower("username"));--> statement-breakpoint
CREATE INDEX `admin_users_owner_idx` ON `admin_users` (`owner`,`role`,`active`);
--> statement-breakpoint
-- Audit log: earlier access grants stored their detail as raw JSON. Rewrite those rows as a plain sentence (new rows are written readable).
UPDATE `admin_access_events` SET `detail` = 'Access set to ' || COALESCE(json_extract(`detail`, '$.role'), 'unknown role') || CASE WHEN json_extract(`detail`, '$.active') = 0 THEN ' (account disabled)' ELSE ' (account active)' END || ' with ' || COALESCE(json_array_length(json_extract(`detail`, '$.permissions')), 0) || ' permissions' WHERE substr(`detail`, 1, 1) = '{' AND json_valid(`detail`);

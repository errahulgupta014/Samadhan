CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`content_type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mobile_tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);

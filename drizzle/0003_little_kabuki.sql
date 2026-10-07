CREATE TABLE `resident_otps` (
	`mobile_hash` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`expires` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_sent` integer NOT NULL,
	`sends` integer DEFAULT 1 NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resident_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`resident_id` text NOT NULL,
	`kind` text NOT NULL,
	`mobile_hash` text NOT NULL,
	`mobile` text,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `resident_sessions_resident_idx` ON `resident_sessions` (`owner`,`resident_id`);--> statement-breakpoint
CREATE INDEX `resident_sessions_mobile_idx` ON `resident_sessions` (`mobile_hash`,`kind`);
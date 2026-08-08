CREATE TABLE `storage_usage_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`total_bytes` integer NOT NULL,
	`object_count` integer NOT NULL,
	`available` integer NOT NULL,
	`last_calculated_at` integer NOT NULL
);

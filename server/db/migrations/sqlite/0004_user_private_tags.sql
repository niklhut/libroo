PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `book_system_tags` (
	`book_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`book_id`, `tag_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_system_tags_book_id_tag_id_unique` ON `book_system_tags` (`book_id`, `tag_id`);
--> statement-breakpoint
CREATE INDEX `book_system_tags_book_id_idx` ON `book_system_tags` (`book_id`);
--> statement-breakpoint
CREATE INDEX `book_system_tags_tag_id_idx` ON `book_system_tags` (`tag_id`);
--> statement-breakpoint
CREATE TABLE `user_book_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_book_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_book_id`) REFERENCES `user_books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_book_tags_user_book_id_tag_id_unique` ON `user_book_tags` (`user_book_id`, `tag_id`);
--> statement-breakpoint
CREATE INDEX `user_book_tags_user_book_id_idx` ON `user_book_tags` (`user_book_id`);
--> statement-breakpoint
CREATE INDEX `user_book_tags_tag_id_idx` ON `user_book_tags` (`tag_id`);
--> statement-breakpoint
INSERT INTO `book_system_tags` (`book_id`, `tag_id`, `created_at`, `updated_at`)
SELECT DISTINCT `book_id`, `tag_id`, `created_at`, `updated_at`
FROM `book_tags`
WHERE `is_suggested` = 1;
--> statement-breakpoint
INSERT INTO `user_book_tags` (`id`, `user_book_id`, `tag_id`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(16))) AS `id`,
	ub.`id` AS `user_book_id`,
	bt.`tag_id`,
	coalesce(bt.`created_at`, unixepoch()),
	coalesce(bt.`updated_at`, unixepoch())
FROM `book_tags` bt
INNER JOIN `user_books` ub ON ub.`book_id` = bt.`book_id`
WHERE bt.`is_suggested` = 0;
--> statement-breakpoint
DROP TABLE `book_tags`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
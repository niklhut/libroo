PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);
--> statement-breakpoint
CREATE INDEX `tags_name_idx` ON `tags` (`name`);
--> statement-breakpoint
CREATE TABLE `book_tags` (
	`book_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`is_suggested` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`book_id`, `tag_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_tags_book_id_tag_id_unique` ON `book_tags` (`book_id`, `tag_id`);
--> statement-breakpoint
CREATE INDEX `book_tags_book_id_idx` ON `book_tags` (`book_id`);
--> statement-breakpoint
CREATE INDEX `book_tags_tag_id_idx` ON `book_tags` (`tag_id`);
--> statement-breakpoint
CREATE INDEX `book_tags_is_suggested_idx` ON `book_tags` (`is_suggested`);
--> statement-breakpoint
INSERT INTO `tags` (`id`, `name`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(16))) AS `id`,
	`name`,
	unixepoch(),
	unixepoch()
FROM (
	SELECT DISTINCT trim(value) AS `name`
	FROM `books`, json_each(CASE WHEN json_valid(`subjects`) THEN `subjects` ELSE '[]' END)
	WHERE `subjects` IS NOT NULL
	AND trim(value) != ''
	AND lower(trim(value)) NOT LIKE 'nyt:%'
);
--> statement-breakpoint
INSERT INTO `book_tags` (`book_id`, `tag_id`, `is_suggested`, `created_at`, `updated_at`)
SELECT DISTINCT
	b.`id` AS `book_id`,
	t.`id` AS `tag_id`,
	true,
	unixepoch(),
	unixepoch()
FROM `books` b,
	json_each(CASE WHEN json_valid(b.`subjects`) THEN b.`subjects` ELSE '[]' END) j
	INNER JOIN `tags` t ON t.`name` = trim(j.value)
WHERE b.`subjects` IS NOT NULL
AND trim(j.value) != '';
--> statement-breakpoint
CREATE TABLE `__new_books` (
	`id` text PRIMARY KEY NOT NULL,
	`isbn` text,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`cover_path` text,
	`open_library_key` text,
	`work_key` text,
	`description` text,
	`publish_date` text,
	`publishers` text,
	`number_of_pages` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_books` (`id`, `isbn`, `title`, `author`, `cover_path`, `open_library_key`, `work_key`, `description`, `publish_date`, `publishers`, `number_of_pages`, `created_at`)
SELECT `id`, `isbn`, `title`, `author`, `cover_path`, `open_library_key`, `work_key`, `description`, `publish_date`, `publishers`, `number_of_pages`, `created_at`
FROM `books`;
--> statement-breakpoint
DROP TABLE `books`;
--> statement-breakpoint
ALTER TABLE `__new_books` RENAME TO `books`;
--> statement-breakpoint
CREATE UNIQUE INDEX `books_isbn_unique` ON `books` (`isbn`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
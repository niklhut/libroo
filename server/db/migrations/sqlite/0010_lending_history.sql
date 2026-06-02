ALTER TABLE `user_books` ADD `removed_at` integer;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_loans` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL,
  `user_book_id` text NOT NULL,
  `borrower_user_id` text,
  `borrower_display_name` text NOT NULL,
  `borrower_email` text,
  `status` text DEFAULT 'active' NOT NULL,
  `loaned_at` integer NOT NULL,
  `due_at` integer,
  `returned_at` integer,
  `canceled_at` integer,
  `owner_note` text,
  `snapshot_book_title` text NOT NULL,
  `snapshot_book_author` text NOT NULL,
  `snapshot_cover_path` text,
  `snapshot_owner_name` text NOT NULL,
  `accept_token_hash` text,
  `accepted_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_book_id`) REFERENCES `user_books`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`borrower_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `loans_status_check` CHECK(`status` IN ('active', 'returned', 'canceled'))
);
--> statement-breakpoint
INSERT INTO `__new_loans` (
  `id`,
  `owner_user_id`,
  `user_book_id`,
  `borrower_display_name`,
  `status`,
  `loaned_at`,
  `returned_at`,
  `snapshot_book_title`,
  `snapshot_book_author`,
  `snapshot_cover_path`,
  `snapshot_owner_name`,
  `created_at`,
  `updated_at`
)
SELECT
  `loans`.`id`,
  `user_books`.`user_id`,
  `loans`.`user_book_id`,
  `loans`.`borrower_name`,
  CASE WHEN `loans`.`date_returned` IS NULL THEN 'active' ELSE 'returned' END,
  `loans`.`date_loaned`,
  `loans`.`date_returned`,
  `books`.`title`,
  COALESCE((
    SELECT group_concat(`authors`.`name`, ', ')
    FROM `book_authors`
    INNER JOIN `authors` ON `book_authors`.`author_id` = `authors`.`id`
    WHERE `book_authors`.`book_id` = `books`.`id`
    ORDER BY `book_authors`.`sort_order`, `authors`.`name`
  ), 'Unknown Author'),
  `books`.`cover_path`,
  `user`.`name`,
  `loans`.`created_at`,
  `loans`.`created_at`
FROM `loans`
INNER JOIN `user_books` ON `loans`.`user_book_id` = `user_books`.`id`
INNER JOIN `books` ON `user_books`.`book_id` = `books`.`id`
INNER JOIN `user` ON `user_books`.`user_id` = `user`.`id`;
--> statement-breakpoint
DROP TABLE `loans`;
--> statement-breakpoint
ALTER TABLE `__new_loans` RENAME TO `loans`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE INDEX `loans_owner_user_id_idx` ON `loans` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `loans_user_book_id_idx` ON `loans` (`user_book_id`);
--> statement-breakpoint
CREATE INDEX `loans_borrower_user_id_idx` ON `loans` (`borrower_user_id`);
--> statement-breakpoint
CREATE INDEX `loans_accept_token_hash_idx` ON `loans` (`accept_token_hash`);

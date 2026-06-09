PRAGMA foreign_keys=OFF;

CREATE TABLE `__new_books` (
  `id` text PRIMARY KEY NOT NULL,
  `isbn` text,
  `title` text NOT NULL,
  `cover_path` text,
  `open_library_key` text,
  `work_key` text,
  `description` text,
  `publish_date` text,
  `publishers` text,
  `number_of_pages` integer,
  `source` text DEFAULT 'open_library' NOT NULL,
  `created_by_user_id` text REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
  `created_at` integer NOT NULL
);

INSERT INTO `__new_books` (
  `id`,
  `isbn`,
  `title`,
  `cover_path`,
  `open_library_key`,
  `work_key`,
  `description`,
  `publish_date`,
  `publishers`,
  `number_of_pages`,
  `source`,
  `created_by_user_id`,
  `created_at`
)
SELECT
  `id`,
  `isbn`,
  `title`,
  `cover_path`,
  `open_library_key`,
  `work_key`,
  `description`,
  `publish_date`,
  `publishers`,
  `number_of_pages`,
  `source`,
  `created_by_user_id`,
  `created_at`
FROM `books`;

DROP TABLE `books`;
ALTER TABLE `__new_books` RENAME TO `books`;

CREATE INDEX `books_isbn_idx` ON `books` (`isbn`);
CREATE UNIQUE INDEX `books_open_library_isbn_unique`
  ON `books` (`isbn`)
  WHERE `source` = 'open_library' AND `isbn` IS NOT NULL;

PRAGMA foreign_keys=ON;

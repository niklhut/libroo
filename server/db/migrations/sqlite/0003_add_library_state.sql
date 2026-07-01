PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_books` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`location_id` text,
	`rating` integer,
	`note` text,
	`library_state` text DEFAULT 'owned' NOT NULL,
	`reading_status` text DEFAULT 'unread' NOT NULL,
	`current_page` integer,
	`progress_percent` integer,
	`started_at` integer,
	`finished_at` integer,
	`added_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_books_rating_check" CHECK("__new_user_books"."rating" IS NULL OR "__new_user_books"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "user_books_library_state_check" CHECK("__new_user_books"."library_state" IN ('owned', 'wishlisted')),
	CONSTRAINT "user_books_reading_status_check" CHECK("__new_user_books"."reading_status" IN ('unread', 'reading', 'read')),
	CONSTRAINT "user_books_current_page_check" CHECK("__new_user_books"."current_page" IS NULL OR "__new_user_books"."current_page" >= 0),
	CONSTRAINT "user_books_progress_percent_check" CHECK("__new_user_books"."progress_percent" IS NULL OR "__new_user_books"."progress_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
INSERT INTO `__new_user_books`("id", "user_id", "book_id", "location_id", "rating", "note", "library_state", "reading_status", "current_page", "progress_percent", "started_at", "finished_at", "added_at", "removed_at") SELECT "id", "user_id", "book_id", "location_id", "rating", "note", 'owned', "reading_status", "current_page", "progress_percent", "started_at", "finished_at", "added_at", "removed_at" FROM `user_books`;--> statement-breakpoint
UPDATE `__new_user_books` SET `library_state` = 'owned' WHERE `library_state` IS NULL OR `library_state` = '';--> statement-breakpoint
DROP TRIGGER `user_books_location_same_user_insert`;--> statement-breakpoint
DROP TRIGGER `user_books_location_same_user_update`;--> statement-breakpoint
DROP TABLE `user_books`;--> statement-breakpoint
ALTER TABLE `__new_user_books` RENAME TO `user_books`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TRIGGER `user_books_location_same_user_insert`
BEFORE INSERT ON `user_books`
WHEN NEW.`location_id` IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM `locations`
  WHERE `locations`.`id` = NEW.`location_id`
  AND `locations`.`user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'location does not belong to user');
END;--> statement-breakpoint
CREATE TRIGGER `user_books_location_same_user_update`
BEFORE UPDATE OF `location_id`, `user_id` ON `user_books`
WHEN NEW.`location_id` IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM `locations`
  WHERE `locations`.`id` = NEW.`location_id`
  AND `locations`.`user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'location does not belong to user');
END;

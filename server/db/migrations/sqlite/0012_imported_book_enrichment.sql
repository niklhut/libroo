CREATE TABLE `book_enrichment_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`isbn` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`claim_token` text,
	`lease_expires_at` integer,
	`next_attempt_at` integer,
	`last_error` text,
	`outcome` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "book_enrichment_jobs_status_check" CHECK("book_enrichment_jobs"."status" IN ('pending', 'processing', 'retrying', 'completed', 'no_cover', 'not_found', 'failed', 'cancelled')),
	CONSTRAINT "book_enrichment_jobs_attempts_check" CHECK("book_enrichment_jobs"."attempts" >= 0 AND "book_enrichment_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_enrichment_jobs_book_id_unique` ON `book_enrichment_jobs` (`book_id`);--> statement-breakpoint
CREATE INDEX `book_enrichment_jobs_claim_idx` ON `book_enrichment_jobs` (`status`,`next_attempt_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `book_enrichment_jobs_user_status_idx` ON `book_enrichment_jobs` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `book_enrichment_jobs_batch_idx` ON `book_enrichment_jobs` (`batch_id`);--> statement-breakpoint
CREATE INDEX `book_enrichment_jobs_isbn_status_idx` ON `book_enrichment_jobs` (`isbn`,`status`);--> statement-breakpoint
CREATE TABLE `book_enrichment_locks` (
	`isbn` text PRIMARY KEY NOT NULL,
	`claim_token` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`entry_source` text,
	`metadata_provider_isbn` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "books_entry_source_check" CHECK("__new_books"."entry_source" IS NULL OR "__new_books"."entry_source" IN ('csv_import', 'manual_entry', 'isbn_lookup'))
);
--> statement-breakpoint
INSERT INTO `__new_books`("id", "isbn", "title", "cover_path", "open_library_key", "work_key", "description", "publish_date", "publishers", "number_of_pages", "source", "entry_source", "metadata_provider_isbn", "created_by_user_id", "created_at") SELECT "id", "isbn", "title", "cover_path", "open_library_key", "work_key", "description", "publish_date", "publishers", "number_of_pages", "source", NULL, NULL, "created_by_user_id", "created_at" FROM `books`;--> statement-breakpoint
DROP TABLE `books`;--> statement-breakpoint
ALTER TABLE `__new_books` RENAME TO `books`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `books_isbn_idx` ON `books` (`isbn`);--> statement-breakpoint
CREATE UNIQUE INDEX `books_open_library_isbn_unique` ON `books` (`isbn`) WHERE "books"."source" = 'open_library' AND "books"."isbn" IS NOT NULL;

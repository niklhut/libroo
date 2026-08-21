CREATE TABLE `canonical_book_enrichment_jobs` (
	`book_id` text PRIMARY KEY NOT NULL,
	`isbn` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`claim_token` text,
	`lease_expires_at` integer,
	`next_attempt_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "canonical_book_enrichment_status_check" CHECK("canonical_book_enrichment_jobs"."status" IN ('pending', 'processing', 'retrying', 'completed', 'no_cover', 'not_found', 'failed', 'cancelled')),
	CONSTRAINT "canonical_book_enrichment_attempts_check" CHECK("canonical_book_enrichment_jobs"."attempts" >= 0 AND "canonical_book_enrichment_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE INDEX `canonical_book_enrichment_claim_idx` ON `canonical_book_enrichment_jobs` (`status`,`next_attempt_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_book_enrichment_isbn_unique` ON `canonical_book_enrichment_jobs` (`isbn`);
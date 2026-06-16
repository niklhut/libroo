CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text DEFAULT 'admin' NOT NULL,
	`actor_user_id` text,
	`target_user_id` text,
	`action` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_category_idx` ON `admin_audit_log` (`category`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_actor_user_id_idx` ON `admin_audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_target_user_id_idx` ON `admin_audit_log` (`target_user_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_action_idx` ON `admin_audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_created_at_idx` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `signup_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`accepted_by_user_id` text,
	`reservation_token` text,
	`reserved_at` integer,
	`reservation_expires_at` integer,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "signup_invites_status_check" CHECK("signup_invites"."status" IN ('pending', 'accepted', 'expired', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signup_invites_token_hash_unique` ON `signup_invites` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `signup_invites_reservation_token_unique` ON `signup_invites` (`reservation_token`) WHERE "signup_invites"."reservation_token" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `signup_invites_status_idx` ON `signup_invites` (`status`);--> statement-breakpoint
CREATE INDEX `signup_invites_email_idx` ON `signup_invites` (`email`);--> statement-breakpoint
CREATE INDEX `signup_invites_created_by_user_id_idx` ON `signup_invites` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`pending_email` text,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `authors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authors_normalized_name_unique` ON `authors` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `authors_name_idx` ON `authors` (`name`);--> statement-breakpoint
CREATE TABLE `book_authors` (
	`book_id` text NOT NULL,
	`author_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`book_id`, `author_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `book_authors_book_id_idx` ON `book_authors` (`book_id`);--> statement-breakpoint
CREATE INDEX `book_authors_author_id_idx` ON `book_authors` (`author_id`);--> statement-breakpoint
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
CREATE INDEX `book_system_tags_book_id_idx` ON `book_system_tags` (`book_id`);--> statement-breakpoint
CREATE INDEX `book_system_tags_tag_id_idx` ON `book_system_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `books` (
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
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `books_isbn_idx` ON `books` (`isbn`);--> statement-breakpoint
CREATE UNIQUE INDEX `books_open_library_isbn_unique` ON `books` (`isbn`) WHERE "books"."source" = 'open_library' AND "books"."isbn" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `loans` (
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
	CONSTRAINT "loans_status_check" CHECK("loans"."status" IN ('active', 'returned', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX `loans_owner_user_id_idx` ON `loans` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `loans_user_book_id_idx` ON `loans` (`user_book_id`);--> statement-breakpoint
CREATE INDEX `loans_borrower_user_id_idx` ON `loans` (`borrower_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `loans_active_user_book_unique` ON `loans` (`user_book_id`) WHERE "loans"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `loans_accept_token_hash_unique` ON `loans` (`accept_token_hash`) WHERE "loans"."accept_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_location_id` text,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`path` text NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_user_parent_name_unique` ON `locations` (`user_id`,`parent_location_id`,`normalized_name`) WHERE "locations"."parent_location_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `locations_user_root_name_unique` ON `locations` (`user_id`,`normalized_name`) WHERE "locations"."parent_location_id" IS NULL;--> statement-breakpoint
CREATE INDEX `locations_user_id_idx` ON `locations` (`user_id`);--> statement-breakpoint
CREATE INDEX `locations_parent_location_id_idx` ON `locations` (`parent_location_id`);--> statement-breakpoint
CREATE INDEX `locations_path_idx` ON `locations` (`path`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_unique` ON `tags` (`normalized_name`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `user_book_tags_user_book_id_tag_id_unique` ON `user_book_tags` (`user_book_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `user_book_tags_user_book_id_idx` ON `user_book_tags` (`user_book_id`);--> statement-breakpoint
CREATE INDEX `user_book_tags_tag_id_idx` ON `user_book_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `user_books` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`location_id` text,
	`rating` integer,
	`note` text,
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
	CONSTRAINT "user_books_rating_check" CHECK("user_books"."rating" IS NULL OR "user_books"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "user_books_reading_status_check" CHECK("user_books"."reading_status" IN ('unread', 'reading', 'read')),
	CONSTRAINT "user_books_current_page_check" CHECK("user_books"."current_page" IS NULL OR "user_books"."current_page" >= 0),
	CONSTRAINT "user_books_progress_percent_check" CHECK("user_books"."progress_percent" IS NULL OR "user_books"."progress_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
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
END;
--> statement-breakpoint
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

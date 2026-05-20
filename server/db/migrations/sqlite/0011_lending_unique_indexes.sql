DROP INDEX IF EXISTS `loans_accept_token_hash_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `loans_active_user_book_unique` ON `loans` (`user_book_id`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `loans_accept_token_hash_unique` ON `loans` (`accept_token_hash`) WHERE `accept_token_hash` IS NOT NULL;

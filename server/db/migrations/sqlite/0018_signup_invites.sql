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
  CONSTRAINT `signup_invites_status_check` CHECK(`status` IN ('pending', 'accepted', 'expired', 'revoked'))
);

CREATE UNIQUE INDEX `signup_invites_token_hash_unique` ON `signup_invites` (`token_hash`);
CREATE UNIQUE INDEX `signup_invites_reservation_token_unique` ON `signup_invites` (`reservation_token`) WHERE `reservation_token` IS NOT NULL;
CREATE INDEX `signup_invites_status_idx` ON `signup_invites` (`status`);
CREATE INDEX `signup_invites_email_idx` ON `signup_invites` (`email`);
CREATE INDEX `signup_invites_created_by_user_id_idx` ON `signup_invites` (`created_by_user_id`);

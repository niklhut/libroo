CREATE TABLE `admin_audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `category` text NOT NULL DEFAULT 'admin',
  `actor_user_id` text,
  `target_user_id` text,
  `action` text NOT NULL,
  `metadata` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `admin_audit_log_category_idx` ON `admin_audit_log` (`category`);
CREATE INDEX `admin_audit_log_actor_user_id_idx` ON `admin_audit_log` (`actor_user_id`);
CREATE INDEX `admin_audit_log_target_user_id_idx` ON `admin_audit_log` (`target_user_id`);
CREATE INDEX `admin_audit_log_action_idx` ON `admin_audit_log` (`action`);
CREATE INDEX `admin_audit_log_created_at_idx` ON `admin_audit_log` (`created_at`);

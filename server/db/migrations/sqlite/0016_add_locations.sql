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
CREATE UNIQUE INDEX `locations_user_parent_name_unique` ON `locations` (`user_id`,`parent_location_id`,`normalized_name`) WHERE `parent_location_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_user_root_name_unique` ON `locations` (`user_id`,`normalized_name`) WHERE `parent_location_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `locations_user_id_idx` ON `locations` (`user_id`);
--> statement-breakpoint
CREATE INDEX `locations_parent_location_id_idx` ON `locations` (`parent_location_id`);
--> statement-breakpoint
CREATE INDEX `locations_path_idx` ON `locations` (`path`);
--> statement-breakpoint
ALTER TABLE `user_books` ADD `location_id` text REFERENCES locations(id) ON DELETE set null;

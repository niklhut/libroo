PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_locations` (
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
	FOREIGN KEY (`parent_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_locations`("id", "user_id", "parent_location_id", "name", "normalized_name", "path", "depth", "created_at", "updated_at") SELECT "id", "user_id", "parent_location_id", "name", "normalized_name", "path", "depth", "created_at", "updated_at" FROM `locations`;--> statement-breakpoint
DROP TRIGGER `user_books_location_same_user_insert`;--> statement-breakpoint
DROP TRIGGER `user_books_location_same_user_update`;--> statement-breakpoint
DROP TABLE `locations`;--> statement-breakpoint
ALTER TABLE `__new_locations` RENAME TO `locations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `locations_user_parent_name_unique` ON `locations` (`user_id`,`parent_location_id`,`normalized_name`) WHERE "locations"."parent_location_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `locations_user_root_name_unique` ON `locations` (`user_id`,`normalized_name`) WHERE "locations"."parent_location_id" IS NULL;--> statement-breakpoint
CREATE INDEX `locations_user_id_idx` ON `locations` (`user_id`);--> statement-breakpoint
CREATE INDEX `locations_parent_location_id_idx` ON `locations` (`parent_location_id`);--> statement-breakpoint
CREATE INDEX `locations_path_idx` ON `locations` (`path`);--> statement-breakpoint
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

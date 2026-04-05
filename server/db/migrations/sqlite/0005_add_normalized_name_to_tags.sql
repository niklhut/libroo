PRAGMA foreign_keys=OFF;
--> statement-breakpoint
ALTER TABLE `tags` ADD COLUMN `normalized_name` text;
--> statement-breakpoint
UPDATE `tags`
SET `normalized_name` = lower(trim(`name`))
WHERE `normalized_name` IS NULL OR trim(`normalized_name`) = '';
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_unique` ON `tags` (`normalized_name`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

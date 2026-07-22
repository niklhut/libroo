ALTER TABLE `loans` ADD `borrower_name_normalized` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `loans` ADD `borrower_email_normalized` text;--> statement-breakpoint
UPDATE `loans`
SET `borrower_name_normalized` = lower(trim(`borrower_display_name`)),
    `borrower_email_normalized` = CASE
      WHEN `borrower_email` IS NULL OR trim(`borrower_email`) = '' THEN NULL
      ELSE lower(trim(`borrower_email`))
    END;--> statement-breakpoint
CREATE INDEX `loans_owner_borrower_name_loaned_idx` ON `loans` (`owner_user_id`,`borrower_name_normalized`,`loaned_at`);

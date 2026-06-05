ALTER TABLE `user` ADD `role` text NOT NULL DEFAULT 'user';
ALTER TABLE `user` ADD `banned` integer NOT NULL DEFAULT false;
ALTER TABLE `user` ADD `ban_reason` text;
ALTER TABLE `user` ADD `ban_expires` integer;
ALTER TABLE `session` ADD `impersonated_by` text;

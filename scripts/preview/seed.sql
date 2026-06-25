-- Synthetic preview-only fixtures. These records are deliberately fictional
-- and must never be replaced with production-derived data.
INSERT OR IGNORE INTO `user` (
  `id`,
  `name`,
  `email`,
  `email_verified`,
  `role`,
  `banned`,
  `created_at`,
  `updated_at`
) VALUES
  (
    'preview-user-ada',
    'Ada Preview',
    'ada.preview@example.invalid',
    1,
    'user',
    0,
    1704067200000,
    1704067200000
  ),
  (
    'preview-user-linus',
    'Linus Placeholder',
    'linus.placeholder@example.invalid',
    1,
    'user',
    0,
    1704067200000,
    1704067200000
  );

INSERT OR IGNORE INTO `books` (
  `id`,
  `isbn`,
  `title`,
  `description`,
  `publish_date`,
  `publishers`,
  `number_of_pages`,
  `source`,
  `created_by_user_id`,
  `created_at`
) VALUES
  (
    'preview-book-clockwork-orchard',
    NULL,
    'The Clockwork Orchard',
    'A clearly fictional book created only for disposable preview testing.',
    '2099',
    '["Example House"]',
    240,
    'manual',
    'preview-user-ada',
    1704067200000
  ),
  (
    'preview-book-moonlit-index',
    NULL,
    'A Moonlit Index of Imaginary Libraries',
    'Synthetic catalogue data for preview UI checks.',
    '2098',
    '["Fictional Press"]',
    128,
    'manual',
    'preview-user-linus',
    1704067200000
  );

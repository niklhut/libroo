-- Track per-user reading state and progress for each owned book.

PRAGMA foreign_keys=OFF;

CREATE TABLE user_books_new (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  rating integer CONSTRAINT user_books_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  note text,
  reading_status text DEFAULT 'unread' NOT NULL CONSTRAINT user_books_reading_status_check CHECK (reading_status IN ('unread', 'reading', 'read')),
  current_page integer CONSTRAINT user_books_current_page_check CHECK (current_page IS NULL OR current_page >= 0),
  progress_percent integer CONSTRAINT user_books_progress_percent_check CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  started_at integer,
  finished_at integer,
  added_at integer NOT NULL
);

INSERT INTO user_books_new (
  id,
  user_id,
  book_id,
  rating,
  note,
  reading_status,
  current_page,
  progress_percent,
  started_at,
  finished_at,
  added_at
)
SELECT
  id,
  user_id,
  book_id,
  rating,
  note,
  'unread',
  NULL,
  NULL,
  NULL,
  NULL,
  added_at
FROM user_books;

DROP TABLE user_books;

ALTER TABLE user_books_new RENAME TO user_books;

PRAGMA foreign_keys=ON;

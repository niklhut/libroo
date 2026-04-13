-- SQLite does not support ALTER TABLE ADD CHECK on existing columns.
-- We must recreate the table with the CHECK constraint.
-- This uses the standard SQLite pattern: create new table, copy data, drop old, rename.

PRAGMA foreign_keys=OFF;

CREATE TABLE user_books_new (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  rating integer CONSTRAINT user_books_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  note text,
  added_at integer NOT NULL
);

INSERT INTO user_books_new (id, user_id, book_id, rating, note, added_at)
  SELECT id, user_id, book_id, rating, note, added_at FROM user_books;

DROP TABLE user_books;

ALTER TABLE user_books_new RENAME TO user_books;

PRAGMA foreign_keys=ON;

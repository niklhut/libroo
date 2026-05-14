-- Normalize book authors out of books.author into authors + book_authors.
-- Existing comma-joined authors are split on commas, matching the legacy storage format.

PRAGMA foreign_keys=OFF;

CREATE TABLE authors (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX authors_normalized_name_unique ON authors (normalized_name);
CREATE INDEX authors_name_idx ON authors (name);

CREATE TABLE book_authors (
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  PRIMARY KEY (book_id, author_id)
);

CREATE INDEX book_authors_book_id_idx ON book_authors (book_id);
CREATE INDEX book_authors_author_id_idx ON book_authors (author_id);

WITH RECURSIVE split(book_id, rest, name, sort_order) AS (
  SELECT
    id,
    author || ',',
    '',
    -1
  FROM books
  UNION ALL
  SELECT
    book_id,
    substr(rest, instr(rest, ',') + 1),
    trim(substr(rest, 1, instr(rest, ',') - 1)),
    sort_order + 1
  FROM split
  WHERE rest <> ''
),
distinct_authors AS (
  SELECT
    lower(name) AS normalized_name,
    min(name) AS name
  FROM split
  WHERE name <> ''
  GROUP BY lower(name)
)
INSERT INTO authors (id, name, normalized_name, created_at, updated_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  name,
  normalized_name,
  CAST(strftime('%s', 'now') AS integer) * 1000,
  CAST(strftime('%s', 'now') AS integer) * 1000
FROM distinct_authors;

WITH RECURSIVE split(book_id, rest, name, sort_order) AS (
  SELECT
    id,
    author || ',',
    '',
    -1
  FROM books
  UNION ALL
  SELECT
    book_id,
    substr(rest, instr(rest, ',') + 1),
    trim(substr(rest, 1, instr(rest, ',') - 1)),
    sort_order + 1
  FROM split
  WHERE rest <> ''
),
links AS (
  SELECT
    book_id,
    lower(name) AS normalized_name,
    min(sort_order) AS sort_order
  FROM split
  WHERE name <> ''
  GROUP BY book_id, lower(name)
)
INSERT INTO book_authors (book_id, author_id, sort_order, created_at)
SELECT
  links.book_id,
  authors.id,
  links.sort_order,
  CAST(strftime('%s', 'now') AS integer) * 1000
FROM links
INNER JOIN authors ON authors.normalized_name = links.normalized_name;

CREATE TABLE __new_books (
  id text PRIMARY KEY NOT NULL,
  isbn text UNIQUE,
  title text NOT NULL,
  cover_path text,
  open_library_key text,
  work_key text,
  description text,
  publish_date text,
  publishers text,
  number_of_pages integer,
  created_at integer NOT NULL
);

INSERT INTO __new_books (
  id,
  isbn,
  title,
  cover_path,
  open_library_key,
  work_key,
  description,
  publish_date,
  publishers,
  number_of_pages,
  created_at
)
SELECT
  id,
  isbn,
  title,
  cover_path,
  open_library_key,
  work_key,
  description,
  publish_date,
  publishers,
  number_of_pages,
  created_at
FROM books;

DROP TABLE books;
ALTER TABLE __new_books RENAME TO books;

PRAGMA foreign_keys=ON;

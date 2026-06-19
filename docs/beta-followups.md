# Beta Follow-ups

## Library bulk actions

The pre-beta library select mode was removed from the visible library page because it only supported bulk deletion and did not match the broader action model Libroo needs.

Future bulk actions should be redesigned as a polished workflow that can support actions such as:

- Move selected books to a location
- Add or remove tags
- Delete selected books
- Export selected books
- Other collection operations that fit the physical library workflow

The existing backend batch delete path can be reused or replaced when that design is implemented, but it should not be exposed again without a complete multi-action selection experience.

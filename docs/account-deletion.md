# Account Deletion And Retention

Libroo deletes accounts immediately after the signed-in user confirms the action from Settings with their current password and the exact confirmation text `DELETE MY ACCOUNT`.

This is product and operations guidance, not legal advice. Confirm hosted-service policy language with counsel before public hosted launch.

The last active admin account cannot self-delete. Promote another trusted active admin first, then retry deletion from the original admin account.

For the broader data inventory, admin capability list, and audit coverage matrix, see [Privacy And Data Reference](./privacy-and-data.md).

## Library CSV Export Semantics

The library CSV export is implemented by `server/services/library-transfer.service.ts` and is intended for current-library transfer, not a complete personal-data archive.

Export columns:

- `title`
- `authors`
- `isbn`
- `tags`
- `location`
- `reading_status`
- `current_page`
- `progress_percent`
- `rating`
- `note`
- `added_date`
- `active_loan_status`
- `active_loan_borrower`
- `active_loan_loaned_at`
- `active_loan_due_at`

Known gaps:

- Borrower email is not exported.
- Historical loans are not exported.
- Only one active loan snapshot can be exported per library entry.
- `active_loan_borrower` may contain a third-party borrower display name supplied by the owner.

## User-Facing Deletion Semantics

Self-service deletion is `POST /api/account/delete`. The signed-in user must provide their current password and the exact confirmation text `DELETE MY ACCOUNT`. The route verifies the session, validates the body, verifies the current password, runs the account deletion service, and then deletes associated local blob paths returned by the repository.

Account deletion hard-deletes:

- Better Auth user, account, and session records.
- Pending verification records tied to the user's current or pending email address.
- User-owned library records, including `user_books`, user book tags, notes, ratings, locations, reading state, and settings stored on the account.
- Loans owned by the deleting user, including borrower names, borrower emails, owner-private notes, invite tokens, and owner snapshots.
- Borrowed-loan associations where the deleting user accepted another user's loan invite. The other user's loan can remain, but the deleting user's account link and accepted state are removed.
- Signup invites created by the deleting user. Invites accepted by the deleting user are retained for the inviter only with the accepted-user reference cleared.
- Manual book metadata rows created by the deleting user when no retained user library record still references the row.
- User-specific uploaded assets, including manual cover images deleted with removed manual book rows and local account image paths.

Account deletion anonymizes or retains:

- Shared Open Library-derived book metadata and generated shared cover assets, because those rows are not user-specific personal data.
- Manual book rows created by the deleting user if another retained user's library record legitimately still references that row. The direct creator reference is cleared when the user is deleted.
- Global tag and author dictionary rows that no longer identify a user.
- Borrowed-loan rows owned by another user. Libroo clears the deleted borrower's account association and accepted state, but the owner may retain their own loan row and owner-supplied borrower display text.
- Admin audit rows with user references cleared by database `ON DELETE SET NULL`.
- Backups until the operator's documented backup retention window expires.

The last active admin deletion guard is enforced in the repository using an atomic predicate, so the final active admin cannot self-delete even under concurrent requests.

## Lending Records

When a lender deletes their account, Libroo deletes the lender's loan records. This removes borrower personal data supplied by that lender and avoids showing the deleted lender's identity to borrowers.

When a borrower deletes their account, Libroo removes the account association from loans they accepted. The owner may retain their own lending record, including any owner-private loan note, and borrower text they supplied, because that record belongs to the owner. The deleted borrower no longer sees borrowed books because their account and sessions are gone.

## Manual Operator Requests

Operators should prefer asking users to delete their own account from Settings because it verifies the user's current password and runs the same storage cleanup path.

For manual support requests:

1. Verify the requester's identity through the hosted support process or the self-hosted administrator's local policy.
2. When the requester can still sign in, direct them to Settings > Delete account.
3. For requesters who cannot sign in, reset access first when appropriate, then have them use self-service deletion.
4. Before deleting the last active admin, promote another trusted active admin.
5. In cases where self-service cannot be used, run the same application deletion service from an authenticated maintenance context rather than ad hoc SQL. Ad hoc database deletes can leave blob assets or manual metadata behind.
6. Record the support action without storing unnecessary personal details.
7. Confirm whether backups may retain deleted data until the backup retention window expires.

For self-hosted installs, a full `/data` backup taken before deletion can still contain the deleted account. Operators should avoid restoring old full-volume backups into production unless they re-run deletion for affected users after restoration. Use the restore workflow in [Backup And Restore](./backup-restore.md), then replay every account-deletion request that occurred after the restored backup point before returning the instance to service.

## Backup Retention

The hosted service backup retention target is 30 days before public launch, unless a stricter legal or operational policy replaces it. Self-hosted operators define their own backup schedule and retention period.

Deleted data can persist in encrypted, access-controlled backups until those backups expire or are overwritten. Restoring a backup can reintroduce deleted data; after any restore, operators must re-run deletion requests that occurred after the restored backup point.

## Known Exceptions

Libroo may retain data when required for security, abuse prevention, legal compliance, accounting, or another documented retention basis. Minimize retained data and remove direct user references when possible.

Open Library-derived metadata is retained as shared catalog metadata when it is not personal to the deleted user.

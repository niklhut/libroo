# Privacy And Data Reference

Libroo is a physical-first library system. This document describes the application data model and the privacy behavior operators should understand. It is implementation-grounded in `server/db/schema/auth.ts` and `server/db/schema/domain.ts`; it is not legal advice.

## Stored Data Categories

### Users, Sessions, And Accounts

The `user` table stores the Better Auth user record: `id`, required `name`, unique required `email`, `email_verified`, nullable `pending_email`, nullable `image`, nullable `terms_accepted_at`, role and ban state, and timestamps. Roles are stored in Better Auth's `role` field. Ban state is stored in `banned`, `ban_reason`, and `ban_expires`.

The `session` table stores active session records: token, expiry, creation/update timestamps, nullable IP address, nullable user agent, nullable `impersonated_by`, and the owning user. Sessions cascade-delete with the user. `impersonated_by` remains in the schema because Better Auth supports it, but Libroo blocks impersonation permanently at middleware level.

The admin users screen labels the latest `session.updated_at` value as **Last session update**. It is derived from Better Auth session refreshes and is not per-request activity; no additional session column or activity-tracking mechanism has been added.

The `account` table stores authentication account records: provider identifiers, the owning user, optional provider tokens, password hash, token expiry timestamps, scope, and creation/update timestamps. Accounts cascade-delete with the user.

The `verification` table stores Better Auth verification state: identifier, value, expiry, and optional creation/update timestamps. It is used for email verification, email-change verification, and password-reset style verification records.

### Books And Library Entries

The `books` table stores canonical or manual book metadata: ISBN, title, cover path, Open Library edition/work keys, description, publish date, publishers, page count, source (`open_library` or `manual`), optional creator user, and creation timestamp. Open Library rows are shared catalog metadata. Manual rows may be user-created; the creator reference is set null if the creator account is deleted.

The `authors`, `book_authors`, `tags`, and `book_system_tags` tables are shared dictionaries and relationships. They do not directly store user account ownership. User-curated tags attach through `user_book_tags`.

The `locations` table stores a user's physical shelf/location tree. Location rows include the owner user, optional parent location, display name, normalized name, path, depth, and timestamps. Locations cascade-delete with the owner.

The `user_books` table stores a user's library entries: owner user, book reference, optional location, optional rating, optional private note, reading status, optional current page, optional progress percent, reading dates, added date, and optional removed date. User library entries cascade-delete with the owner.

The `user_book_tags` table stores user-curated tags on a specific user library entry and cascades with that entry.

### Loans

The `loans` table stores lending records for a user's physical copy. Each loan has a required owner user, required user-book record, nullable borrower user, required borrower display name, nullable borrower email, an optional owner-private note (up to 1,000 characters), status, loan/due/return/cancel timestamps, book and owner snapshots, optional accept token hash, optional accepted timestamp, and creation/update timestamps.

Borrower privacy details:

- `borrower_user_id` is nullable and uses `ON DELETE SET NULL`; it is set when a borrower accepts an invite with an account.
- `borrower_display_name` is required and frozen as a snapshot at loan time. It may be an account user's display name or a third-party name supplied by the owner.
- `borrower_email` is nullable. It is optional contact data supplied by the owner and is not included in library CSV export.
- `note` is an owner-private note. It is never included in borrower, invitation-preview, or other public-facing loan responses.
- `snapshot_book_title`, `snapshot_book_author`, `snapshot_cover_path`, and `snapshot_owner_name` preserve the lending context even if the live book/user data changes later.

If a borrower deletes their account, Libroo anonymizes the borrowed-loan association by clearing `borrower_user_id` and `accepted_at`, while retaining the owner's loan row and owner-supplied borrower snapshot text. If an owner deletes their account, owned loan rows are deleted.

### Signup Invites And Email Verification State

The `signup_invites` table stores invite lifecycle state: token hash, optional invited email, status, creator user, optional accepted user, reservation token and reservation timestamps, expiry, accepted/revoked timestamps, and creation/update timestamps. Invites created by a deleted user are deleted. Invites accepted by a deleted user may remain for the inviter with `accepted_by_user_id` cleared.

Email verification state is split between `user.email_verified`, `user.pending_email`, and `verification` records. `pending_email` holds the requested new email during the custom verified email-change flow. Better Auth clears it after successful verification.

### Admin Audit Log

The `admin_audit_log` table stores security and admin audit events: category (`admin` or `auth`), nullable actor user, nullable target user, action, optional JSON metadata, and creation timestamp. Actor and target foreign keys use `ON DELETE SET NULL`, so audit rows can survive user deletion without keeping a live account reference.

## Admin Capabilities And Limits

Admins can:

- View users.
- Change user roles.
- Ban and unban users.
- View the admin audit log.
- Create and revoke signup invites.
- Revoke sessions through Better Auth admin session capabilities.

Enforced limits from `server/utils/libroo-admin-auth-plugin.ts`:

- The first created user is automatically promoted to admin when the database has no existing admin.
- Admins cannot remove admin rights from themselves.
- Admins cannot ban themselves.
- The last active admin cannot be demoted.
- The last active unbanned admin cannot be banned.
- Last-admin checks are also enforced for self-service account deletion.

Impersonation is intentionally disabled. Requests to `/admin/impersonate-user` and `/admin/stop-impersonating` always fail with `FORBIDDEN` and `IMPERSONATION_DISABLED`. The `session.impersonated_by` column is residual unused Better Auth schema. Re-enabling impersonation requires an intentional future sprint with privacy, audit, UI, and operator policy work.

## Audit Coverage Matrix

| Action | Category | When recorded | Metadata |
| --- | --- | --- | --- |
| `user.role_changed` | `admin` | Admin role mutation through `/admin/set-role` or `/admin/update-user` | `previousRole`, `requestedRole`, `newRole` |
| `user.banned` | `admin` | Admin ban through `/admin/ban-user` or `/admin/update-user` | `previousBanned`, `previousBanReason`, `banReason`, `banExpiresIn`, `newBanned`, `banExpires` |
| `user.unbanned` | `admin` | Admin unban through `/admin/unban-user` or `/admin/update-user` | `previousBanned`, `previousBanReason`, `banReason`, `banExpiresIn`, `newBanned` |
| `signup_invite.created` | `admin` | Admin creates a signup invite | `inviteId`, `email`, `expiresAt` |
| `signup_invite.revoked` | `admin` | Admin revokes a signup invite | `inviteId`, `email`, `previousStatus`, `newStatus` |
| `auth.sign_up` | `auth` | Successful email signup | `email`, `name` |
| `auth.sign_in_failed` | `auth` | Failed email sign-in | `email`, `statusCode`, `code`, `message` |
| `auth.password_changed` | `auth` | Successful password change | `revokeOtherSessions` |
| `auth.password_reset_requested` | `auth` | Password reset email requested | `email` |
| `auth.password_reset_completed` | `auth` | Password reset completed | None |
| `auth.email_change_requested` | `auth` | Direct Better Auth email-change request when verification gating is disabled | `newEmail` |
| `auth.email_change_confirmed` | `auth` | Verified email-change link succeeds | `newEmail` |
| `auth.account_deletion_requested` | `auth` | Better Auth delete-user flow sends verification email | `email`, `name` |
| `auth.account_deleted` | `auth` | Immediate Better Auth account deletion succeeds | None after deletion, or compact actor metadata when available |
| `auth.session_revoked` | `auth` | One session is revoked | None |
| `auth.sessions_revoked` | `auth` | All sessions or other sessions are revoked | `scope` (`all` or `other`) |
| `auth.two_factor_enabled` | `auth` | TOTP verification enables 2FA | None |
| `auth.two_factor_disabled` | `auth` | 2FA is disabled | None |
| `auth.backup_codes_regenerated` | `auth` | Backup codes are regenerated | None |
| `auth.backup_code_used` | `auth` | A backup code is used | None |

Deliberately unaudited domain actions:

- Loan create, return, and cancel.
- Book add, delete, import, and export.
- Location create, rename, and delete.
- Successful sign-in.

Email-verification configuration is controlled by deployment environment variables, not by admins inside the app, so configuration changes are out of scope for in-app audit logging.

## Export, Deletion, And Retention Notes

The library CSV export is a transfer format for the current user's library. It includes current book/library fields and at most one active loan snapshot. It does not include borrower email or historical loan rows. See [Account Deletion And Retention](./account-deletion.md) for deletion mechanics and operator support guidance.

Key retention nuances:

- Borrowed-loan rows can remain after a borrower account is deleted, with the borrower account link and accepted state cleared.
- Admin audit rows survive user deletion with actor/target foreign keys nulled.
- Shared Open Library metadata can remain after account deletion because it is shared catalog data.
- Backups can retain deleted data until the operator's retention window expires.

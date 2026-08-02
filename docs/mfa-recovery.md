# MFA Recovery

This guide covers operator recovery for optional TOTP two-factor authentication and passkeys. It does not replace a documented administrator-access process or protected database backups.

> Last-admin safeguard: Libroo refuses to disable TOTP when the last active admin is passwordless and has no remaining passkey. The response code is `LAST_FACTOR_REMOVAL`. Password-based users are never blocked by this safeguard.

Users receive recovery codes while enrolling in TOTP and whenever they regenerate them. Each code is single-use. Regenerating codes invalidates every previously issued code; support staff cannot recover the displayed codes after the user dismisses them.

## Operator runbook: admin lost all factors

1. Confirm the account is an active admin and determine whether it still has a password credential or another passkey.
2. Ask the admin to use an unused recovery code. If they can sign in, enroll a new authenticator or passkey from Settings and regenerate recovery codes.
3. If recovery codes are unavailable, use an existing active administrator account to create or promote a replacement administrator. Do not remove the existing admin until the replacement has verified access.
4. If no administrator can sign in, restore access through the approved, audited database-break-glass procedure for the deployment, using a current backup and changing the affected account's credentials/factors. Treat this as a security incident.
5. Force a password reset or set a new password through the approved administrator procedure, remove stale passkeys/TOTP only after another factor exists, and revoke active sessions if compromise is suspected.
6. Record the incident, rotate the recovery codes, and verify that at least two active admins have usable, independently stored factors.

See [deployment configuration](./deployment.md#passkeys--webauthn) for the HTTPS and relying-party-origin requirements for passkeys.

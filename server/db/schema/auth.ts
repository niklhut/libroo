import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core'

// Better Auth core tables
// Generated based on Better Auth schema requirements

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  pendingEmail: text('pending_email'),
  image: text('image'),
  termsAcceptedAt: integer('terms_accepted_at', { mode: 'timestamp' }),
  role: text('role').notNull().default('user'),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' })
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
})

// Better Auth's database-backed rate limiter.
export const rateLimit = sqliteTable('rateLimit', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  // Better Auth stores this as an epoch-millisecond number, not a Date.
  lastRequest: integer('lastRequest', { mode: 'number' }).notNull()
})

export const signupInvites = sqliteTable('signup_invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  email: text('email'),
  status: text('status', { enum: ['pending', 'accepted', 'expired', 'revoked'] }).notNull().default('pending'),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  acceptedByUserId: text('accepted_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  reservationToken: text('reservation_token'),
  reservedAt: integer('reserved_at', { mode: 'timestamp' }),
  reservationExpiresAt: integer('reservation_expires_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, table => [
  uniqueIndex('signup_invites_token_hash_unique').on(table.tokenHash),
  uniqueIndex('signup_invites_reservation_token_unique').on(table.reservationToken).where(sql`${table.reservationToken} IS NOT NULL`),
  index('signup_invites_status_idx').on(table.status),
  index('signup_invites_email_idx').on(table.email),
  index('signup_invites_created_by_user_id_idx').on(table.createdByUserId),
  check('signup_invites_status_check', sql`${table.status} IN ('pending', 'accepted', 'expired', 'revoked')`)
])

export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: text('id').primaryKey(),
  category: text('category', { enum: ['admin', 'auth'] }).notNull().default('admin'),
  actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
  targetUserId: text('target_user_id').references(() => user.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, table => [
  index('admin_audit_log_category_idx').on(table.category),
  index('admin_audit_log_actor_user_id_idx').on(table.actorUserId),
  index('admin_audit_log_target_user_id_idx').on(table.targetUserId),
  index('admin_audit_log_action_idx').on(table.action),
  index('admin_audit_log_created_at_idx').on(table.createdAt)
])

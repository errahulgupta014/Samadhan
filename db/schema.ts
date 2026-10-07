// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// (Real tables live in db/schema.ts; the starter's D1 example was removed.)
export {};
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const workspaces=sqliteTable('workspaces',{owner:text('owner').primaryKey(),body:text('body').notNull(),version:integer('version').notNull().default(1)});
export const media=sqliteTable('media',{id:text('id').primaryKey(),owner:text('owner').notNull(),contentType:text('content_type').notNull(),uploader:text('uploader')});
export const mobileTokens=sqliteTable('mobile_tokens',{hash:text('hash').primaryKey(),owner:text('owner').notNull(),expires:integer('expires').notNull()});
export const platformOwner=sqliteTable('platform_owner',{id:text('id').primaryKey(),userId:text('user_id').notNull(),email:text('email').notNull()});
export const adminAccess=sqliteTable('admin_access',{email:text('email').primaryKey(),owner:text('owner').notNull(),role:text('role').notNull(),permissions:text('permissions').notNull(),active:integer('active').notNull().default(1),updatedAt:text('updated_at').notNull()});
export const residentPushTokens=sqliteTable('resident_push_tokens',{token:text('token').primaryKey(),owner:text('owner').notNull(),residentId:text('resident_id').notNull(),updatedAt:text('updated_at').notNull()});
export const pushJobs=sqliteTable('push_jobs',{id:text('id').primaryKey(),owner:text('owner').notNull(),classifiedId:text('classified_id').notNull(),status:text('status').notNull(),createdAt:text('created_at').notNull(),detail:text('detail').notNull()});

export const adminAccessEvents=sqliteTable('admin_access_events',{id:text('id').primaryKey(),owner:text('owner').notNull(),actor:text('actor').notNull(),subject:text('subject').notNull(),detail:text('detail').notNull(),createdAt:text('created_at').notNull()});
// Resident mobile + OTP sign-in (lib/resident-otp.ts, lib/resident-auth.ts). Only hashes are stored: never a mobile number or an OTP code.
// One open challenge per mobile hash. `sends`/`window_start` implement the hourly resend cap; `attempts` locks a challenge after 5 wrong codes.
export const residentOtps=sqliteTable('resident_otps',{mobileHash:text('mobile_hash').primaryKey(),codeHash:text('code_hash').notNull(),expires:integer('expires').notNull(),attempts:integer('attempts').notNull().default(0),lastSent:integer('last_sent').notNull(),sends:integer('sends').notNull().default(1),windowStart:integer('window_start').notNull()});
// Opaque resident bearer tokens (SHA-256 of the token). kind 'session' = full resident (~90 days); 'registration' = 30-minute token valid only for media upload + register.
// Only registration rows carry the plain `mobile` (needed to create the profile at register time); the row is deleted when registration completes or expires.
export const residentSessions=sqliteTable('resident_sessions',{tokenHash:text('token_hash').primaryKey(),owner:text('owner').notNull(),residentId:text('resident_id').notNull(),kind:text('kind').notNull(),mobileHash:text('mobile_hash').notNull(),mobile:text('mobile'),expires:integer('expires').notNull()},t=>[index('resident_sessions_resident_idx').on(t.owner,t.residentId),index('resident_sessions_mobile_idx').on(t.mobileHash,t.kind)]);
// Administrator portal sign-in (lib/admin-auth-core.ts, lib/admin-store.ts, POST /api/admin-auth). Passwords are PBKDF2-SHA256 with a per-user salt: never stored or logged in clear.
// username is shown as typed; uniqueness is case-insensitive. role + permissions: preset roles take their permissions from shared/access.ts at request time, Custom uses the stored list.
export const adminUsers=sqliteTable('admin_users',{id:text('id').primaryKey(),owner:text('owner').notNull(),username:text('username').notNull(),name:text('name').notNull(),email:text('email'),avatarMediaId:text('avatar_media_id'),role:text('role').notNull(),permissions:text('permissions').notNull().default('[]'),active:integer('active').notNull().default(1),passwordHash:text('password_hash').notNull(),salt:text('salt').notNull(),iterations:integer('iterations').notNull(),mustChangePassword:integer('must_change_password').notNull().default(0),isDefaultPassword:integer('is_default_password').notNull().default(0),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),lastLoginAt:text('last_login_at')},t=>[uniqueIndex('admin_users_username_idx').on(sql`lower(${t.username})`),index('admin_users_owner_idx').on(t.owner,t.role,t.active)]);
// Opaque admin session cookies (SHA-256 of the token). expires slides forward while the admin is active (12 h), capped by created_at + 7 days. ip_hash/user_agent are informational.
export const adminSessions=sqliteTable('admin_sessions',{tokenHash:text('token_hash').primaryKey(),owner:text('owner').notNull(),userId:text('user_id').notNull(),expires:integer('expires').notNull(),createdAt:integer('created_at').notNull(),ipHash:text('ip_hash'),userAgent:text('user_agent')},t=>[index('admin_sessions_user_idx').on(t.userId)]);
// Failed sign-in attempts per bucket ('u:<lowercase username>' or 'i:<ip hash>') for the 15-minute lockout window.
export const adminLoginFailures=sqliteTable('admin_login_failures',{id:integer('id').primaryKey({autoIncrement:true}),bucket:text('bucket').notNull(),at:integer('at').notNull()},t=>[index('admin_login_failures_bucket_idx').on(t.bucket,t.at)]);

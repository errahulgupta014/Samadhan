// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
export {};
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const workspaces=sqliteTable('workspaces',{owner:text('owner').primaryKey(),body:text('body').notNull(),version:integer('version').notNull().default(1)});
export const media=sqliteTable('media',{id:text('id').primaryKey(),owner:text('owner').notNull(),contentType:text('content_type').notNull(),uploader:text('uploader')});
export const mobileTokens=sqliteTable('mobile_tokens',{hash:text('hash').primaryKey(),owner:text('owner').notNull(),expires:integer('expires').notNull()});
export const platformOwner=sqliteTable('platform_owner',{id:text('id').primaryKey(),userId:text('user_id').notNull(),email:text('email').notNull()});
export const adminAccess=sqliteTable('admin_access',{email:text('email').primaryKey(),owner:text('owner').notNull(),role:text('role').notNull(),permissions:text('permissions').notNull(),active:integer('active').notNull().default(1),updatedAt:text('updated_at').notNull()});
export const residentPushTokens=sqliteTable('resident_push_tokens',{token:text('token').primaryKey(),owner:text('owner').notNull(),residentId:text('resident_id').notNull(),updatedAt:text('updated_at').notNull()});
export const pushJobs=sqliteTable('push_jobs',{id:text('id').primaryKey(),owner:text('owner').notNull(),classifiedId:text('classified_id').notNull(),status:text('status').notNull(),createdAt:text('created_at').notNull(),detail:text('detail').notNull()});

export const adminAccessEvents=sqliteTable('admin_access_events',{id:text('id').primaryKey(),owner:text('owner').notNull(),actor:text('actor').notNull(),subject:text('subject').notNull(),detail:text('detail').notNull(),createdAt:text('created_at').notNull()});

CREATE TYPE "public"."group_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."room_member_role" AS ENUM('OWNER', 'MODERATOR', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."room_member_status" AS ENUM('ACTIVE', 'PENDING', 'KICKED', 'BANNED');--> statement-breakpoint
CREATE TYPE "public"."room_status" AS ENUM('IDLE', 'ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('STUDY', 'CLASSROOM', 'EXAM', 'OFFICE_HOURS');--> statement-breakpoint
CREATE TYPE "public"."room_visibility" AS ENUM('PRIVATE', 'UNLISTED', 'PUBLIC');--> statement-breakpoint
CREATE TYPE "public"."study_plan_status" AS ENUM('PENDING', 'DONE');--> statement-breakpoint
CREATE TABLE "chunk_concept" (
	"chunk_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"strength" real DEFAULT 1 NOT NULL,
	CONSTRAINT "chunk_concept_chunk_id_concept_id_pk" PRIMARY KEY("chunk_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "collab_doc" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"concept_id" text,
	"document_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"egress_id" text,
	"file_url" text,
	"duration_seconds" integer,
	"file_size_bytes" integer,
	"status" text DEFAULT 'RECORDING' NOT NULL,
	"transcript" text,
	"summary" text,
	"chapters" jsonb,
	"highlights" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	CONSTRAINT "recording_egress_id_unique" UNIQUE("egress_id")
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "room_type" DEFAULT 'STUDY' NOT NULL,
	"visibility" "room_visibility" DEFAULT 'PRIVATE' NOT NULL,
	"join_code" text,
	"max_members" integer DEFAULT 10 NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"features" jsonb DEFAULT '{"video":true,"chat":true,"whiteboard":true,"notes":true,"aiTutor":true,"pomodoro":true,"recording":false}'::jsonb NOT NULL,
	"livekit_room_name" text,
	"scheduled_start" timestamp,
	"scheduled_end" timestamp,
	"recurring_pattern" jsonb,
	"status" "room_status" DEFAULT 'IDLE' NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "room_event" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_member" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "room_member_role" DEFAULT 'MEMBER' NOT NULL,
	"status" "room_member_status" DEFAULT 'ACTIVE' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "room_message" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"type" text DEFAULT 'TEXT' NOT NULL,
	"metadata" jsonb,
	"reply_to_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_group" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_user_id" text NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "study_group_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "study_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "group_role" DEFAULT 'MEMBER' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plan_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"concept_id" text,
	"status" "study_plan_status" DEFAULT 'PENDING' NOT NULL,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" text PRIMARY KEY NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_activity_date" text,
	"achievements" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chunk_concept" ADD CONSTRAINT "chunk_concept_chunk_id_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_concept" ADD CONSTRAINT "chunk_concept_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_event" ADD CONSTRAINT "room_event_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_member" ADD CONSTRAINT "room_member_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_member" ADD CONSTRAINT "room_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_message" ADD CONSTRAINT "room_message_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_group" ADD CONSTRAINT "study_group_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_group_member" ADD CONSTRAINT "study_group_member_group_id_study_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."study_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_group_member" ADD CONSTRAINT "study_group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plan_item" ADD CONSTRAINT "study_plan_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plan_item" ADD CONSTRAINT "study_plan_item_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_concept_concept_idx" ON "chunk_concept" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "note_user_idx" ON "note" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "note_updated_idx" ON "note" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "recording_room_idx" ON "recording" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_owner_idx" ON "room" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "room_join_code_idx" ON "room" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "room_status_idx" ON "room" USING btree ("status");--> statement-breakpoint
CREATE INDEX "room_scheduled_idx" ON "room" USING btree ("scheduled_start");--> statement-breakpoint
CREATE INDEX "room_event_room_time_idx" ON "room_event" USING btree ("room_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "room_member_uniq" ON "room_member" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "room_member_user_idx" ON "room_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "room_member_status_idx" ON "room_member" USING btree ("room_id","status");--> statement-breakpoint
CREATE INDEX "room_message_room_time_idx" ON "room_message" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "study_group_invite_idx" ON "study_group" USING btree ("invite_code");--> statement-breakpoint
CREATE UNIQUE INDEX "study_group_member_uniq" ON "study_group_member" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "study_group_member_user_idx" ON "study_group_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "study_plan_user_status_idx" ON "study_plan_item" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "study_plan_due_idx" ON "study_plan_item" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "user_stats_xp_idx" ON "user_stats" USING btree ("xp");
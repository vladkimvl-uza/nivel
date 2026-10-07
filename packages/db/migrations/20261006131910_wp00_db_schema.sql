ALTER TABLE "sales"."leads" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "sales"."leads" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "sales"."leads" ADD COLUMN "contact_username" text;--> statement-breakpoint
ALTER TABLE "ops"."consents" ADD CONSTRAINT "consents_evidence_size_chk" CHECK ("ops"."consents"."evidence" is null or pg_column_size("ops"."consents"."evidence") <= 4096);--> statement-breakpoint
ALTER TABLE "ops"."files" ADD CONSTRAINT "files_kind_chk" CHECK ("ops"."files"."kind" ~ '^[a-z][a-z0-9_]{1,39}$');--> statement-breakpoint
ALTER TABLE "sales"."acts" ADD CONSTRAINT "acts_evidence_chk" CHECK ("sales"."acts"."signed_at" is null or "sales"."acts"."evidence" is not null);--> statement-breakpoint
ALTER TABLE "sales"."configurations" ADD CONSTRAINT "configurations_prefs_size_chk" CHECK ("sales"."configurations"."prefs" is null or pg_column_size("sales"."configurations"."prefs") <= 16384);--> statement-breakpoint
ALTER TABLE "sales"."configurations" ADD CONSTRAINT "configurations_room_size_chk" CHECK ("sales"."configurations"."room" is null or pg_column_size("sales"."configurations"."room") <= 16384);--> statement-breakpoint
ALTER TABLE "sales"."leads" ADD CONSTRAINT "leads_contact_phone_chk" CHECK ("sales"."leads"."contact_phone" is null or "sales"."leads"."contact_phone" ~ '^\+[1-9][0-9]{7,14}$');--> statement-breakpoint
ALTER TABLE "sales"."leads" ADD CONSTRAINT "leads_contact_name_chk" CHECK ("sales"."leads"."contact_name" is null or char_length("sales"."leads"."contact_name") <= 120);--> statement-breakpoint
ALTER TABLE "sales"."leads" ADD CONSTRAINT "leads_contact_username_chk" CHECK ("sales"."leads"."contact_username" is null or char_length("sales"."leads"."contact_username") <= 64);
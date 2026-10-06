CREATE TABLE "ai"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"channel" text NOT NULL,
	"lang" text NOT NULL,
	"model" text NOT NULL,
	"mode" text DEFAULT 'full' NOT NULL,
	"user_ref_hash" text,
	"configuration_id" uuid,
	"lead_id" uuid,
	"outcome" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"filter_hits" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL,
	CONSTRAINT "conversations_lang_chk" CHECK ("ai"."conversations"."lang" in ('uz', 'ru')),
	CONSTRAINT "conversations_mode_chk" CHECK ("ai"."conversations"."mode" in ('full', 'economy')),
	CONSTRAINT "conversations_outcome_chk" CHECK ("ai"."conversations"."outcome" in ('lead', 'escalated', 'abandoned', 'limit')),
	CONSTRAINT "conversations_cost_chk" CHECK ("ai"."conversations"."cost_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai"."messages" (
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"shown_text" text,
	"display_substitution" jsonb,
	"request_id" text,
	"usage" jsonb,
	"latency_ms" integer,
	"stop_reason" text,
	"tool_calls" jsonb,
	"guard_events" jsonb,
	CONSTRAINT "messages_conversation_id_seq_pk" PRIMARY KEY("conversation_id","seq"),
	CONSTRAINT "messages_role_chk" CHECK ("ai"."messages"."role" in ('user', 'assistant', 'tool')),
	CONSTRAINT "messages_seq_chk" CHECK ("ai"."messages"."seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai"."usage_daily" (
	"day" date NOT NULL,
	"model" text NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"conversations" integer DEFAULT 0 NOT NULL,
	"tokens" jsonb,
	CONSTRAINT "usage_daily_day_model_pk" PRIMARY KEY("day","model"),
	CONSTRAINT "usage_daily_cost_chk" CHECK ("ai"."usage_daily"."cost_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bot"."processed_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot"."sessions" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot"."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"topic" text NOT NULL,
	"consent_id" uuid,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "subscriptions_user_topic_key" UNIQUE("telegram_user_id","topic")
);
--> statement-breakpoint
CREATE TABLE "catalog"."analogs" (
	"product_id" uuid NOT NULL,
	"analog_product_id" uuid NOT NULL,
	CONSTRAINT "analogs_product_id_analog_product_id_pk" PRIMARY KEY("product_id","analog_product_id"),
	CONSTRAINT "analogs_not_self_chk" CHECK ("catalog"."analogs"."product_id" <> "catalog"."analogs"."analog_product_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."base_build_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"base_build_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"slot" text NOT NULL,
	"price_class_id" uuid,
	"product_id" uuid,
	"qty" integer DEFAULT 1 NOT NULL,
	"role" text DEFAULT 'support' NOT NULL,
	CONSTRAINT "base_build_items_one_ref_chk" CHECK (("catalog"."base_build_items"."price_class_id" is null) <> ("catalog"."base_build_items"."product_id" is null)),
	CONSTRAINT "base_build_items_qty_chk" CHECK ("catalog"."base_build_items"."qty" > 0),
	CONSTRAINT "base_build_items_role_chk" CHECK ("catalog"."base_build_items"."role" in ('primary', 'secondary', 'support'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."base_builds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task" text NOT NULL,
	"tier" text NOT NULL,
	"style" text NOT NULL,
	"variant" text DEFAULT 'base' NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"redirect_task" text,
	"explain" jsonb,
	"is_showcase" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "base_builds_cell_key" UNIQUE("task","tier","style","variant"),
	CONSTRAINT "base_builds_task_chk" CHECK ("catalog"."base_builds"."task" in ('gaming', 'streaming', 'design3d', 'programming', 'office')),
	CONSTRAINT "base_builds_tier_chk" CHECK ("catalog"."base_builds"."tier" in ('T1', 'T2', 'T3', 'T4')),
	CONSTRAINT "base_builds_style_chk" CHECK ("catalog"."base_builds"."style" in ('A', 'B')),
	CONSTRAINT "base_builds_variant_chk" CHECK ("catalog"."base_builds"."variant" in ('base', 'plus')),
	CONSTRAINT "base_builds_status_chk" CHECK ("catalog"."base_builds"."status" in ('offered', 'not_offered')),
	CONSTRAINT "base_builds_redirect_chk" CHECK ("catalog"."base_builds"."status" <> 'not_offered' or "catalog"."base_builds"."redirect_task" is not null)
);
--> statement-breakpoint
CREATE TABLE "catalog"."categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"category_group" text NOT NULL,
	"name" jsonb NOT NULL,
	"fee_group_default" text NOT NULL,
	"freshness_days" integer NOT NULL,
	"returnable_default" boolean NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_code_key" UNIQUE("code"),
	CONSTRAINT "categories_group_chk" CHECK ("catalog"."categories"."category_group" in ('pc', 'setup', 'service')),
	CONSTRAINT "categories_fee_group_chk" CHECK ("catalog"."categories"."fee_group_default" in ('pc', 'mount', 'outside_scale')),
	CONSTRAINT "categories_freshness_chk" CHECK ("catalog"."categories"."freshness_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog"."ladders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"steps" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "ladders_code_key" UNIQUE("code"),
	CONSTRAINT "ladders_code_chk" CHECK ("catalog"."ladders"."code" in ('gpu', 'cpu_am5', 'cpu_lga1700', 'ram', 'ssd'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."perf_facts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"price_class_id" uuid NOT NULL,
	"task" text NOT NULL,
	"metric" text NOT NULL,
	"value" text NOT NULL,
	"conditions" text,
	"source" text,
	"url" text,
	"fetched_at" timestamp with time zone,
	"entered_by" uuid,
	"published" boolean DEFAULT false NOT NULL,
	CONSTRAINT "perf_facts_task_chk" CHECK ("catalog"."perf_facts"."task" in ('gaming', 'streaming', 'design3d', 'programming', 'office')),
	CONSTRAINT "perf_facts_published_source_chk" CHECK (not "catalog"."perf_facts"."published" or ("catalog"."perf_facts"."source" is not null and "catalog"."perf_facts"."fetched_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "catalog"."price_classes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"category_code" text NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"ladder_code" text,
	"step" integer,
	"perf_class" jsonb,
	"manual_only" boolean DEFAULT false NOT NULL,
	CONSTRAINT "price_classes_key_key" UNIQUE("key"),
	CONSTRAINT "price_classes_ladder_step_chk" CHECK (("catalog"."price_classes"."ladder_code" is null) = ("catalog"."price_classes"."step" is null))
);
--> statement-breakpoint
CREATE TABLE "catalog"."products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"category_code" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"mpn" text,
	"ean" text,
	"price_class_id" uuid,
	"ladder_step" integer,
	"color_body" text DEFAULT 'other' NOT NULL,
	"lighting" text DEFAULT 'none' NOT NULL,
	"noise_dba" integer,
	"power_peak_w" integer,
	"power_typical_w" integer,
	"mfr_warranty_months" integer,
	"official_import" text DEFAULT 'unknown' NOT NULL,
	"mfr_url" text,
	"mfr_checked_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dims_mm" jsonb,
	"fee_group" text,
	"returnable" boolean,
	"manual_only" boolean DEFAULT false NOT NULL,
	"image_file_id" uuid,
	"description" jsonb,
	"created_by" uuid,
	"verified_by" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"spec_socket" text GENERATED ALWAYS AS (specs ->> 'socket') STORED,
	"spec_ram_type" text GENERATED ALWAYS AS (case when category_code = 'ram' then specs ->> 'type' else specs ->> 'ramType' end) STORED,
	"spec_form_factor" text GENERATED ALWAYS AS (specs ->> 'formFactor') STORED,
	CONSTRAINT "products_brand_mpn_key" UNIQUE("brand","mpn"),
	CONSTRAINT "products_status_chk" CHECK ("catalog"."products"."status" in ('draft', 'verified', 'retired')),
	CONSTRAINT "products_color_chk" CHECK ("catalog"."products"."color_body" in ('black', 'white', 'gray', 'other')),
	CONSTRAINT "products_lighting_chk" CHECK ("catalog"."products"."lighting" in ('none', 'rgb', 'argb')),
	CONSTRAINT "products_official_import_chk" CHECK ("catalog"."products"."official_import" in ('yes', 'no', 'unknown')),
	CONSTRAINT "products_fee_group_chk" CHECK ("catalog"."products"."fee_group" in ('pc', 'mount', 'outside_scale')),
	CONSTRAINT "products_specs_object_chk" CHECK (jsonb_typeof("catalog"."products"."specs") = 'object')
);
--> statement-breakpoint
CREATE TABLE "catalog"."rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"golden_run" jsonb,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_sets_version_key" UNIQUE("version"),
	CONSTRAINT "rule_sets_status_chk" CHECK ("catalog"."rule_sets"."status" in ('draft', 'published')),
	CONSTRAINT "rule_sets_published_chk" CHECK ("catalog"."rule_sets"."status" <> 'published' or "catalog"."rule_sets"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "content"."glossary" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"term_ru" text NOT NULL,
	"term_uz" text NOT NULL,
	"term_uz_new_latin" text,
	"note" text,
	CONSTRAINT "glossary_term_ru_key" UNIQUE("term_ru")
);
--> statement-breakpoint
CREATE TABLE "content"."hero_scene" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"poster_file_id" uuid,
	"video_720_file_id" uuid,
	"video_1080_file_id" uuid,
	"video_vertical_file_id" uuid,
	"frames" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text DEFAULT 'visualization' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hero_scene_label_chk" CHECK ("content"."hero_scene"."label" in ('visualization')),
	CONSTRAINT "hero_scene_frames_chk" CHECK (jsonb_typeof("content"."hero_scene"."frames") = 'array' and jsonb_array_length("content"."hero_scene"."frames") in (0, 5))
);
--> statement-breakpoint
CREATE TABLE "content"."idea_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instagram_url" text NOT NULL,
	"author_handle" text NOT NULL,
	"author_profile_url" text,
	"permission_status" text DEFAULT 'none' NOT NULL,
	"permission_file_id" uuid,
	"permission_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"takedown_due" timestamp with time zone,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pc_configuration_id" uuid,
	"setup_configuration_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"oembed_cache" jsonb,
	"indexable" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_posts_permission_chk" CHECK ("content"."idea_posts"."permission_status" in ('requested', 'granted', 'revoked', 'none')),
	CONSTRAINT "idea_posts_status_chk" CHECK ("content"."idea_posts"."status" in ('draft', 'published', 'hidden', 'takedown')),
	CONSTRAINT "idea_posts_published_chk" CHECK ("content"."idea_posts"."status" <> 'published' or "content"."idea_posts"."permission_status" = 'granted' or "content"."idea_posts"."is_demo"),
	CONSTRAINT "idea_posts_revoked_chk" CHECK ("content"."idea_posts"."permission_status" <> 'revoked' or ("content"."idea_posts"."revoked_at" is not null and "content"."idea_posts"."takedown_due" is not null))
);
--> statement-breakpoint
CREATE TABLE "content"."legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"lang" text NOT NULL,
	"body_md" text NOT NULL,
	"status" text DEFAULT 'stub' NOT NULL,
	"text_sha256" text NOT NULL,
	"effective_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_documents_kind_version_lang_key" UNIQUE("kind","version","lang"),
	CONSTRAINT "legal_documents_kind_chk" CHECK ("content"."legal_documents"."kind" in ('offer', 'privacy', 'warranty', 'returns', 'consent_pd', 'consent_ai', 'consent_marketing', 'consent_photo', 'stage_tariff', 'requisites', 'ai_how_it_works')),
	CONSTRAINT "legal_documents_lang_chk" CHECK ("content"."legal_documents"."lang" in ('uz', 'ru')),
	CONSTRAINT "legal_documents_status_chk" CHECK ("content"."legal_documents"."status" in ('stub', 'lawyer_approved', 'published')),
	CONSTRAINT "legal_documents_sha_chk" CHECK ("content"."legal_documents"."text_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legal_documents_published_chk" CHECK ("content"."legal_documents"."status" <> 'published' or "content"."legal_documents"."effective_from" is not null)
);
--> statement-breakpoint
CREATE TABLE "content"."pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"title" jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"noindex" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_slug_key" UNIQUE("slug"),
	CONSTRAINT "pages_kind_chk" CHECK ("content"."pages"."kind" in ('service', 'how', 'prices', 'faq', 'warranty')),
	CONSTRAINT "pages_status_chk" CHECK ("content"."pages"."status" in ('draft', 'published')),
	CONSTRAINT "pages_published_uz_chk" CHECK ("content"."pages"."status" <> 'published' or ("content"."pages"."title" ->> 'uz' <> '' and "content"."pages"."body" ->> 'uz' <> '' and "content"."pages"."published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "content"."policy_texts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"topic" text NOT NULL,
	"body" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'stub' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_texts_topic_version_key" UNIQUE("topic","version"),
	CONSTRAINT "policy_texts_topic_chk" CHECK ("content"."policy_texts"."topic" in ('payment', 'fee', 'warranty', 'returns', 'timelines', 'delivery', 'glossary', 'privacy_short', 'response_hours')),
	CONSTRAINT "policy_texts_status_chk" CHECK ("content"."policy_texts"."status" in ('stub', 'approved')),
	CONSTRAINT "policy_texts_version_chk" CHECK ("content"."policy_texts"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "content"."portfolio_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"publication_consent_id" uuid,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"caption" jsonb,
	"label" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_items_kind_chk" CHECK ("content"."portfolio_items"."kind" in ('own_build', 'concept')),
	CONSTRAINT "portfolio_items_label_chk" CHECK ("content"."portfolio_items"."label" in ('concept', 'visualization')),
	CONSTRAINT "portfolio_items_own_build_chk" CHECK ("content"."portfolio_items"."kind" <> 'own_build' or "content"."portfolio_items"."status" <> 'published' or ("content"."portfolio_items"."order_id" is not null and "content"."portfolio_items"."publication_consent_id" is not null)),
	CONSTRAINT "portfolio_items_concept_chk" CHECK ("content"."portfolio_items"."kind" <> 'concept' or "content"."portfolio_items"."label" is not null)
);
--> statement-breakpoint
CREATE TABLE "ops"."admin_sessions" (
	"token_sha256" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_hash" text,
	"ua" text,
	CONSTRAINT "admin_sessions_token_chk" CHECK ("ops"."admin_sessions"."token_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ops"."admin_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"role" text NOT NULL,
	"telegram_user_id" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_role_chk" CHECK ("ops"."admin_users"."role" in ('owner', 'assistant', 'translator', 'accountant'))
);
--> statement-breakpoint
CREATE TABLE "ops"."app_errors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"app" text NOT NULL,
	"fingerprint" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"count" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_errors_fingerprint_key" UNIQUE("app","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "ops"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "ops"."consents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid,
	"subject_ref_hash" text,
	"order_id" uuid,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"document_id" uuid,
	"text_sha256" text,
	"lang" text,
	"channel" text,
	"evidence" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_kind_chk" CHECK ("ops"."consents"."kind" in ('pd_processing', 'ai_transfer_us', 'marketing', 'photo_publication', 'supplier_data_transfer', 'age_18', 'analytics_cookies', 'limit_overrun', 'non_returnable', 'replacement', 'no_receipt_purchase', 'third_party_payer')),
	CONSTRAINT "consents_subject_chk" CHECK ("ops"."consents"."customer_id" is not null or "ops"."consents"."subject_ref_hash" is not null),
	CONSTRAINT "consents_order_scope_chk" CHECK ("ops"."consents"."kind" not in ('limit_overrun', 'non_returnable', 'replacement', 'no_receipt_purchase', 'third_party_payer') or "ops"."consents"."order_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "ops"."dsr_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"result_file_id" uuid,
	CONSTRAINT "dsr_requests_kind_chk" CHECK ("ops"."dsr_requests"."kind" in ('copy', 'rectify', 'erase')),
	CONSTRAINT "dsr_requests_status_chk" CHECK ("ops"."dsr_requests"."status" in ('open', 'in_progress', 'done', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "ops"."files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"contains_pd" boolean DEFAULT false NOT NULL,
	"retention_class" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "files_sha256_chk" CHECK ("ops"."files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_bytes_chk" CHECK ("ops"."files"."bytes" >= 0),
	CONSTRAINT "files_retention_chk" CHECK ("ops"."files"."retention_class" in ('lead_12m', 'order_warranty_plus_3y', 'tax_5y', 'ai_90d', 'media')),
	CONSTRAINT "files_public_no_pd_chk" CHECK (not ("ops"."files"."is_public" and "ops"."files"."contains_pd"))
);
--> statement-breakpoint
CREATE TABLE "ops"."number_counters" (
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_counters_kind_year_pk" PRIMARY KEY("kind","year"),
	CONSTRAINT "number_counters_kind_chk" CHECK ("ops"."number_counters"."kind" in ('L', 'NV', 'G'))
);
--> statement-breakpoint
CREATE TABLE "ops"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_kind_chk" CHECK ("ops"."outbox"."kind" in ('telegram_message', 'job')),
	CONSTRAINT "outbox_status_chk" CHECK ("ops"."outbox"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "ops"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."threshold_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"year" integer NOT NULL,
	"as_of" date NOT NULL,
	"deals_sum" bigint NOT NULL,
	"committed_sum" bigint NOT NULL,
	"limit_sum" bigint NOT NULL,
	"plan_cap_sum" bigint,
	"share_bp" integer NOT NULL,
	CONSTRAINT "threshold_snapshots_year_as_of_key" UNIQUE("year","as_of"),
	CONSTRAINT "threshold_snapshots_share_chk" CHECK ("ops"."threshold_snapshots"."share_bp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing"."fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ccy" text NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"nominal" integer DEFAULT 1 NOT NULL,
	"effective_date" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"diff" numeric(14, 4),
	CONSTRAINT "fx_rates_ccy_date_key" UNIQUE("ccy","effective_date"),
	CONSTRAINT "fx_rates_ccy_chk" CHECK ("pricing"."fx_rates"."ccy" in ('USD', 'EUR', 'RUB')),
	CONSTRAINT "fx_rates_source_chk" CHECK ("pricing"."fx_rates"."source" in ('cbu_json', 'cbu_xml', 'manual')),
	CONSTRAINT "fx_rates_rate_chk" CHECK ("pricing"."fx_rates"."rate" > 0 and "pricing"."fx_rates"."nominal" > 0)
);
--> statement-breakpoint
CREATE TABLE "pricing"."market_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"median_sum" bigint,
	"from_sum" bigint,
	"min_sum" bigint,
	"max_sum" bigint,
	"offers_n" integer DEFAULT 0 NOT NULL,
	"vendors_n" integer DEFAULT 0 NOT NULL,
	"max_age_days" integer,
	"confidence" text NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"input_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "market_prices_product_as_of_key" UNIQUE("product_id","as_of"),
	CONSTRAINT "market_prices_confidence_chk" CHECK ("pricing"."market_prices"."confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "market_prices_order_chk" CHECK ("pricing"."market_prices"."min_sum" is null or "pricing"."market_prices"."max_sum" is null or "pricing"."market_prices"."min_sum" <= "pricing"."market_prices"."max_sum"),
	CONSTRAINT "market_prices_median_chk" CHECK ("pricing"."market_prices"."median_sum" is null or "pricing"."market_prices"."median_sum" > 0),
	CONSTRAINT "market_prices_min_vendors_chk" CHECK ("pricing"."market_prices"."vendors_n" >= 3 or ("pricing"."market_prices"."median_sum" is null and "pricing"."market_prices"."confidence" = 'low')),
	CONSTRAINT "market_prices_high_chk" CHECK ("pricing"."market_prices"."confidence" <> 'high' or ("pricing"."market_prices"."vendors_n" >= 5 and "pricing"."market_prices"."max_age_days" is not null and "pricing"."market_prices"."max_age_days" <= 3))
);
--> statement-breakpoint
CREATE TABLE "pricing"."offers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"product_id" uuid,
	"vendor_sku" text NOT NULL,
	"raw_title" text NOT NULL,
	"mpn" text,
	"ean" text,
	"url" text,
	"condition" text DEFAULT 'new' NOT NULL,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"matched_by" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_vendor_sku_key" UNIQUE("vendor_id","vendor_sku"),
	CONSTRAINT "offers_condition_chk" CHECK ("pricing"."offers"."condition" in ('new', 'refurb', 'used')),
	CONSTRAINT "offers_match_status_chk" CHECK ("pricing"."offers"."match_status" in ('auto', 'manual', 'unmatched', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "pricing"."price_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"format" text NOT NULL,
	"file_id" uuid,
	"url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_matched" integer DEFAULT 0 NOT NULL,
	"rows_unmatched" integer DEFAULT 0 NOT NULL,
	"rows_error" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"actor" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "price_imports_format_chk" CHECK ("pricing"."price_imports"."format" in ('csv', 'gsheet_csv', 'xlsx', 'tg_post', 'manual')),
	CONSTRAINT "price_imports_status_chk" CHECK ("pricing"."price_imports"."status" in ('pending', 'preview', 'applied', 'failed')),
	CONSTRAINT "price_imports_rows_chk" CHECK ("pricing"."price_imports"."rows_matched" + "pricing"."price_imports"."rows_unmatched" + "pricing"."price_imports"."rows_error" <= "pricing"."price_imports"."rows_total")
);
--> statement-breakpoint
CREATE TABLE "pricing"."price_observations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"offer_id" uuid,
	"product_id" uuid,
	"vendor_id" uuid NOT NULL,
	"price_sum" bigint NOT NULL,
	"orig_amount" numeric(14, 2),
	"orig_currency" text DEFAULT 'UZS' NOT NULL,
	"fx_rate_id" uuid,
	"availability" text NOT NULL,
	"condition" text DEFAULT 'new' NOT NULL,
	"is_from_price" boolean DEFAULT false NOT NULL,
	"vendor_warranty_months" integer,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	"entered_by" text,
	"excluded" boolean DEFAULT false NOT NULL,
	"exclude_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "price_observations_price_chk" CHECK ("pricing"."price_observations"."price_sum" > 0),
	CONSTRAINT "price_observations_availability_chk" CHECK ("pricing"."price_observations"."availability" in ('in_stock', 'on_order', 'preorder', 'ask')),
	CONSTRAINT "price_observations_condition_chk" CHECK ("pricing"."price_observations"."condition" in ('new', 'refurb', 'used')),
	CONSTRAINT "price_observations_source_chk" CHECK ("pricing"."price_observations"."source" in ('partner_csv', 'partner_gsheet', 'partner_tg', 'manual', 'scrape')),
	CONSTRAINT "price_observations_currency_chk" CHECK ("pricing"."price_observations"."orig_currency" in ('UZS', 'USD')),
	CONSTRAINT "price_observations_reason_chk" CHECK ("pricing"."price_observations"."exclude_reason" in ('outlier', 'currency_error', 'stale', 'not_in_stock', 'from_price', 'private_seller', 'duplicate_vendor', 'used_or_refurb', 'manual')),
	CONSTRAINT "price_observations_excluded_chk" CHECK ("pricing"."price_observations"."excluded" = ("pricing"."price_observations"."exclude_reason" is not null)),
	CONSTRAINT "price_observations_usd_chk" CHECK ("pricing"."price_observations"."orig_currency" <> 'USD' or ("pricing"."price_observations"."orig_amount" is not null and "pricing"."price_observations"."fx_rate_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "pricing"."sku_mappings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"vendor_sku" text NOT NULL,
	"raw_title_normalized" text NOT NULL,
	"product_id" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "sku_mappings_vendor_sku_key" UNIQUE("vendor_id","vendor_sku")
);
--> statement-breakpoint
CREATE TABLE "pricing"."vendors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"site" text,
	"public_name_allowed" boolean DEFAULT false NOT NULL,
	"price_source" text NOT NULL,
	"sheet_csv_url" text,
	"terms_checked_at" timestamp with time zone,
	"issues_fiscal_receipt" boolean,
	"esf_available" boolean,
	"accepts_corp_card" boolean,
	"return_days" integer,
	"assembly_keeps_warranty" boolean,
	"accepts_claims_from_ip" boolean,
	"agreement_file_id" uuid,
	"contact" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_name_key" UNIQUE("name"),
	CONSTRAINT "vendors_kind_chk" CHECK ("pricing"."vendors"."kind" in ('partner', 'shop', 'marketplace_seller', 'private')),
	CONSTRAINT "vendors_price_source_chk" CHECK ("pricing"."vendors"."price_source" in ('partner_sheet', 'csv', 'telegram', 'manual', 'scrape_allowed')),
	CONSTRAINT "vendors_status_chk" CHECK ("pricing"."vendors"."status" in ('active', 'paused', 'archived')),
	CONSTRAINT "vendors_return_days_chk" CHECK ("pricing"."vendors"."return_days" is null or "pricing"."vendors"."return_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."acts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_via" text,
	"evidence" jsonb,
	"pdf_uz_file_id" uuid,
	"pdf_ru_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acts_kind_chk" CHECK ("sales"."acts"."kind" in ('material_acceptance', 'customer_parts', 'handover')),
	CONSTRAINT "acts_signed_via_chk" CHECK ("sales"."acts"."signed_via" in ('tg_button', 'paper_photo', 'site_button')),
	CONSTRAINT "acts_signed_chk" CHECK (("sales"."acts"."signed_at" is null) = ("sales"."acts"."signed_via" is null))
);
--> statement-breakpoint
CREATE TABLE "sales"."build_passports" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"serials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bios_version" text,
	"os" text,
	"tests" jsonb,
	"photos" jsonb,
	"seal_photos" jsonb,
	"label_code" text,
	"notes" text,
	"pdf_uz_file_id" uuid,
	"pdf_ru_file_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sales"."commission_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"received_sum" bigint NOT NULL,
	"spent_sum" bigint NOT NULL,
	"discounts_sum" bigint DEFAULT 0 NOT NULL,
	"remainder_sum" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"objection_until" timestamp with time zone,
	"objection" jsonb,
	"accepted_at" timestamp with time zone,
	"deemed_accepted_at" timestamp with time zone,
	"pdf_uz_file_id" uuid,
	"pdf_ru_file_id" uuid,
	CONSTRAINT "commission_reports_order_version_key" UNIQUE("order_id","version"),
	CONSTRAINT "commission_reports_sums_chk" CHECK ("sales"."commission_reports"."received_sum" - "sales"."commission_reports"."spent_sum" = "sales"."commission_reports"."remainder_sum"),
	CONSTRAINT "commission_reports_version_chk" CHECK ("sales"."commission_reports"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."configurations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"public_code" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"room" jsonb,
	"prefs" jsonb,
	"engine_version" text,
	"rule_set_version" integer,
	"price_snapshot" jsonb,
	"quote" jsonb,
	"compat" jsonb,
	"created_via" text NOT NULL,
	"idea_id" uuid,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configurations_public_code_key" UNIQUE("public_code"),
	CONSTRAINT "configurations_kind_chk" CHECK ("sales"."configurations"."kind" in ('pc', 'setup')),
	CONSTRAINT "configurations_code_chk" CHECK ("sales"."configurations"."public_code" ~ '^[A-Za-z0-9]{8}$'),
	CONSTRAINT "configurations_via_chk" CHECK ("sales"."configurations"."created_via" in ('web', 'tma', 'bot', 'ai', 'admin', 'idea')),
	CONSTRAINT "configurations_items_chk" CHECK (jsonb_typeof("sales"."configurations"."items") = 'array')
);
--> statement-breakpoint
CREATE TABLE "sales"."customer_secrets" (
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	CONSTRAINT "customer_secrets_customer_id_kind_pk" PRIMARY KEY("customer_id","kind"),
	CONSTRAINT "customer_secrets_kind_chk" CHECK ("sales"."customer_secrets"."kind" in ('passport_for_poa'))
);
--> statement-breakpoint
CREATE TABLE "sales"."customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"display_name" text,
	"phone_e164" text,
	"telegram_user_id" bigint,
	"telegram_username" text,
	"lang" text DEFAULT 'uz' NOT NULL,
	"district" text,
	"address" text,
	"age_18_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erased_at" timestamp with time zone,
	CONSTRAINT "customers_lang_chk" CHECK ("sales"."customers"."lang" in ('uz', 'ru')),
	CONSTRAINT "customers_phone_chk" CHECK ("sales"."customers"."phone_e164" is null or "sales"."customers"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "sales"."leads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid,
	"configuration_id" uuid,
	"channel" text NOT NULL,
	"utm" jsonb,
	"lang" text DEFAULT 'uz' NOT NULL,
	"district" text,
	"wanted_by" date,
	"scope" text NOT NULL,
	"budget_band" text,
	"comment" text,
	"status" text DEFAULT 'new' NOT NULL,
	"reject_reason" text,
	"tg_topic_id" bigint,
	"first_response_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_number_key" UNIQUE("number"),
	CONSTRAINT "leads_number_chk" CHECK ("sales"."leads"."number" ~ '^L-[0-9]{4}-[0-9]{4,}$'),
	CONSTRAINT "leads_status_chk" CHECK ("sales"."leads"."status" in ('new', 'in_review', 'converted', 'rejected', 'spam')),
	CONSTRAINT "leads_scope_chk" CHECK ("sales"."leads"."scope" in ('pc', 'pc_periph', 'setup', 'podbor')),
	CONSTRAINT "leads_lang_chk" CHECK ("sales"."leads"."lang" in ('uz', 'ru')),
	CONSTRAINT "leads_reject_chk" CHECK ("sales"."leads"."status" <> 'rejected' or "sales"."leads"."reject_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "sales"."loaner_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"serial" text,
	"status" text DEFAULT 'available' NOT NULL,
	"owner_cost_sum" bigint,
	CONSTRAINT "loaner_items_status_chk" CHECK ("sales"."loaner_items"."status" in ('available', 'issued', 'repair'))
);
--> statement-breakpoint
CREATE TABLE "sales"."order_events" (
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"event" jsonb NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"guard_snapshot" jsonb,
	CONSTRAINT "order_events_order_id_seq_pk" PRIMARY KEY("order_id","seq"),
	CONSTRAINT "order_events_actor_chk" CHECK ("sales"."order_events"."actor_kind" in ('system', 'customer', 'owner', 'assistant')),
	CONSTRAINT "order_events_from_chk" CHECK ("sales"."order_events"."from_status" in ('estimate_draft', 'estimate_sent', 'estimate_expired', 'accepted', 'purchasing', 'report_due', 'report_sent', 'settled', 'assembling', 'testing', 'ready', 'delivering', 'handed_over', 'closed', 'podbor_delivered', 'cancelling', 'cancelled')),
	CONSTRAINT "order_events_to_chk" CHECK ("sales"."order_events"."to_status" in ('estimate_draft', 'estimate_sent', 'estimate_expired', 'accepted', 'purchasing', 'report_due', 'report_sent', 'settled', 'assembling', 'testing', 'ready', 'delivering', 'handed_over', 'closed', 'podbor_delivered', 'cancelling', 'cancelled')),
	CONSTRAINT "order_events_seq_chk" CHECK ("sales"."order_events"."seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"lead_id" uuid,
	"customer_id" uuid NOT NULL,
	"contract_scheme" text DEFAULT 'commission' NOT NULL,
	"kind" text NOT NULL,
	"slot" text DEFAULT 'regular' NOT NULL,
	"complex_build" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'estimate_draft' NOT NULL,
	"fee_prepaid" boolean DEFAULT false NOT NULL,
	"funds_received" boolean DEFAULT false NOT NULL,
	"funds_received_at" timestamp with time zone,
	"purchase_not_before" timestamp with time zone,
	"first_order_meeting_done" boolean DEFAULT false NOT NULL,
	"current_quote_id" uuid,
	"offer_version_uz_id" uuid,
	"offer_version_ru_id" uuid,
	"accepted_at" timestamp with time zone,
	"report_due_at" timestamp with time zone,
	"objection_until" timestamp with time zone,
	"refund_due_at" timestamp with time zone,
	"handed_over_at" timestamp with time zone,
	"warranty_until" timestamp with time zone,
	"cancel" jsonb,
	"documented_losses_sum" bigint DEFAULT 0 NOT NULL,
	"podbor_credit_until" timestamp with time zone,
	"tg_topic_id" bigint,
	"assignee" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_key" UNIQUE("number"),
	CONSTRAINT "orders_number_chk" CHECK ("sales"."orders"."number" ~ '^NV-[0-9]{4}-[0-9]{4,}$'),
	CONSTRAINT "orders_scheme_chk" CHECK ("sales"."orders"."contract_scheme" in ('commission', 'agency')),
	CONSTRAINT "orders_scheme_not_sale_chk" CHECK ("sales"."orders"."contract_scheme" <> 'sale'),
	CONSTRAINT "orders_kind_chk" CHECK ("sales"."orders"."kind" in ('pc', 'setup', 'podbor', 'upgrade')),
	CONSTRAINT "orders_slot_chk" CHECK ("sales"."orders"."slot" in ('regular', 'free_window')),
	CONSTRAINT "orders_status_chk" CHECK ("sales"."orders"."status" in ('estimate_draft', 'estimate_sent', 'estimate_expired', 'accepted', 'purchasing', 'report_due', 'report_sent', 'settled', 'assembling', 'testing', 'ready', 'delivering', 'handed_over', 'closed', 'podbor_delivered', 'cancelling', 'cancelled')),
	CONSTRAINT "orders_losses_chk" CHECK ("sales"."orders"."documented_losses_sum" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."other_income" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"year" integer NOT NULL,
	"period" text NOT NULL,
	"amount_sum" bigint NOT NULL,
	"kind" text DEFAULT 'other_ip_activity' NOT NULL,
	"note" text,
	"entered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "other_income_kind_chk" CHECK ("sales"."other_income"."kind" in ('other_ip_activity')),
	CONSTRAINT "other_income_amount_chk" CHECK ("sales"."other_income"."amount_sum" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"method" text NOT NULL,
	"amount_sum" bigint NOT NULL,
	"status" text DEFAULT 'expected' NOT NULL,
	"fiscal_receipt_no" text,
	"bank_doc_no" text,
	"payer_is_customer" boolean DEFAULT true NOT NULL,
	"third_party_statement_file_id" uuid,
	"occurred_at" timestamp with time zone,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_kind_chk" CHECK ("sales"."payments"."kind" in ('fee_advance', 'fee_final', 'fee_extra', 'podbor_fee', 'purchase_funds', 'purchase_topup', 'remainder_refund', 'fee_refund', 'funds_refund')),
	CONSTRAINT "payments_direction_chk" CHECK ("sales"."payments"."direction" in ('in', 'out')),
	CONSTRAINT "payments_method_chk" CHECK ("sales"."payments"."method" in ('xolis_qr', 'merchant_card', 'bank_transfer_ip', 'bank_transfer_out')),
	CONSTRAINT "payments_status_chk" CHECK ("sales"."payments"."status" in ('expected', 'confirmed', 'void')),
	CONSTRAINT "payments_purchase_funds_chk" CHECK ("sales"."payments"."kind" not in ('purchase_funds', 'purchase_topup') or ("sales"."payments"."direction" = 'in' and "sales"."payments"."method" = 'bank_transfer_ip')),
	CONSTRAINT "payments_fee_chk" CHECK ("sales"."payments"."kind" not in ('fee_advance', 'fee_final', 'fee_extra', 'podbor_fee') or ("sales"."payments"."direction" = 'in' and "sales"."payments"."method" in ('xolis_qr', 'merchant_card') and ("sales"."payments"."status" <> 'confirmed' or coalesce(btrim("sales"."payments"."fiscal_receipt_no"), '') <> ''))),
	CONSTRAINT "payments_refund_chk" CHECK ("sales"."payments"."kind" not in ('remainder_refund', 'fee_refund', 'funds_refund') or ("sales"."payments"."direction" = 'out' and "sales"."payments"."method" = 'bank_transfer_out')),
	CONSTRAINT "payments_amount_chk" CHECK (("sales"."payments"."reversal_of" is null and "sales"."payments"."amount_sum" > 0) or ("sales"."payments"."reversal_of" is not null and "sales"."payments"."amount_sum" < 0)),
	CONSTRAINT "payments_confirmed_chk" CHECK ("sales"."payments"."status" <> 'confirmed' or ("sales"."payments"."confirmed_at" is not null and "sales"."payments"."confirmed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales"."purchase_files" (
	"purchase_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "purchase_files_purchase_id_file_id_pk" PRIMARY KEY("purchase_id","file_id"),
	CONSTRAINT "purchase_files_kind_chk" CHECK ("sales"."purchase_files"."kind" in ('receipt', 'box_serial', 'seal', 'warranty_card'))
);
--> statement-breakpoint
CREATE TABLE "sales"."purchases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"quote_line_id" uuid,
	"vendor_id" uuid NOT NULL,
	"product_id" uuid,
	"qty" integer NOT NULL,
	"amount_sum" bigint NOT NULL,
	"refund_of" uuid,
	"paid_via" text NOT NULL,
	"receipt_kind" text NOT NULL,
	"receipt_no" text,
	"esf_no" text,
	"esf_due" date,
	"esf_status" text,
	"discount_sum" bigint DEFAULT 0 NOT NULL,
	"bonus_note" text,
	"serials" text[],
	"vendor_warranty_months" integer,
	"vendor_warranty_until" date,
	"authenticity" jsonb,
	"bought_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bought_by" text NOT NULL,
	CONSTRAINT "purchases_paid_via_chk" CHECK ("sales"."purchases"."paid_via" in ('corp_card', 'bank_transfer')),
	CONSTRAINT "purchases_receipt_kind_chk" CHECK ("sales"."purchases"."receipt_kind" in ('fiscal', 'esf', 'none_with_consent')),
	CONSTRAINT "purchases_esf_status_chk" CHECK ("sales"."purchases"."esf_status" in ('pending', 'signed', 'rejected')),
	CONSTRAINT "purchases_qty_chk" CHECK ("sales"."purchases"."qty" > 0),
	CONSTRAINT "purchases_amount_chk" CHECK (("sales"."purchases"."refund_of" is null and "sales"."purchases"."amount_sum" > 0) or ("sales"."purchases"."refund_of" is not null and "sales"."purchases"."amount_sum" < 0)),
	CONSTRAINT "purchases_discount_chk" CHECK ("sales"."purchases"."discount_sum" >= 0),
	CONSTRAINT "purchases_fiscal_chk" CHECK ("sales"."purchases"."receipt_kind" <> 'fiscal' or "sales"."purchases"."receipt_no" is not null),
	CONSTRAINT "purchases_esf_chk" CHECK ("sales"."purchases"."receipt_kind" <> 'esf' or "sales"."purchases"."esf_status" is not null)
);
--> statement-breakpoint
CREATE TABLE "sales"."quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote_id" uuid NOT NULL,
	"product_id" uuid,
	"title_snapshot" text NOT NULL,
	"category_code" text NOT NULL,
	"fee_group" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_market_sum" bigint NOT NULL,
	"price_date" date,
	"confidence" text,
	"vendor_hint_id" uuid,
	"returnable" text DEFAULT 'unknown' NOT NULL,
	"is_ram_or_ssd" boolean DEFAULT false NOT NULL,
	"is_furniture_like" boolean DEFAULT false NOT NULL,
	"customer_owned" boolean DEFAULT false NOT NULL,
	"purchased_by_ip" boolean DEFAULT true NOT NULL,
	CONSTRAINT "quote_lines_qty_chk" CHECK ("sales"."quote_lines"."qty" > 0),
	CONSTRAINT "quote_lines_sum_chk" CHECK ("sales"."quote_lines"."unit_market_sum" >= 0),
	CONSTRAINT "quote_lines_fee_group_chk" CHECK ("sales"."quote_lines"."fee_group" in ('pc', 'mount', 'outside_scale')),
	CONSTRAINT "quote_lines_returnable_chk" CHECK ("sales"."quote_lines"."returnable" in ('yes', 'no', 'unknown')),
	CONSTRAINT "quote_lines_confidence_chk" CHECK ("sales"."quote_lines"."confidence" in ('high', 'medium', 'low'))
);
--> statement-breakpoint
CREATE TABLE "sales"."quotes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"totals" jsonb NOT NULL,
	"components_sum" bigint NOT NULL,
	"reserve_bp" integer NOT NULL,
	"reserve_sum" bigint NOT NULL,
	"purchase_limit" bigint NOT NULL,
	"fee_total" bigint NOT NULL,
	"fee_commission_line" bigint NOT NULL,
	"fee_works_line" bigint NOT NULL,
	"fee_advance" bigint NOT NULL,
	"fee_final" bigint NOT NULL,
	"outside_scale_sum" bigint DEFAULT 0 NOT NULL,
	"fx_rate_id" uuid,
	"settings_version" text NOT NULL,
	"manually_checked_by" uuid,
	"manually_checked_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"acceptance" jsonb,
	"watermark_draft" boolean DEFAULT false NOT NULL,
	"pdf_uz_file_id" uuid,
	"pdf_ru_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_order_version_key" UNIQUE("order_id","version"),
	CONSTRAINT "quotes_id_order_key" UNIQUE("id","order_id"),
	CONSTRAINT "quotes_status_chk" CHECK ("sales"."quotes"."status" in ('draft', 'sent', 'accepted', 'expired', 'superseded')),
	CONSTRAINT "quotes_version_chk" CHECK ("sales"."quotes"."version" > 0),
	CONSTRAINT "quotes_amounts_chk" CHECK (least("sales"."quotes"."components_sum", "sales"."quotes"."reserve_sum", "sales"."quotes"."purchase_limit", "sales"."quotes"."fee_total", "sales"."quotes"."fee_commission_line", "sales"."quotes"."fee_works_line", "sales"."quotes"."fee_advance", "sales"."quotes"."fee_final", "sales"."quotes"."outside_scale_sum") >= 0),
	CONSTRAINT "quotes_reserve_bp_chk" CHECK ("sales"."quotes"."reserve_bp" between 0 and 10000),
	CONSTRAINT "quotes_fee_split_chk" CHECK ("sales"."quotes"."fee_advance" + "sales"."quotes"."fee_final" = "sales"."quotes"."fee_total"),
	CONSTRAINT "quotes_fee_lines_chk" CHECK ("sales"."quotes"."fee_commission_line" + "sales"."quotes"."fee_works_line" = "sales"."quotes"."fee_total"),
	CONSTRAINT "quotes_limit_chk" CHECK ("sales"."quotes"."purchase_limit" >= "sales"."quotes"."reserve_sum"),
	CONSTRAINT "quotes_sent_chk" CHECK ("sales"."quotes"."status" not in ('sent', 'accepted') or ("sales"."quotes"."sent_at" is not null and "sales"."quotes"."manually_checked_by" is not null and "sales"."quotes"."manually_checked_at" is not null)),
	CONSTRAINT "quotes_accepted_chk" CHECK ("sales"."quotes"."status" <> 'accepted' or "sales"."quotes"."accepted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "sales"."reserve_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"fund" text NOT NULL,
	"order_id" uuid,
	"amount_sum" bigint NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reserve_ledger_fund_chk" CHECK ("sales"."reserve_ledger"."fund" in ('warranty', 'tax_risk')),
	CONSTRAINT "reserve_ledger_amount_chk" CHECK ("sales"."reserve_ledger"."amount_sum" <> 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."warranty_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"purchase_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text,
	"description" text NOT NULL,
	"due_reply" timestamp with time zone,
	"due_diagnosis" timestamp with time zone,
	"due_loaner" timestamp with time zone,
	"due_fix" timestamp with time zone,
	"loaner_item_id" uuid,
	"vendor_claim" jsonb,
	"cost_from_reserve_sum" bigint DEFAULT 0 NOT NULL,
	"client_fault" text,
	"status" text DEFAULT 'opened' NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "warranty_cases_number_key" UNIQUE("number"),
	CONSTRAINT "warranty_cases_number_chk" CHECK ("sales"."warranty_cases"."number" ~ '^G-[0-9]{4}-[0-9]{4,}$'),
	CONSTRAINT "warranty_cases_status_chk" CHECK ("sales"."warranty_cases"."status" in ('opened', 'diagnosing', 'loaner_issued', 'at_supplier', 'resolved', 'rejected', 'closed')),
	CONSTRAINT "warranty_cases_fault_chk" CHECK ("sales"."warranty_cases"."client_fault" in ('impact', 'liquid', 'overclocking', 'third_party_replacement')),
	CONSTRAINT "warranty_cases_rejected_chk" CHECK ("sales"."warranty_cases"."status" <> 'rejected' or "sales"."warranty_cases"."client_fault" is not null),
	CONSTRAINT "warranty_cases_cost_chk" CHECK ("sales"."warranty_cases"."cost_from_reserve_sum" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai"."conversations" ADD CONSTRAINT "conversations_configuration_id_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "sales"."configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "sales"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ai"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."subscriptions" ADD CONSTRAINT "subscriptions_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "ops"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."analogs" ADD CONSTRAINT "analogs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."analogs" ADD CONSTRAINT "analogs_analog_product_id_products_id_fk" FOREIGN KEY ("analog_product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."base_build_items" ADD CONSTRAINT "base_build_items_base_build_id_base_builds_id_fk" FOREIGN KEY ("base_build_id") REFERENCES "catalog"."base_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."base_build_items" ADD CONSTRAINT "base_build_items_price_class_id_price_classes_id_fk" FOREIGN KEY ("price_class_id") REFERENCES "catalog"."price_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."base_build_items" ADD CONSTRAINT "base_build_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."perf_facts" ADD CONSTRAINT "perf_facts_price_class_id_price_classes_id_fk" FOREIGN KEY ("price_class_id") REFERENCES "catalog"."price_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."perf_facts" ADD CONSTRAINT "perf_facts_entered_by_admin_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."price_classes" ADD CONSTRAINT "price_classes_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "catalog"."categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."price_classes" ADD CONSTRAINT "price_classes_ladder_code_ladders_code_fk" FOREIGN KEY ("ladder_code") REFERENCES "catalog"."ladders"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "catalog"."categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_price_class_id_price_classes_id_fk" FOREIGN KEY ("price_class_id") REFERENCES "catalog"."price_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_verified_by_admin_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."rule_sets" ADD CONSTRAINT "rule_sets_published_by_admin_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."hero_scene" ADD CONSTRAINT "hero_scene_poster_file_id_files_id_fk" FOREIGN KEY ("poster_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."hero_scene" ADD CONSTRAINT "hero_scene_video_720_file_id_files_id_fk" FOREIGN KEY ("video_720_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."hero_scene" ADD CONSTRAINT "hero_scene_video_1080_file_id_files_id_fk" FOREIGN KEY ("video_1080_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."hero_scene" ADD CONSTRAINT "hero_scene_video_vertical_file_id_files_id_fk" FOREIGN KEY ("video_vertical_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."hero_scene" ADD CONSTRAINT "hero_scene_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."idea_posts" ADD CONSTRAINT "idea_posts_permission_file_id_files_id_fk" FOREIGN KEY ("permission_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."idea_posts" ADD CONSTRAINT "idea_posts_pc_configuration_id_configurations_id_fk" FOREIGN KEY ("pc_configuration_id") REFERENCES "sales"."configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."idea_posts" ADD CONSTRAINT "idea_posts_setup_configuration_id_configurations_id_fk" FOREIGN KEY ("setup_configuration_id") REFERENCES "sales"."configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."portfolio_items" ADD CONSTRAINT "portfolio_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."portfolio_items" ADD CONSTRAINT "portfolio_items_publication_consent_id_consents_id_fk" FOREIGN KEY ("publication_consent_id") REFERENCES "ops"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "ops"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."consents" ADD CONSTRAINT "consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."consents" ADD CONSTRAINT "consents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."consents" ADD CONSTRAINT "consents_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "content"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."dsr_requests" ADD CONSTRAINT "dsr_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."dsr_requests" ADD CONSTRAINT "dsr_requests_result_file_id_files_id_fk" FOREIGN KEY ("result_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."market_prices" ADD CONSTRAINT "market_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."offers" ADD CONSTRAINT "offers_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "pricing"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."offers" ADD CONSTRAINT "offers_matched_by_admin_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_imports" ADD CONSTRAINT "price_imports_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "pricing"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_imports" ADD CONSTRAINT "price_imports_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_observations" ADD CONSTRAINT "price_observations_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "pricing"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_observations" ADD CONSTRAINT "price_observations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_observations" ADD CONSTRAINT "price_observations_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "pricing"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_observations" ADD CONSTRAINT "price_observations_fx_rate_id_fx_rates_id_fk" FOREIGN KEY ("fx_rate_id") REFERENCES "pricing"."fx_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_observations" ADD CONSTRAINT "price_observations_import_id_price_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "pricing"."price_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."sku_mappings" ADD CONSTRAINT "sku_mappings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "pricing"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."sku_mappings" ADD CONSTRAINT "sku_mappings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."sku_mappings" ADD CONSTRAINT "sku_mappings_confirmed_by_admin_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."vendors" ADD CONSTRAINT "vendors_agreement_file_id_files_id_fk" FOREIGN KEY ("agreement_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."acts" ADD CONSTRAINT "acts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."acts" ADD CONSTRAINT "acts_pdf_uz_file_id_files_id_fk" FOREIGN KEY ("pdf_uz_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."acts" ADD CONSTRAINT "acts_pdf_ru_file_id_files_id_fk" FOREIGN KEY ("pdf_ru_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."build_passports" ADD CONSTRAINT "build_passports_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."build_passports" ADD CONSTRAINT "build_passports_pdf_uz_file_id_files_id_fk" FOREIGN KEY ("pdf_uz_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."build_passports" ADD CONSTRAINT "build_passports_pdf_ru_file_id_files_id_fk" FOREIGN KEY ("pdf_ru_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."commission_reports" ADD CONSTRAINT "commission_reports_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."commission_reports" ADD CONSTRAINT "commission_reports_pdf_uz_file_id_files_id_fk" FOREIGN KEY ("pdf_uz_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."commission_reports" ADD CONSTRAINT "commission_reports_pdf_ru_file_id_files_id_fk" FOREIGN KEY ("pdf_ru_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."configurations" ADD CONSTRAINT "configurations_idea_id_idea_posts_id_fk" FOREIGN KEY ("idea_id") REFERENCES "content"."idea_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."configurations" ADD CONSTRAINT "configurations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."configurations" ADD CONSTRAINT "configurations_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "sales"."configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."customer_secrets" ADD CONSTRAINT "customer_secrets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."leads" ADD CONSTRAINT "leads_configuration_id_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "sales"."configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "sales"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_offer_version_uz_id_legal_documents_id_fk" FOREIGN KEY ("offer_version_uz_id") REFERENCES "content"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_offer_version_ru_id_legal_documents_id_fk" FOREIGN KEY ("offer_version_ru_id") REFERENCES "content"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_assignee_admin_users_id_fk" FOREIGN KEY ("assignee") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_current_quote_fk" FOREIGN KEY ("current_quote_id","id") REFERENCES "sales"."quotes"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."payments" ADD CONSTRAINT "payments_third_party_statement_file_id_files_id_fk" FOREIGN KEY ("third_party_statement_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."payments" ADD CONSTRAINT "payments_reversal_fk" FOREIGN KEY ("reversal_of") REFERENCES "sales"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."purchase_files" ADD CONSTRAINT "purchase_files_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "sales"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."purchase_files" ADD CONSTRAINT "purchase_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."purchases" ADD CONSTRAINT "purchases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."purchases" ADD CONSTRAINT "purchases_quote_line_id_quote_lines_id_fk" FOREIGN KEY ("quote_line_id") REFERENCES "sales"."quote_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."purchases" ADD CONSTRAINT "purchases_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "pricing"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."purchases" ADD CONSTRAINT "purchases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."purchases" ADD CONSTRAINT "purchases_refund_fk" FOREIGN KEY ("refund_of") REFERENCES "sales"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "sales"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quote_lines" ADD CONSTRAINT "quote_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quote_lines" ADD CONSTRAINT "quote_lines_vendor_hint_id_vendors_id_fk" FOREIGN KEY ("vendor_hint_id") REFERENCES "pricing"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quotes" ADD CONSTRAINT "quotes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quotes" ADD CONSTRAINT "quotes_fx_rate_id_fx_rates_id_fk" FOREIGN KEY ("fx_rate_id") REFERENCES "pricing"."fx_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quotes" ADD CONSTRAINT "quotes_manually_checked_by_admin_users_id_fk" FOREIGN KEY ("manually_checked_by") REFERENCES "ops"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quotes" ADD CONSTRAINT "quotes_pdf_uz_file_id_files_id_fk" FOREIGN KEY ("pdf_uz_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."quotes" ADD CONSTRAINT "quotes_pdf_ru_file_id_files_id_fk" FOREIGN KEY ("pdf_ru_file_id") REFERENCES "ops"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."reserve_ledger" ADD CONSTRAINT "reserve_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."warranty_cases" ADD CONSTRAINT "warranty_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sales"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."warranty_cases" ADD CONSTRAINT "warranty_cases_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "sales"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."warranty_cases" ADD CONSTRAINT "warranty_cases_loaner_item_id_loaner_items_id_fk" FOREIGN KEY ("loaner_item_id") REFERENCES "sales"."loaner_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_purge_idx" ON "ai"."conversations" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "processed_updates_at_idx" ON "bot"."processed_updates" USING btree ("at");--> statement-breakpoint
CREATE INDEX "base_build_items_build_idx" ON "catalog"."base_build_items" USING btree ("base_build_id");--> statement-breakpoint
CREATE INDEX "perf_facts_class_task_idx" ON "catalog"."perf_facts" USING btree ("price_class_id","task");--> statement-breakpoint
CREATE INDEX "price_classes_ladder_step_idx" ON "catalog"."price_classes" USING btree ("ladder_code","step");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_key" ON "catalog"."products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_category_status_idx" ON "catalog"."products" USING btree ("category_code","status");--> statement-breakpoint
CREATE INDEX "products_price_class_idx" ON "catalog"."products" USING btree ("price_class_id");--> statement-breakpoint
CREATE INDEX "products_spec_socket_idx" ON "catalog"."products" USING btree ("spec_socket");--> statement-breakpoint
CREATE INDEX "products_spec_ram_type_idx" ON "catalog"."products" USING btree ("spec_ram_type");--> statement-breakpoint
CREATE INDEX "products_spec_form_factor_idx" ON "catalog"."products" USING btree ("spec_form_factor");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_sets_one_published_idx" ON "catalog"."rule_sets" USING btree ("status") WHERE "catalog"."rule_sets"."status" = 'published';--> statement-breakpoint
CREATE INDEX "idea_posts_status_idx" ON "content"."idea_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "ops"."admin_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_idx" ON "ops"."admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_key" ON "ops"."admin_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "app_errors_last_idx" ON "ops"."app_errors" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "ops"."audit_log" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "ops"."audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "consents_order_kind_idx" ON "ops"."consents" USING btree ("order_id","kind","at");--> statement-breakpoint
CREATE INDEX "consents_customer_idx" ON "ops"."consents" USING btree ("customer_id","at");--> statement-breakpoint
CREATE INDEX "dsr_requests_status_due_idx" ON "ops"."dsr_requests" USING btree ("status","due");--> statement-breakpoint
CREATE INDEX "files_sha256_idx" ON "ops"."files" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_dedupe_key_idx" ON "ops"."outbox" USING btree ("dedupe_key") WHERE "ops"."outbox"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "ops"."outbox" USING btree ("status","send_after","priority");--> statement-breakpoint
CREATE INDEX "offers_product_idx" ON "pricing"."offers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "price_imports_vendor_started_idx" ON "pricing"."price_imports" USING btree ("vendor_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_observations_product_idx" ON "pricing"."price_observations" USING btree ("product_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_observations_offer_idx" ON "pricing"."price_observations" USING btree ("offer_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_observations_import_idx" ON "pricing"."price_observations" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "acts_order_kind_idx" ON "sales"."acts" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "configurations_customer_idx" ON "sales"."configurations" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_telegram_user_id_key" ON "sales"."customers" USING btree ("telegram_user_id") WHERE "sales"."customers"."telegram_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_e164_key" ON "sales"."customers" USING btree ("phone_e164") WHERE "sales"."customers"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "leads_status_created_idx" ON "sales"."leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "sales"."orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "sales"."orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "other_income_year_idx" ON "sales"."other_income" USING btree ("year");--> statement-breakpoint
CREATE INDEX "payments_order_kind_idx" ON "sales"."payments" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "purchases_order_idx" ON "sales"."purchases" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchases_esf_idx" ON "sales"."purchases" USING btree ("esf_status","esf_due");--> statement-breakpoint
CREATE INDEX "purchases_warranty_idx" ON "sales"."purchases" USING btree ("vendor_warranty_until");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "sales"."quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "reserve_ledger_fund_at_idx" ON "sales"."reserve_ledger" USING btree ("fund","at");--> statement-breakpoint
CREATE INDEX "warranty_cases_status_idx" ON "sales"."warranty_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "warranty_cases_order_idx" ON "sales"."warranty_cases" USING btree ("order_id");
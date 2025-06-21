CREATE TYPE "public"."read_status" AS ENUM('not_started', 'reading', 'finished');--> statement-breakpoint
CREATE TABLE "book" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"author" text,
	"isbn" text,
	"cover_image_url" text,
	"publisher" text,
	"publish_date" timestamp with time zone,
	"page_count" integer,
	"subjects" text[],
	"language" text,
	"open_library_work_id" text,
	"open_library_edition_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "book_collection" (
	"book_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "book_collection_book_id_collection_id_pk" PRIMARY KEY("book_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "borrower" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "borrower_user_name_unique_idx" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collection_user_name_unique_idx" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "lending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"lender_id" text NOT NULL,
	"borrower_id" uuid NOT NULL,
	"borrowed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"returned_at" timestamp with time zone,
	"is_currently_borrowed" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "read_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" "read_status" NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"rating" integer,
	"review" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "read_status_user_book_unique_idx" UNIQUE("user_id","book_id")
);
--> statement-breakpoint
ALTER TABLE "book" ADD CONSTRAINT "book_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_collection" ADD CONSTRAINT "book_collection_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_collection" ADD CONSTRAINT "book_collection_collection_id_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower" ADD CONSTRAINT "borrower_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lending" ADD CONSTRAINT "lending_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lending" ADD CONSTRAINT "lending_lender_id_user_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lending" ADD CONSTRAINT "lending_borrower_id_borrower_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."borrower"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_status" ADD CONSTRAINT "read_status_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_status" ADD CONSTRAINT "read_status_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_title_idx" ON "book" USING btree ("title");--> statement-breakpoint
CREATE INDEX "book_author_idx" ON "book" USING btree ("author");--> statement-breakpoint
CREATE INDEX "book_isbn_idx" ON "book" USING btree ("isbn");--> statement-breakpoint
CREATE INDEX "book_open_library_work_id_idx" ON "book" USING btree ("open_library_work_id");--> statement-breakpoint
CREATE INDEX "book_open_library_edition_id_idx" ON "book" USING btree ("open_library_edition_id");--> statement-breakpoint
CREATE INDEX "lending_book_id_idx" ON "lending" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "lending_borrower_id_idx" ON "lending" USING btree ("borrower_id");--> statement-breakpoint
CREATE INDEX "lending_lender_id_idx" ON "lending" USING btree ("lender_id");
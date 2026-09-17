CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "auth_subject" text NOT NULL UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "profiles" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "display_name" varchar(80) NOT NULL,
  "city" varchar(120) NOT NULL,
  "sport" varchar(40) NOT NULL,
  "level" varchar(40) NOT NULL,
  "birth_date" date,
  "bio" varchar(500),
  "latitude" double precision,
  "longitude" double precision,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "profiles_sport_city_idx" ON "profiles" ("sport", "city");
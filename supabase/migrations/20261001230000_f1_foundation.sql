-- PropBetEdge F1 canonical graph — DRAFT, NOT APPLIED.
-- Target: Supabase SPORTS (tkmlnhmylqnttmnsnief). Never the identity/billing project.
-- Mirrors data/normalized/* produced by src/core/{extract,assemble}.mjs. Source truth only;
-- derived intelligence (DNA, fit, matchups) lives in f1_derived_* with explicit versions.
-- Every material record carries source, source_id, source_url, source_updated_at, ingested_at.

begin;

create table if not exists public.f1_season (
  year int primary key,
  rounds int not null default 0,
  canceled int not null default 0,
  regulations_era text,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);

create table if not exists public.f1_circuit (
  id text primary key,                      -- wd-Q… when crosswalked to Wikidata, else espn-venue-N
  slug text not null unique,
  name text not null,
  wikidata_id text,
  locality text, country text,
  lat double precision, lon double precision,
  length_km numeric(6,3), turns int, layout_type text, opened int,
  espn_venue_ids text[] not null default '{}',
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);

create table if not exists public.f1_driver (
  id text primary key,                      -- espn-<athlete id>; provider ids are crosswalks, never merged by name
  espn_id text not null unique,
  slug text not null unique,
  full_name text not null, first_name text, last_name text, code text,
  date_of_birth date, nationality text,
  headshot_url text, flag_url text,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);

create table if not exists public.f1_constructor (
  id text primary key,                      -- season-range entity (e.g. toro-rosso, alphatauri, racing-bulls)
  slug text not null unique,
  name text not null,
  lineage_id text not null,                 -- franchise grouping (pbe_editorial)
  source_names text[] not null default '{}',
  first_season int, last_season int,
  identity_source text not null,            -- 'pbe_editorial' | 'espn_name'
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz
);

create table if not exists public.f1_driver_constructor_season (
  season int not null references public.f1_season(year),
  driver_id text not null references public.f1_driver(id),
  constructor_id text not null references public.f1_constructor(id),
  car_numbers text[] not null default '{}',
  race_starts int not null default 0,
  entries int not null default 0,
  primary key (season, driver_id, constructor_id)
);

create table if not exists public.f1_event (
  id text primary key,                      -- espn-<event id>
  season int not null references public.f1_season(year),
  round int,                                -- null when canceled
  name text not null, official_name text, slug text not null unique,
  circuit_id text references public.f1_circuit(id),
  start_utc timestamptz not null, end_utc timestamptz,
  status text not null check (status in ('scheduled','in_progress','live','completed','canceled','unknown')),
  format text not null, sprint boolean not null default false,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);
create index if not exists f1_event_season_idx on public.f1_event(season, round);

create table if not exists public.f1_session (
  id text primary key,
  event_id text not null references public.f1_event(id),
  season int not null,
  type text not null check (type in ('fp1','fp2','fp3','qualifying','sprint_qualifying','sprint','race')),
  start_utc timestamptz, time_valid boolean,
  state text not null, status_raw text, flag text,
  laps_scheduled int, distance_km numeric(7,3),
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);
create index if not exists f1_session_event_idx on public.f1_session(event_id);

create table if not exists public.f1_classification (
  id text primary key,
  session_id text not null references public.f1_session(id),
  event_id text not null references public.f1_event(id),
  season int not null,
  session_type text not null,
  driver_id text not null references public.f1_driver(id),
  constructor_id text references public.f1_constructor(id),
  constructor_name_raw text, team_color text, car_number text,
  position int, grid int,
  status text, status_raw text, race_participant boolean,
  laps int, time_text text, time_ms bigint, gap_text text, gap_ms bigint, behind_laps int,
  points numeric(6,2), points_scope text,   -- race rows: 'weekend_incl_sprint' at sprint events (as published)
  laps_led int, pit_stops int,
  fastest_lap_text text, fastest_lap_ms bigint, fastest_lap_number int,
  best_lap_ms bigint, q1_ms bigint, q2_ms bigint, q3_ms bigint,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);
create index if not exists f1_classification_driver_idx on public.f1_classification(driver_id, season);
create index if not exists f1_classification_session_idx on public.f1_classification(session_id);

create table if not exists public.f1_championship_standing (
  season int not null references public.f1_season(year),
  kind text not null check (kind in ('driver','constructor')),
  subject_id text not null,
  position int, points numeric(7,2), wins int, poles int, starts int,
  name_raw text,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null,
  primary key (season, kind, subject_id)
);

-- Tables in the model with NO licensed source today. Kept so lanes can land without schema churn.
create table if not exists public.f1_lap (
  session_id text not null references public.f1_session(id), driver_id text not null references public.f1_driver(id),
  lap int not null, lap_ms bigint, position int, s1_ms bigint, s2_ms bigint, s3_ms bigint, pit_in boolean, pit_out boolean,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null,
  primary key (session_id, driver_id, lap)
);
create table if not exists public.f1_stint (
  session_id text not null references public.f1_session(id), driver_id text not null references public.f1_driver(id),
  stint int not null, lap_start int, lap_end int, compound text, tyre_age_at_start int,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null,
  primary key (session_id, driver_id, stint)
);
create table if not exists public.f1_tyre_stint (like public.f1_stint including all);
create table if not exists public.f1_pit_stop (
  session_id text not null references public.f1_session(id), driver_id text not null references public.f1_driver(id),
  stop int not null, lap int, duration_ms bigint, lane_ms bigint,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null,
  primary key (session_id, driver_id, stop)
);
create table if not exists public.f1_weather (
  id bigserial primary key, event_id text references public.f1_event(id), session_id text references public.f1_session(id),
  observed_at timestamptz not null, kind text not null check (kind in ('observation','forecast')),
  air_temp_c numeric(5,2), track_temp_c numeric(5,2), humidity numeric(5,2), wind_ms numeric(5,2), wind_dir int, rainfall_mm numeric(6,2), conditions text,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);
create table if not exists public.f1_telemetry_reference (
  id bigserial primary key, session_id text references public.f1_session(id), driver_id text references public.f1_driver(id),
  kind text not null, uri text not null,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);
create table if not exists public.f1_penalty (
  id bigserial primary key, session_id text references public.f1_session(id), driver_id text references public.f1_driver(id),
  kind text not null, detail text, time_s numeric(6,2), grid_places int,
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);
create table if not exists public.f1_incident (
  id bigserial primary key, session_id text references public.f1_session(id), lap int, kind text not null, detail text, drivers text[],
  source text not null, source_id text not null, source_url text, source_updated_at timestamptz, ingested_at timestamptz not null
);

-- Derived intelligence (versioned, never mixed into source tables).
create table if not exists public.f1_derived_driver_dna (
  driver_id text not null references public.f1_driver(id), window_label text not null, version text not null, as_of timestamptz not null,
  dimensions jsonb not null, populated_dimensions int not null,
  primary key (driver_id, window_label, version)
);
create table if not exists public.f1_derived_constructor_dna (
  constructor_id text not null references public.f1_constructor(id), season int not null, version text not null, as_of timestamptz not null,
  dimensions jsonb not null, primary key (constructor_id, season, version)
);
create table if not exists public.f1_derived_circuit_dna (
  circuit_id text not null references public.f1_circuit(id), version text not null, as_of timestamptz not null,
  profile jsonb not null, dimensions jsonb not null, primary key (circuit_id, version)
);

-- Server-side only: RLS on, no client policies (Workers use the service role).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'f1\_%' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

commit;

# WEKONNEK database initialization

Production deployment has one path:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run build
pm2 restart all
```

`prisma/migrations` owns forward-only structure and historical data transitions. `prisma/seed.ts` owns repeatable production reference data. `prisma/seed-dev.ts` contains demo users, merchants, products, and posts and only runs through `npm run db:seed:dev`.

## Legacy SQL audit

| File | Classification | Deployment status |
| --- | --- | --- |
| `add-group-name-migration.sql` | A: adds `sub_categories.group_name` | Migrated to Prisma as `20260816070000_ensure_system_catalog_group_name`; legacy file is no longer deployed. |
| `category-seed-data.sql` | B: 10 global categories and their subcategories | Curated into `prisma/reference-data/catalog.sql` and run by the production seed. The seed scopes counts/lookups to `owner_merchant_id IS NULL` and refuses merchant-owned slug collisions. |
| `delivery-zones-migration.sql` | A+B: obsolete `delivery_zones`/`delivery_zone_areas` schema, RLS, function, and Metro Manila samples | D: incompatible with the current polygon-based `Zone` model and current Nest zone API. Do not execute. Its district/area reference is superseded by the NCR management coverage dataset; its sample coordinates are not valid delivery polygons. |
| `dummy-data.sql` | C: demo merchants, products, applications, promotions, orders, reservations, reviews | Development only; never production. |
| `dummy-users.sql` | C: Supabase test identities/profiles | Development only; never production. |
| `e-invoice-migration.sql` | A: destructive legacy invoice schema/RLS/functions (`DROP TABLE`) | D: incompatible with the current Prisma invoice models. Never execute against an existing database. |
| `fix-constraints.sql` | D: comments only | No action. |
| `phase4-5-completion.sql` | A plus a one-time product-category backfill | D: current Prisma schema/migrations supersede it. Do not replay. |
| `schema.sql` | A: early standalone schema | D: superseded by Prisma schema/migrations. |
| `set-user-roles.sql` | C/one-time operational updates tied to named demo emails | Development/manual repair only; never production seed. |
| `staff-posts-migration.sql` | A: legacy Supabase table/RLS | D: `StaffPost` is already in the Prisma-managed schema. |
| `supabase-migration.sql` | A: early Supabase schema/RLS/triggers | D: superseded and materially divergent from the current Prisma schema. |

No legacy SQL file is part of the server deployment procedure.

## Prisma migration audit

Every migration folder was reviewed. The following are schema-only/forward schema corrections and remain in migration history: `20260722060000`, `20260722080000`, `20260722110000`, `20260722130000`, `20260722140000`, `20260723100000`, `20260723150000`, `20260723170000`, `20260723180000`, `20260723200000`, `20260723210000`, `20260723220000`, `20260723230000`, `20260723233000`, `20260727111500`, `20260728120000`, `20260728150000`, `20260729120000`, `20260729130000`, `20260729140000`, `20260729150000`, `20260729180000`, `20260730000000`, `20260731000000`, `20260731020000`, `20260731030000`, `20260802000000`, `20260805000000`, `20260806010000`, `20260807000000`, `20260808000000`, `20260808010000`, `20260808020000`, `20260808030000`, `20260808040000`, `20260808042000`, `20260809090000`, `20260810174500`, `20260810193000`, `20260810203000`, `20260811170000`, `20260811190000`, `20260811210000`, `20260811230000`, `20260812090000`, `20260812110000`, `20260812130000`, `20260812170000`, `20260812190000`, `20260812210000`, `20260812220000`, `20260812230000`, `20260813000000`, `20260813020000`, and `20260813030000`.

These migrations contain intentional one-time data transitions/backfills and must remain historical rather than becoming repeatable seed behavior: `20260723220100`, `20260729160000`, `20260729170000`, `20260731010000`, `20260801040000`, `20260801050000`, `20260806000000`, `20260806020000`, `20260808041000`, `20260809070000`, `20260809110000`, `20260810193500`, `20260812200000`, `20260813010000`, and `20260814050000`.

The migrations that originally created merchant taxonomy, property types/plans, bazaar metadata, and the commission singleton already guarantee those records for databases deployed from migration history. The production seed additionally owns the mutable canonical catalog, NCR management coverage, and the non-destructive commission default.

The repository has no initial Prisma baseline migration for the original core tables; its migration history starts with additive changes. Existing environments that were baselined before these migrations can continue using `migrate deploy`, but a brand-new empty database cannot be created from this migration directory alone. Creating a baseline for fresh installations requires reconciling the deployed `_prisma_migrations` history first; it must not be retroactively inserted into an already deployed history.

## Important audit findings

- The former `prisma/seed.ts` was development data. It created credentialed users, sample merchants, products, and posts; product/post inserts duplicated on repeat runs. It is now `seed-dev.ts` and is never selected by Prisma automatically.
- Prisma 7 reads the seed command from `prisma.config.ts`. The project had only an npm alias, so `npx prisma db seed` was not configured to run it. `migrations.seed` now points to `tsx prisma/seed.ts`.
- Geographic cities/districts are not normalized database tables in the current schema. They are represented by stable PSGC codes and council-district coverage rows in `ManagementZoneCoverage`.
- The legacy delivery-zone SQL cannot safely populate the current `Zone` model because it contains labels and point samples, not valid boundary polygons. Creating fake polygons would change fee/routing behavior, so the audit deliberately does not import them.
- Subscription plan prices and add-on packages are admin-managed in the current application and no canonical definitions exist in legacy SQL or source control. The seed does not invent prices or overwrite live admin configuration. Counts expose local/server drift until approved defaults are supplied.

## Verification

Run this against local and production databases and compare the reference rows:

```bash
npm run db:reference:counts
```

Operational and merchant-owned row counts may differ. Global category counts explicitly exclude `ownerMerchantId != null`.

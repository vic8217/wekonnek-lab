ALTER TYPE "PropertySellerType" ADD VALUE IF NOT EXISTS 'AUTHORIZED_REPRESENTATIVE';
ALTER TYPE "PropertySellerType" ADD VALUE IF NOT EXISTS 'SALESPERSON';
ALTER TABLE "property_listings" ADD COLUMN "negotiable" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "minimum_lease_term_months" INTEGER, ADD COLUMN "security_deposit_months" INTEGER, ADD COLUMN "advance_rent_months" INTEGER, ADD COLUMN "association_dues_included" BOOLEAN, ADD COLUMN "utilities_included" BOOLEAN, ADD COLUMN "property_details" JSONB;

INSERT INTO "property_types" ("id","name","slug","group_name","display_order","updated_at") VALUES
('10000000-0000-4000-8000-000000000019','Industrial Property','industrial-property','Land & Other',2,NOW()),
('10000000-0000-4000-8000-000000000020','Industrial Lot','industrial-lot','Land & Other',3,NOW()),
('10000000-0000-4000-8000-000000000021','Raw / Vacant Land','raw-vacant-land','Land & Other',4,NOW()),
('10000000-0000-4000-8000-000000000022','Parking Space','parking-space','Land & Other',6,NOW()),
('10000000-0000-4000-8000-000000000023','Other Property','other-property','Land & Other',7,NOW())
ON CONFLICT ("slug") DO NOTHING;

UPDATE "property_listings" SET "property_type_id"='10000000-0000-4000-8000-000000000005' WHERE "property_type_id"='10000000-0000-4000-8000-000000000014';
UPDATE "property_listings" SET "property_type_id"='10000000-0000-4000-8000-000000000013' WHERE "property_type_id"='10000000-0000-4000-8000-000000000015';
UPDATE "property_listings" SET "property_type_id"='10000000-0000-4000-8000-000000000009' WHERE "property_type_id"='10000000-0000-4000-8000-000000000008';
UPDATE "property_listings" SET "property_type_id"='10000000-0000-4000-8000-000000000023' WHERE "property_type_id" IN ('10000000-0000-4000-8000-000000000017','10000000-0000-4000-8000-000000000018');

UPDATE "property_types" SET "name"='Retail / Commercial Space', "slug"='retail-commercial-space', "group_name"='Commercial', "display_order"=2 WHERE "id"='10000000-0000-4000-8000-000000000009';
UPDATE "property_types" SET "name"='Warehouse', "slug"='warehouse', "group_name"='Commercial', "display_order"=3 WHERE "id"='10000000-0000-4000-8000-000000000011';
UPDATE "property_types" SET "name"='Resort / Leisure Property', "slug"='resort-leisure-property', "group_name"='Land & Other', "display_order"=5 WHERE "id"='10000000-0000-4000-8000-000000000007';
UPDATE "property_types" SET "group_name"='Land & Other', "display_order"=1 WHERE "id"='10000000-0000-4000-8000-000000000016';
UPDATE "property_types" SET "is_active"=false WHERE "id" IN ('10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000017','10000000-0000-4000-8000-000000000018');

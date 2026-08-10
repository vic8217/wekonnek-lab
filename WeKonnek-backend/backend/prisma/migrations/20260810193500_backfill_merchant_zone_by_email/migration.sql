UPDATE "merchants" AS merchant
SET
  "region" = coverage."region_name",
  "city" = coverage."city_municipality_name",
  "council_district" = application."council_district",
  "geographic_area" = COALESCE(application."geographic_area", application."barangay")
FROM "merchant_applications" AS application
LEFT JOIN "management_zone_coverages" AS coverage
  ON lower(regexp_replace(coverage."city_municipality_name", '^(City of |Municipality of )', '', 'i')) =
     lower(regexp_replace(application."city_municipality", '^(City of |Municipality of )', '', 'i'))
 AND (application."council_district" IS NULL OR lower(coverage."congressional_district") = lower(application."council_district"))
WHERE application."status" = 'approved'
  AND (
    merchant."user_id" = application."user_id"
    OR lower(merchant."email") = lower(application."email")
  );

UPDATE "branches" AS branch
SET
  "region" = merchant."region",
  "city" = merchant."city",
  "council_district" = merchant."council_district",
  "geographic_area" = merchant."geographic_area"
FROM "merchants" AS merchant
WHERE branch."merchant_id" = merchant."id";

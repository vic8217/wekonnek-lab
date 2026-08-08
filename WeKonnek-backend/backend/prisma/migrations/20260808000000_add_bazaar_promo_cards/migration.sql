CREATE TABLE "bazaar_promo_cards" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "subtitle" TEXT NOT NULL,
  "cta_heading" TEXT NOT NULL DEFAULT 'Start Selling Today',
  "cta_text" TEXT NOT NULL DEFAULT 'Post your products and connect with local buyers.',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "bazaar_promo_cards" ("title", "subtitle", "display_order") VALUES
('Sell on WEKONNEK Bazaar', 'Turn your products into extra income.', 0),
('Sell Homemade Food', 'Reach nearby customers for only ₱15.', 1),
('Selling in Facebook or Viber?', 'Keep your products searchable for 7 days on WEKONNEK.', 2),
('Garage Sale?', 'Post preloved items and connect with buyers in your community.', 3),
('Home-Based Business?', 'Create your digital storefront in minutes.', 4);

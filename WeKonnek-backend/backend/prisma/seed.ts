import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

const rawUrl = process.env.DATABASE_URL ?? '';
const connectionString = rawUrl.replace(/[?&]sslmode=[^&]*/g, '');
const pool = new Pool({
  connectionString,
  ssl: rawUrl.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // ─── Categories ───────────────────────────────
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'food-beverages' },
      update: {},
      create: {
        name: 'Food & Beverages',
        slug: 'food-beverages',
        description: 'Restaurants, cafes, food stalls, and beverage shops',
        icon: '🍔',
        isActive: true,
        displayOrder: 1,
      },
    }),
    prisma.category.upsert({
      where: { slug: 'groceries' },
      update: {},
      create: {
        name: 'Groceries',
        slug: 'groceries',
        description: 'Supermarkets, sari-sari stores, and wet markets',
        icon: '🛒',
        isActive: true,
        displayOrder: 2,
      },
    }),
    prisma.category.upsert({
      where: { slug: 'services' },
      update: {},
      create: {
        name: 'Services',
        slug: 'services',
        description: 'Laundry, repair, beauty, and professional services',
        icon: '🔧',
        isActive: true,
        displayOrder: 3,
      },
    }),
    prisma.category.upsert({
      where: { slug: 'retail-shopping' },
      update: {},
      create: {
        name: 'Retail & Shopping',
        slug: 'retail-shopping',
        description: 'Clothing, electronics, hardware, and general merchandise',
        icon: '🛍️',
        isActive: true,
        displayOrder: 4,
      },
    }),
    prisma.category.upsert({
      where: { slug: 'health-wellness' },
      update: {},
      create: {
        name: 'Health & Wellness',
        slug: 'health-wellness',
        description: 'Pharmacies, clinics, gyms, and wellness centers',
        icon: '💊',
        isActive: true,
        displayOrder: 5,
      },
    }),
    prisma.category.upsert({
      where: { slug: 'property' },
      update: {
        name: 'Property',
        description: 'Homes, condominiums, lots and commercial spaces for sale or rent',
        icon: '🏠',
        isActive: true,
        displayOrder: 6,
        ownerMerchantId: null,
      },
      create: {
        name: 'Property',
        slug: 'property',
        description: 'Homes, condominiums, lots and commercial spaces for sale or rent',
        icon: '🏠',
        isActive: true,
        displayOrder: 6,
        ownerMerchantId: null,
      },
    }),
  ]);

  console.log(`  ✓ ${categories.length} categories`);

  // ─── Sub-Categories ───────────────────────────
  const foodCat = categories[0];
  const groceryCat = categories[1];
  const servicesCat = categories[2];

  const subCategories = await Promise.all([
    prisma.subCategory.upsert({
      where: { id: 1 },
      update: {},
      create: { categoryId: foodCat.id, name: 'Filipino Cuisine', slug: 'filipino-cuisine', icon: '🇵🇭', displayOrder: 1 },
    }),
    prisma.subCategory.upsert({
      where: { id: 2 },
      update: {},
      create: { categoryId: foodCat.id, name: 'Coffee & Tea', slug: 'coffee-tea', icon: '☕', displayOrder: 2 },
    }),
    prisma.subCategory.upsert({
      where: { id: 3 },
      update: {},
      create: { categoryId: foodCat.id, name: 'Street Food', slug: 'street-food', icon: '🍢', displayOrder: 3 },
    }),
    prisma.subCategory.upsert({
      where: { id: 4 },
      update: {},
      create: { categoryId: groceryCat.id, name: 'Fresh Produce', slug: 'fresh-produce', icon: '🥬', displayOrder: 1 },
    }),
    prisma.subCategory.upsert({
      where: { id: 5 },
      update: {},
      create: { categoryId: groceryCat.id, name: 'Sari-Sari Store', slug: 'sari-sari-store', icon: '🏪', displayOrder: 2 },
    }),
    prisma.subCategory.upsert({
      where: { id: 6 },
      update: {},
      create: { categoryId: servicesCat.id, name: 'Laundry', slug: 'laundry', icon: '👕', displayOrder: 1 },
    }),
    prisma.subCategory.upsert({
      where: { id: 7 },
      update: {},
      create: { categoryId: servicesCat.id, name: 'Salon & Barbershop', slug: 'salon-barbershop', icon: '💇', displayOrder: 2 },
    }),
  ]);

  console.log(`  ✓ ${subCategories.length} sub-categories`);

  // ─── Merchant Taxonomy ────────────────────────
  // Merchant business classifications are intentionally separate from the
  // general catalogue taxonomy seeded above.
  const [merchantFoodCat, merchantGroceryCat, merchantServicesCat] = await Promise.all([
    prisma.merchantCategory.upsert({
      where: { slug: 'food-beverages' },
      update: { name: 'Food & Beverages', isActive: true, displayOrder: 1 },
      create: {
        name: 'Food & Beverages',
        slug: 'food-beverages',
        description: 'Restaurants, cafes, food stalls, and beverage shops',
        icon: '🍔',
        isActive: true,
        displayOrder: 1,
      },
    }),
    prisma.merchantCategory.upsert({
      where: { slug: 'groceries' },
      update: { name: 'Groceries', isActive: true, displayOrder: 2 },
      create: {
        name: 'Groceries',
        slug: 'groceries',
        description: 'Supermarkets, sari-sari stores, and wet markets',
        icon: '🛒',
        isActive: true,
        displayOrder: 2,
      },
    }),
    prisma.merchantCategory.upsert({
      where: { slug: 'services' },
      update: { name: 'Services', isActive: true, displayOrder: 3 },
      create: {
        name: 'Services',
        slug: 'services',
        description: 'Laundry, repair, beauty, and professional services',
        icon: '🔧',
        isActive: true,
        displayOrder: 3,
      },
    }),
  ]);

  const [merchantFilipinoCuisine, merchantCoffeeTea, merchantStreetFood, merchantSariSari, merchantLaundry] = await Promise.all([
    prisma.merchantSubCategory.upsert({
      where: { categoryId_slug: { categoryId: merchantFoodCat.id, slug: 'filipino-cuisine' } },
      update: { name: 'Filipino Cuisine', isActive: true, displayOrder: 1 },
      create: { categoryId: merchantFoodCat.id, name: 'Filipino Cuisine', slug: 'filipino-cuisine', isActive: true, displayOrder: 1 },
    }),
    prisma.merchantSubCategory.upsert({
      where: { categoryId_slug: { categoryId: merchantFoodCat.id, slug: 'coffee-tea' } },
      update: { name: 'Coffee & Tea', isActive: true, displayOrder: 2 },
      create: { categoryId: merchantFoodCat.id, name: 'Coffee & Tea', slug: 'coffee-tea', isActive: true, displayOrder: 2 },
    }),
    prisma.merchantSubCategory.upsert({
      where: { categoryId_slug: { categoryId: merchantFoodCat.id, slug: 'street-food' } },
      update: { name: 'Street Food', isActive: true, displayOrder: 3 },
      create: { categoryId: merchantFoodCat.id, name: 'Street Food', slug: 'street-food', isActive: true, displayOrder: 3 },
    }),
    prisma.merchantSubCategory.upsert({
      where: { categoryId_slug: { categoryId: merchantGroceryCat.id, slug: 'sari-sari-store' } },
      update: { name: 'Sari-Sari Store', isActive: true, displayOrder: 1 },
      create: { categoryId: merchantGroceryCat.id, name: 'Sari-Sari Store', slug: 'sari-sari-store', isActive: true, displayOrder: 1 },
    }),
    prisma.merchantSubCategory.upsert({
      where: { categoryId_slug: { categoryId: merchantServicesCat.id, slug: 'laundry' } },
      update: { name: 'Laundry', isActive: true, displayOrder: 1 },
      create: { categoryId: merchantServicesCat.id, name: 'Laundry', slug: 'laundry', isActive: true, displayOrder: 1 },
    }),
  ]);

  console.log('  ✓ 3 merchant categories');
  console.log('  ✓ 5 merchant sub-categories');

  // ─── Merchants ────────────────────────────────
  const merchants = await Promise.all([
    prisma.merchant.upsert({
      where: { slug: 'mang-inasal-downtown' },
      update: { categoryId: merchantFoodCat.id, subCategoryId: merchantFilipinoCuisine.id },
      create: {
        name: "Mang Inasal Downtown",
        slug: 'mang-inasal-downtown',
        description: 'Authentic Filipino grilled chicken and unlimited rice',
        categoryId: merchantFoodCat.id,
        subCategoryId: merchantFilipinoCuisine.id,
        businessType: 'storefront',
        phone: '+639171234567',
        email: 'manginasal@example.com',
        address: '123 Main St, Iloilo City',
        latitude: 10.6920,
        longitude: 122.5640,
        city: 'Iloilo City',
        state: 'Iloilo',
        country: 'PH',
        isActive: true,
        isVerified: true,
        rating: 4.5,
        totalReviews: 128,
      },
    }),
    prisma.merchant.upsert({
      where: { slug: 'brew-haven-cafe' },
      update: { categoryId: merchantFoodCat.id, subCategoryId: merchantCoffeeTea.id },
      create: {
        name: 'Brew Haven Cafe',
        slug: 'brew-haven-cafe',
        description: 'Specialty coffee and artisan pastries',
        categoryId: merchantFoodCat.id,
        subCategoryId: merchantCoffeeTea.id,
        businessType: 'storefront',
        phone: '+639182345678',
        email: 'brewhaven@example.com',
        address: '45 Rizal Ave, Iloilo City',
        latitude: 10.6950,
        longitude: 122.5680,
        city: 'Iloilo City',
        state: 'Iloilo',
        country: 'PH',
        isActive: true,
        isVerified: true,
        rating: 4.8,
        totalReviews: 85,
      },
    }),
    prisma.merchant.upsert({
      where: { slug: 'aling-nena-sari-sari' },
      update: { categoryId: merchantGroceryCat.id, subCategoryId: merchantSariSari.id },
      create: {
        name: "Aling Nena's Sari-Sari Store",
        slug: 'aling-nena-sari-sari',
        description: 'Your neighborhood sari-sari store with everyday essentials',
        categoryId: merchantGroceryCat.id,
        subCategoryId: merchantSariSari.id,
        businessType: 'storefront',
        phone: '+639193456789',
        address: '78 Barangay St, Iloilo City',
        latitude: 10.6880,
        longitude: 122.5600,
        city: 'Iloilo City',
        state: 'Iloilo',
        country: 'PH',
        isActive: true,
        isVerified: false,
        rating: 4.2,
        totalReviews: 42,
      },
    }),
    prisma.merchant.upsert({
      where: { slug: 'kuya-boy-bbq' },
      update: { categoryId: merchantFoodCat.id, subCategoryId: merchantStreetFood.id },
      create: {
        name: "Kuya Boy's BBQ",
        slug: 'kuya-boy-bbq',
        description: 'Best street-style BBQ and isaw in town',
        categoryId: merchantFoodCat.id,
        subCategoryId: merchantStreetFood.id,
        businessType: 'mobile_cart',
        phone: '+639204567890',
        address: 'Near SM City, Mandurriao',
        latitude: 10.7100,
        longitude: 122.5500,
        city: 'Iloilo City',
        state: 'Iloilo',
        country: 'PH',
        isActive: true,
        isVerified: false,
        rating: 4.6,
        totalReviews: 210,
      },
    }),
    prisma.merchant.upsert({
      where: { slug: 'clean-express-laundry' },
      update: { categoryId: merchantServicesCat.id, subCategoryId: merchantLaundry.id },
      create: {
        name: 'Clean Express Laundry',
        slug: 'clean-express-laundry',
        description: 'Fast and affordable laundry service with pickup & delivery',
        categoryId: merchantServicesCat.id,
        subCategoryId: merchantLaundry.id,
        businessType: 'storefront',
        phone: '+639215678901',
        email: 'cleanexpress@example.com',
        address: '200 Lopez Jaena St, Jaro',
        latitude: 10.7200,
        longitude: 122.5720,
        city: 'Iloilo City',
        state: 'Iloilo',
        country: 'PH',
        isActive: true,
        isVerified: true,
        rating: 4.3,
        totalReviews: 67,
      },
    }),
  ]);

  console.log(`  ✓ ${merchants.length} merchants`);

  // ─── Products ─────────────────────────────────
  const products = await Promise.all([
    prisma.product.create({
      data: {
        merchantId: merchants[0].id,
        name: 'Chicken Inasal (Paa)',
        description: 'Grilled chicken leg with unlimited rice',
        productCode: 'MI-001',
        sku: 'INASAL-PAA',
        price: 149.00,
        quantity: 100,
        isAvailable: true,
        categoryId: foodCat.id,
        subCategoryId: subCategories[0].id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[0].id,
        name: 'Chicken Inasal (Pecho)',
        description: 'Grilled chicken breast with unlimited rice',
        productCode: 'MI-002',
        sku: 'INASAL-PECHO',
        price: 169.00,
        quantity: 80,
        isAvailable: true,
        categoryId: foodCat.id,
        subCategoryId: subCategories[0].id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[0].id,
        name: 'Bangus Sisig',
        description: 'Sizzling bangus sisig',
        productCode: 'MI-003',
        price: 129.00,
        quantity: 50,
        isAvailable: true,
        categoryId: foodCat.id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[1].id,
        name: 'Iced Americano',
        description: 'Double shot espresso over ice',
        productCode: 'BH-001',
        sku: 'COFFEE-AMER',
        price: 120.00,
        quantity: 200,
        isAvailable: true,
        categoryId: foodCat.id,
        subCategoryId: subCategories[1].id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[1].id,
        name: 'Matcha Latte',
        description: 'Premium matcha with steamed milk',
        productCode: 'BH-002',
        price: 150.00,
        quantity: 150,
        isAvailable: true,
        categoryId: foodCat.id,
        subCategoryId: subCategories[1].id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[1].id,
        name: 'Croissant',
        description: 'Freshly baked butter croissant',
        productCode: 'BH-003',
        price: 85.00,
        quantity: 30,
        isAvailable: true,
        categoryId: foodCat.id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[2].id,
        name: 'Lucky Me Pancit Canton',
        description: 'Instant pancit canton noodles',
        productCode: 'AN-001',
        price: 12.00,
        quantity: 500,
        isAvailable: true,
        categoryId: groceryCat.id,
        subCategoryId: subCategories[4].id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[2].id,
        name: 'Coca-Cola Mismo',
        description: '295ml Coca-Cola bottle',
        productCode: 'AN-002',
        price: 15.00,
        quantity: 300,
        isAvailable: true,
        categoryId: groceryCat.id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[3].id,
        name: 'Pork BBQ (3 sticks)',
        description: 'Sweet Filipino-style pork BBQ',
        productCode: 'KB-001',
        price: 45.00,
        quantity: 200,
        isAvailable: true,
        categoryId: foodCat.id,
        subCategoryId: subCategories[2].id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[3].id,
        name: 'Chicken Isaw (5 sticks)',
        description: 'Grilled chicken intestine',
        productCode: 'KB-002',
        price: 50.00,
        quantity: 150,
        isAvailable: true,
        categoryId: foodCat.id,
        subCategoryId: subCategories[2].id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[4].id,
        name: 'Regular Wash (8kg)',
        description: 'Wash, dry, and fold — up to 8kg',
        productCode: 'CE-001',
        price: 65.00,
        quantity: 999,
        isAvailable: true,
        categoryId: servicesCat.id,
        subCategoryId: subCategories[5].id,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchants[4].id,
        name: 'Premium Wash (8kg)',
        description: 'Delicate wash with fabric softener',
        productCode: 'CE-002',
        price: 95.00,
        quantity: 999,
        isAvailable: true,
        categoryId: servicesCat.id,
        subCategoryId: subCategories[5].id,
      },
    }),
  ]);

  console.log(`  ✓ ${products.length} products`);

  // ─── Staff Posts ───────────────────────────────
  const posts = await Promise.all([
    prisma.staffPost.create({
      data: {
        merchantId: merchants[0].id,
        title: 'Grand Opening Promo!',
        description: 'Get 20% off on all chicken meals this weekend! Valid June 1-7, 2026.',
        categoryTag: 'promo',
        categoryId: foodCat.id,
        latitude: 10.6920,
        longitude: 122.5640,
        isActive: true,
        expiresAt: new Date('2026-07-01'),
      },
    }),
    prisma.staffPost.create({
      data: {
        merchantId: merchants[1].id,
        title: 'New Menu: Summer Drinks',
        description: 'Try our new Mango Smoothie and Ube Latte — available starting today!',
        categoryTag: 'announcement',
        categoryId: foodCat.id,
        latitude: 10.6950,
        longitude: 122.5680,
        isActive: true,
        expiresAt: new Date('2026-08-31'),
      },
    }),
    prisma.staffPost.create({
      data: {
        merchantId: merchants[4].id,
        title: 'Free Pickup & Delivery',
        description: 'Free pickup and delivery for orders above ₱200 within Iloilo City proper.',
        categoryTag: 'promo',
        categoryId: servicesCat.id,
        isActive: true,
        expiresAt: new Date('2026-06-30'),
      },
    }),
  ]);

  console.log(`  ✓ ${posts.length} staff posts`);

  // ─── Users ────────────────────────────────────
  // Demo accounts get an explicit password so they can sign in via the
  // email/password form. (Real customers usually onboard through phone + OTP,
  // which sets no password.) Passwords match backend/set-demo-passwords.mjs.
  const [adminPw, merchantPw, customerPw, riderPw, coordinatorPw] = await Promise.all([
    bcrypt.hash('admin123', 10),
    bcrypt.hash('merchant123', 10),
    bcrypt.hash('customer123', 10),
    bcrypt.hash('rider123', 10),
    bcrypt.hash('coordinator123', 10),
  ]);
  const users = await Promise.all([
    prisma.user.upsert({
      where: { phone: '+639170000001' },
      update: { password: adminPw, role: 'admin', isActive: true },
      create: {
        phone: '+639170000001',
        email: 'admin@wekonnek.com',
        firstName: 'Admin',
        lastName: 'WeKonnek',
        role: 'admin',
        isActive: true,
        password: adminPw,
      },
    }),
    prisma.user.upsert({
      where: { phone: '+639170000002' },
      update: { password: merchantPw, role: 'merchant', isActive: true },
      create: {
        phone: '+639170000002',
        email: 'merchant@wekonnek.com',
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        role: 'merchant',
        isActive: true,
        password: merchantPw,
      },
    }),
    prisma.user.upsert({
      where: { phone: '+639170000003' },
      update: { password: customerPw, role: 'customer', isActive: true },
      create: {
        phone: '+639170000003',
        email: 'customer@wekonnek.com',
        firstName: 'Maria',
        lastName: 'Santos',
        role: 'customer',
        isActive: true,
        password: customerPw,
      },
    }),
    prisma.user.upsert({
      where: { phone: '+639170000004' },
      update: { password: riderPw, role: 'rider', isActive: true },
      create: {
        phone: '+639170000004',
        email: 'rider@wekonnek.com',
        firstName: 'Pedro',
        lastName: 'Reyes',
        role: 'rider',
        isActive: true,
        password: riderPw,
      },
    }),
    prisma.user.upsert({
      where: { phone: '+639170000005' },
      update: {
        email: 'coordinator@wekonnek.com',
        password: coordinatorPw,
        role: 'staff',
        isActive: true,
      },
      create: {
        phone: '+639170000005',
        email: 'coordinator@wekonnek.com',
        firstName: 'Zone',
        lastName: 'Coordinator',
        role: 'staff',
        isActive: true,
        password: coordinatorPw,
      },
    }),
  ]);

  await prisma.merchant.update({
    where: { id: merchants[0].id },
    data: { userId: users[1].id, merchantCode: 'WKM-DEMO2026' },
  });

  console.log(`  ✓ ${users.length} users (admin/admin123, merchant/merchant123, customer/customer123, rider/rider123, coordinator/coordinator123)`);

  // ─── Zones ────────────────────────────────────
  const zones = await Promise.all([
    prisma.zone.upsert({
      where: { code: 'ILOILO-CITY-PROPER' },
      update: {},
      create: {
        name: 'Iloilo City Proper',
        code: 'ILOILO-CITY-PROPER',
        city: 'Iloilo City',
        province: 'Iloilo',
        region: 'Western Visayas',
        polygon: { type: 'Polygon', coordinates: [[[122.55, 10.68], [122.58, 10.68], [122.58, 10.71], [122.55, 10.71], [122.55, 10.68]]] },
        centerLat: 10.6920,
        centerLng: 122.5640,
        baseDeliveryFee: 39.00,
        perKmRate: 10.00,
        isActive: true,
      },
    }),
    prisma.zone.upsert({
      where: { code: 'ILOILO-METRO' },
      update: {},
      create: {
        name: 'Metro Iloilo',
        code: 'ILOILO-METRO',
        city: 'Iloilo City',
        province: 'Iloilo',
        region: 'Western Visayas',
        polygon: { type: 'Polygon', coordinates: [[[122.50, 10.65], [122.62, 10.65], [122.62, 10.75], [122.50, 10.75], [122.50, 10.65]]] },
        centerLat: 10.7000,
        centerLng: 122.5600,
        baseDeliveryFee: 59.00,
        perKmRate: 12.00,
        isActive: true,
      },
    }),
  ]);

  console.log(`  ✓ ${zones.length} delivery zones`);

  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

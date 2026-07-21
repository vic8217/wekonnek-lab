import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  I18nModule,
  AcceptLanguageResolver,
  HeaderResolver,
  QueryResolver,
} from 'nestjs-i18n';
import * as path from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma';

// ─── WeKonnek Catalog Modules (existing) ─────────────
import { CategoriesModule } from './categories/categories.module';
import { SubCategoriesModule } from './sub-categories/sub-categories.module';
import { MerchantsModule } from './merchants/merchants.module';
import { ProductsModule } from './products/products.module';
import { StaffPostsModule } from './staff-posts/staff-posts.module';
import { UploadModule } from './upload/upload.module';
import { MarketplaceOrdersModule } from './orders/orders.module';
import { ReservationsModule } from './reservations/reservations.module';
import { MerchantApplicationsModule } from './merchant-applications/merchant-applications.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PromotionsModule } from './promotions/promotions.module';
import { BranchesModule } from './branches/branches.module';
import { MerchantStaffModule } from './merchant-staff/merchant-staff.module';
import { FloorTablesModule } from './floor-tables/floor-tables.module';

// ─── WeKonnek Core Modules (merged from standalone backend) ─
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StoresModule } from './modules/stores/stores.module';
import { StoreProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { AddressModule } from './modules/address/address.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { ChatModule } from './modules/chat/chat.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ZonesModule } from './modules/zones/zones.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { VouchersModule } from './modules/vouchers/vouchers.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    PrismaModule,

    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(__dirname, '..', 'i18n'),
        watch: true,
      },
      resolvers: [
        new HeaderResolver(['x-lang']),
        new QueryResolver(['lang']),
        AcceptLanguageResolver,
      ],
    }),

    // ─── WeKonnek Catalog ────────────────────────
    CategoriesModule,
    SubCategoriesModule,
    MerchantsModule,
    ProductsModule,
    StaffPostsModule,
    UploadModule,
    MarketplaceOrdersModule,
    ReservationsModule,
    MerchantApplicationsModule,
    SubscriptionsModule,
    ReviewsModule,
    PromotionsModule,
    BranchesModule,
    MerchantStaffModule,
    FloorTablesModule,

    // ─── WeKonnek Core ────────────────────────────
    AuthModule,
    UsersModule,
    StoresModule,
    StoreProductsModule,
    OrdersModule,
    AddressModule,
    TrackingModule,
    ChatModule,
    NotificationsModule,
    WalletModule,
    ZonesModule,
    InvoicesModule,
    VouchersModule,
    LoyaltyModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

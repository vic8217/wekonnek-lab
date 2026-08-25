import { Module } from '@nestjs/common';
import { SocialAuthProviderController } from './social-auth.controller';
import { SocialAuthProviderService } from './social-auth.service';
@Module({ controllers: [SocialAuthProviderController], providers: [SocialAuthProviderService], exports: [SocialAuthProviderService] })
export class SocialAuthModule {}

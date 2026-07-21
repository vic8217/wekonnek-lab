import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@Req() req: any) {
    return this.authService.decorateUser(req.user);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  logout() {
    // Stateless JWT: client clears its token. Endpoint exists for symmetry.
    return { success: true };
  }

  @Post('send-otp')
  sendOtp(@Body() body: { phone: string; role?: UserRole }) {
    return this.authService.sendOtp(body.phone, body.role);
  }

  @Post('verify-otp')
  verifyOtp(@Body() body: { phone: string; code: string; role?: UserRole }) {
    return this.authService.verifyOtp(body.phone, body.code, body.role);
  }

  @Post('register')
  register(
    @Body()
    body: {
      phone: string;
      firstName: string;
      lastName: string;
      email?: string;
      role?: UserRole;
      password?: string;
      vehicleType?: string;
      plateNumber?: string;
      licenseNumber?: string;
      preferredZoneId?: string;
    },
  ) {
    return this.authService.register(body);
  }

  @Post('login')
  login(
    @Body()
    body: { email?: string; phone?: string; identifier?: string; password: string },
  ) {
    const identifier = body.email ?? body.phone ?? body.identifier ?? '';
    return this.authService.loginWithPassword(identifier, body.password);
  }

  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshToken(body.refreshToken);
  }
}

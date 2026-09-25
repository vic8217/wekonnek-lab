import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Absent Authorization stays anonymous.
 * A supplied Authorization header must authenticate.
 * Passport JWT failure is (err=null, user=false, info=failure) and must
 * not be treated as an anonymous request.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string | string[] };
    }>();
    const authorization = request.headers?.authorization;
    if (authorization == null) return true;
    if (authorizationHeaderBlank(authorization)) {
      throw new UnauthorizedException();
    }
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser, info?: unknown): TUser {
    // Passport fail() sets err=null, user=false, and puts the failure in info.
    if (err || !user || (info != null && !user)) {
      throw new UnauthorizedException();
    }
    return user;
  }
}

function authorizationHeaderBlank(authorization: string | string[]): boolean {
  const values = Array.isArray(authorization) ? authorization : [authorization];
  return values.length === 0 || values.every((value) => value.trim() === '');
}

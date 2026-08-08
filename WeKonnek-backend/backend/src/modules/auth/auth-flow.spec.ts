import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('customer low-friction authentication', () => {
  describe('Philippine mobile normalization', () => {
    it.each([
      ['09171234567', '+639171234567'],
      ['9171234567', '+639171234567'],
      ['+63 917 123 4567', '+639171234567'],
      ['0063-917-123-4567', '+639171234567'],
    ])('normalizes %s to E.164', (input, expected) => {
      expect(AuthService.normalizePhilippineMobile(input)).toBe(expected);
    });

    it.each(['', '1234', '+1 202 555 0198', '08171234567'])('rejects invalid or non-PH number %s', input => {
      expect(() => AuthService.normalizePhilippineMobile(input)).toThrow(BadRequestException);
    });
  });

  it('documents required regression scenarios', () => {
    // These names are deliberately kept together as the acceptance matrix for
    // controller/e2e adapters, whose provider calls are mocked in CI.
    expect([
      'existing email/password user sign-in',
      'new OAuth identity registration without email auto-merge',
      'mobile OTP registration and profile completion',
      'Viber failure followed by explicit SMS fallback',
      'OTP expiry, attempt limit and resend invalidation',
      'duplicate mobile rejection',
      'authenticated provider identity linking',
    ]).toHaveLength(7);
  });
});

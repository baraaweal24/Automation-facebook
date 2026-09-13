import { describe, expect, it } from 'vitest';
import { assertMembershipTransition, assertPostTransition } from './transitions.js';

describe('state transitions', () => {
  it('allows the expected pending flows', () => {
    expect(() => assertMembershipTransition('JOINING', 'WAITING_ADMIN')).not.toThrow();
    expect(() => assertPostTransition('POSTING', 'PENDING_ADMIN_APPROVAL')).not.toThrow();
  });
  it('blocks impossible terminal transitions', () => {
    expect(() => assertPostTransition('APPROVED', 'POSTING')).toThrow(/Invalid/);
    expect(() => assertMembershipTransition('JOINED', 'WAITING_ADMIN')).toThrow(/Invalid/);
  });
});

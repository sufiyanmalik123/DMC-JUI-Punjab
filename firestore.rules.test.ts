/**
 * Security Rules Specification Verification Matrix (Payload-First TDD)
 * Maps the 12 adversarial payloads from security_spec.md to expected PERMISSION_DENIED outcomes.
 */

export interface SecurityTestCase {
  id: string;
  targetPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  authContext: 'unauthenticated' | 'nonAdminUser' | 'unverifiedAdminEmail' | 'verifiedAdmin';
  payload?: Record<string, unknown>;
  expectedOutcome: 'ALLOW' | 'PERMISSION_DENIED';
  enforcedByRule: string;
}

export const SECURITY_TEST_MATRIX: SecurityTestCase[] = [
  {
    id: 'DD-01-counter-jump',
    targetPath: 'stats/supporters',
    operation: 'update',
    authContext: 'unauthenticated',
    payload: { count: 999, updatedAt: 'REQUEST_TIME' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().count == existing().count + 1',
  },
  {
    id: 'DD-02-counter-decrement',
    targetPath: 'stats/supporters',
    operation: 'update',
    authContext: 'unauthenticated',
    payload: { count: 0, updatedAt: 'REQUEST_TIME' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().count == existing().count + 1',
  },
  {
    id: 'DD-03-stats-shadow-field',
    targetPath: 'stats/supporters',
    operation: 'update',
    authContext: 'unauthenticated',
    payload: { count: 2, updatedAt: 'REQUEST_TIME', hacked: true },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: "incoming().keys().hasOnly(['count', 'updatedAt'])",
  },
  {
    id: 'DD-04-unauthorized-frame-swap',
    targetPath: 'campaign_config/active',
    operation: 'update',
    authContext: 'nonAdminUser',
    payload: { frameUrl: '/uploads/frames/evil.png' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isAdmin()',
  },
  {
    id: 'DD-05-frame-url-xss',
    targetPath: 'campaign_config/active',
    operation: 'update',
    authContext: 'verifiedAdmin',
    payload: { frameUrl: 'javascript:alert(1)' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: "data.frameUrl.matches('^(/assets/aistudio/|/uploads/frames/)[a-zA-Z0-9_\\\\-]+\\\\.png$')",
  },
  {
    id: 'DD-06-unverified-admin-email',
    targetPath: 'campaign_config/active',
    operation: 'create',
    authContext: 'unverifiedAdminEmail',
    payload: { frameUrl: '/assets/aistudio/frame_28fe0992.png' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'request.auth.token.email_verified == true',
  },
  {
    id: 'DD-07-gallery-url-xss',
    targetPath: 'gallery_items/item_01',
    operation: 'create',
    authContext: 'unauthenticated',
    payload: {
      imageUrl: 'data:text/html,<script>alert(1)</script>',
      supporterName: 'Test',
      city: 'Lahore',
      mimeType: 'image/png',
      fileSize: 1024,
      createdAt: 'REQUEST_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: "data.imageUrl.matches('^/uploads/gallery/[a-zA-Z0-9_\\\\-]+\\\\.(png|jpg|jpeg)$')",
  },
  {
    id: 'DD-08-gallery-oversized-name',
    targetPath: 'gallery_items/item_02',
    operation: 'create',
    authContext: 'unauthenticated',
    payload: {
      imageUrl: '/uploads/gallery/valid_123.png',
      supporterName: 'A'.repeat(500),
      city: 'Lahore',
      mimeType: 'image/png',
      fileSize: 1024,
      createdAt: 'REQUEST_TIME',
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'data.supporterName.size() <= 60',
  },
  {
    id: 'DD-09-gallery-fake-timestamp',
    targetPath: 'gallery_items/item_03',
    operation: 'create',
    authContext: 'unauthenticated',
    payload: {
      imageUrl: '/uploads/gallery/valid_123.png',
      supporterName: 'Supporter',
      city: 'Sargodha',
      mimeType: 'image/png',
      fileSize: 1024,
      createdAt: '2020-01-01T00:00:00Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'data.createdAt == request.time',
  },
  {
    id: 'DD-10-gallery-unauthorized-delete',
    targetPath: 'gallery_items/item_01',
    operation: 'delete',
    authContext: 'nonAdminUser',
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isAdmin()',
  },
  {
    id: 'DD-11-id-poisoning',
    targetPath: 'gallery_items/..%2F..%2Fetc',
    operation: 'create',
    authContext: 'unauthenticated',
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidId(itemId)',
  },
  {
    id: 'DD-12-admin-self-escalation',
    targetPath: 'admins/attacker_uid',
    operation: 'create',
    authContext: 'nonAdminUser',
    payload: { email: 'attacker@example.com', role: 'admin', createdAt: 'REQUEST_TIME', updatedAt: 'REQUEST_TIME' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isBootstrappedAdmin()',
  },
];

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  disableNetwork,
  doc,
  enableNetwork,
  getDocFromServer,
  getFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

export const QUOTA_COOLDOWN_KEY = 'dmc_quota_cooldown_until_v1';
const QUOTA_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function isQuotaExceededError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const combined = `${code} ${message}`.toLowerCase();
  return (
    combined.includes('resource-exhausted') ||
    combined.includes('quota limit exceeded') ||
    combined.includes('quota exceeded') ||
    combined.includes('free daily read units') ||
    combined.includes('free daily write units') ||
    combined.includes('daily write units') ||
    combined.includes('daily read units')
  );
}

export function isInQuotaCooldown(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(QUOTA_COOLDOWN_KEY);
    if (!raw) return false;
    const until = JSON.parse(raw) as unknown;
    return typeof until === 'number' && Date.now() < until;
  } catch {
    return false;
  }
}

export function markQuotaCooldown(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        QUOTA_COOLDOWN_KEY,
        JSON.stringify(Date.now() + QUOTA_COOLDOWN_MS),
      );
    } catch {
      // Ignore storage restrictions
    }
  }
  // Halt Firestore's background retry/backoff stream immediately when quota is exhausted
  void disableNetwork(db).catch(() => {});
}

export async function ensureFirestoreNetwork(): Promise<void> {
  await enableNetwork(db);
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const CONNECTION_CHECK_SESSION_KEY = 'dmc_fb_conn_checked_v1';
const CONFIG_CACHE_KEY = 'dmc_campaign_config_cache_v1';

async function testConnection() {
  if (isInQuotaCooldown()) {
    void disableNetwork(db).catch(() => {});
    return;
  }

  if (typeof window !== 'undefined') {
    try {
      if (window.sessionStorage.getItem(CONNECTION_CHECK_SESSION_KEY) === '1') {
        return;
      }
      window.sessionStorage.setItem(CONNECTION_CHECK_SESSION_KEY, '1');
    } catch {
      // Ignore sessionStorage restrictions
    }
  }

  try {
    const snap = await getDocFromServer(doc(db, 'campaign_config', 'active'));
    if (typeof window !== 'undefined' && snap.exists()) {
      const data = snap.data();
      if (
        typeof data?.frameUrl === 'string' &&
        data.frameUrl.length > 0 &&
        typeof data?.brandTitle === 'string' &&
        data.brandTitle.length > 0
      ) {
        try {
          window.localStorage.setItem(
            CONFIG_CACHE_KEY,
            JSON.stringify({
              config: {
                frameUrl: data.frameUrl,
                brandTitle: data.brandTitle,
                campaignTitle:
                  typeof data.campaignTitle === 'string' ? data.campaignTitle : '',
                campaignSubtitle:
                  typeof data.campaignSubtitle === 'string' ? data.campaignSubtitle : '',
                editorPrompt:
                  typeof data.editorPrompt === 'string' ? data.editorPrompt : '',
                updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
                updatedAtMs:
                  data.updatedAt && typeof data.updatedAt.toMillis === 'function'
                    ? data.updatedAt.toMillis()
                    : null,
              },
              fetchedAt: Date.now(),
            }),
          );
        } catch {
          // Ignore storage restrictions
        }
      }
    }
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markQuotaCooldown();
      return;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

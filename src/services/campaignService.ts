import {
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  db,
  ensureFirestoreNetwork,
  handleFirestoreError,
  isInQuotaCooldown,
  isQuotaExceededError,
  markQuotaCooldown,
  OperationType,
} from '../lib/firebase';
import {
  CampaignConfig,
  DEFAULT_CAMPAIGN_CONFIG,
  FrameAsset,
} from '../types/campaign';

const STATS_COLLECTION = 'stats';
const SUPPORTERS_DOC_ID = 'supporters_v2';
export const SUPPORTERS_BASE_COUNT = 8739;
const CONFIG_COLLECTION = 'campaign_config';
const ACTIVE_CONFIG_ID = 'active';

const STATS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CONFIG_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const SUPPORTERS_CACHE_KEY = 'dmc_supporters_cache_v2';
const CONFIG_CACHE_KEY = 'dmc_campaign_config_cache_v1';
const SYNC_CHANNEL_NAME = 'dmc_jui_sync_v1';

let supportersInflight: Promise<number> | null = null;
let configInflight: Promise<CampaignConfig> | null = null;

type SyncMessage =
  | { type: 'supporters'; count: number }
  | { type: 'config'; config: CampaignConfig };

const supportersListeners = new Set<(count: number) => void>();
const configListeners = new Set<(config: CampaignConfig) => void>();

let syncChannel: BroadcastChannel | null = null;

function getSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!syncChannel) {
    try {
      syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      syncChannel.onmessage = (event: MessageEvent<SyncMessage>) => {
        const payload = event.data;
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'supporters' && typeof payload.count === 'number') {
          supportersListeners.forEach((cb) => cb(payload.count));
        } else if (payload.type === 'config' && payload.config) {
          configListeners.forEach((cb) => cb(payload.config));
        }
      };
    } catch {
      syncChannel = null;
    }
  }
  return syncChannel;
}

function broadcastSync(message: SyncMessage): void {
  if (message.type === 'supporters') {
    supportersListeners.forEach((cb) => cb(message.count));
  } else if (message.type === 'config') {
    configListeners.forEach((cb) => cb(message.config));
  }

  try {
    getSyncChannel()?.postMessage(message);
  } catch {
    // Ignore channel errors
  }
}

export function subscribeLocalSupportersUpdates(
  cb: (count: number) => void,
): () => void {
  getSyncChannel();
  supportersListeners.add(cb);
  return () => {
    supportersListeners.delete(cb);
  };
}

export function subscribeLocalConfigUpdates(
  cb: (config: CampaignConfig) => void,
): () => void {
  getSyncChannel();
  configListeners.add(cb);
  return () => {
    configListeners.delete(cb);
  };
}

function readJsonStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota / private mode
  }
}

function mapTimestamp(value: unknown): Date | null {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  return null;
}

export function getCachedSupportersCount(): number {
  const cached = readJsonStorage<{ count: number; fetchedAt: number }>(SUPPORTERS_CACHE_KEY);
  if (cached && typeof cached.count === 'number' && cached.count >= SUPPORTERS_BASE_COUNT) {
    return cached.count;
  }
  return SUPPORTERS_BASE_COUNT;
}

function saveSupportersCountCache(count: number): void {
  writeJsonStorage(SUPPORTERS_CACHE_KEY, {
    count: Math.max(SUPPORTERS_BASE_COUNT, count),
    fetchedAt: Date.now(),
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutErrorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutErrorMessage));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function fetchSupportersCount(options?: { force?: boolean }): Promise<number> {
  const cached = readJsonStorage<{ count: number; fetchedAt: number }>(SUPPORTERS_CACHE_KEY);
  const now = Date.now();
  if (
    !options?.force &&
    cached &&
    typeof cached.count === 'number' &&
    cached.count >= SUPPORTERS_BASE_COUNT &&
    now - cached.fetchedAt < STATS_CACHE_TTL_MS
  ) {
    return cached.count;
  }

  if (isInQuotaCooldown()) {
    return getCachedSupportersCount();
  }

  if (supportersInflight && !options?.force) {
    return supportersInflight;
  }

  const docRef = doc(db, STATS_COLLECTION, SUPPORTERS_DOC_ID);
  const path = `${STATS_COLLECTION}/${SUPPORTERS_DOC_ID}`;

  const task = (async () => {
    try {
      const snap = await getDoc(docRef);
      const rawCount = snap.exists() ? snap.data()?.count : undefined;
      const normalized =
        typeof rawCount === 'number' && rawCount >= SUPPORTERS_BASE_COUNT
          ? rawCount
          : SUPPORTERS_BASE_COUNT;
      saveSupportersCountCache(normalized);
      broadcastSync({ type: 'supporters', count: normalized });
      return normalized;
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markQuotaCooldown();
        return getCachedSupportersCount();
      }
      handleFirestoreError(error, OperationType.GET, path);
    } finally {
      supportersInflight = null;
    }
  })();

  supportersInflight = task;
  return task;
}

/**
 * Throttled polling mechanism replacing live Firestore onSnapshot listeners.
 * Polls at most once per STATS_CACHE_TTL_MS when the tab is visible and not in quota cooldown.
 */
export function startThrottledSupportersPolling(
  onUpdate: (count: number) => void,
  intervalMs: number = STATS_CACHE_TTL_MS,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const pollOnce = () => {
    if (document.visibilityState !== 'visible' || isInQuotaCooldown()) {
      return;
    }
    void fetchSupportersCount()
      .then((count) => onUpdate(count))
      .catch(() => {
        // Keep cached value silently on background poll failure
      });
  };

  const timer = window.setInterval(pollOnce, intervalMs);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      pollOnce();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

function getFirestoreErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code || '').toLowerCase();
  }
  return '';
}

/**
 * Increments stats/supporters by 1 using a zero-read increment-only write operation
 * (FieldValue.increment(1)) with a timeout guard and quota-cooldown protection.
 */
export async function incrementSupportersOnImport(): Promise<{
  count: number;
  quotaDeferred?: boolean;
}> {
  const currentCached = getCachedSupportersCount();
  const optimisticNext = currentCached + 1;

  if (isInQuotaCooldown()) {
    return {
      count: currentCached,
      quotaDeferred: true,
    };
  }

  const statsRef = doc(db, STATS_COLLECTION, SUPPORTERS_DOC_ID);
  const path = `${STATS_COLLECTION}/${SUPPORTERS_DOC_ID}`;

  try {
    await withTimeout(
      updateDoc(statsRef, {
        count: increment(1),
        updatedAt: serverTimestamp(),
      }),
      4500,
      'FIRESTORE_WRITE_TIMEOUT',
    );
    saveSupportersCountCache(optimisticNext);
    broadcastSync({ type: 'supporters', count: optimisticNext });
    return { count: optimisticNext };
  } catch (error) {
    if (error instanceof Error && error.message === 'FIRESTORE_WRITE_TIMEOUT') {
      return {
        count: currentCached,
        quotaDeferred: true,
      };
    }

    if (isQuotaExceededError(error)) {
      markQuotaCooldown();
      return {
        count: currentCached,
        quotaDeferred: true,
      };
    }

    const code = getFirestoreErrorCode(error);
    if (code === 'not-found') {
      try {
        const initialCount = SUPPORTERS_BASE_COUNT + 1;
        await withTimeout(
          setDoc(statsRef, {
            count: initialCount,
            updatedAt: serverTimestamp(),
          }),
          4500,
          'FIRESTORE_WRITE_TIMEOUT',
        );
        saveSupportersCountCache(initialCount);
        broadcastSync({ type: 'supporters', count: initialCount });
        return { count: initialCount };
      } catch (createError) {
        if (
          (createError instanceof Error && createError.message === 'FIRESTORE_WRITE_TIMEOUT') ||
          isQuotaExceededError(createError)
        ) {
          if (isQuotaExceededError(createError)) markQuotaCooldown();
          return {
            count: currentCached,
            quotaDeferred: true,
          };
        }
        handleFirestoreError(createError, OperationType.CREATE, path);
      }
    }

    if (code === 'permission-denied') {
      try {
        const nextCount = await withTimeout(
          runTransaction(db, async (tx) => {
            const statsSnap = await tx.get(statsRef);
            const rawExisting = statsSnap.exists() ? statsSnap.data()?.count : 0;
            const existingCount =
              typeof rawExisting === 'number' && rawExisting >= 0 ? rawExisting : 0;
            const updated = Math.max(SUPPORTERS_BASE_COUNT, existingCount) + 1;

            if (!statsSnap.exists()) {
              tx.set(statsRef, {
                count: updated,
                updatedAt: serverTimestamp(),
              });
            } else {
              tx.update(statsRef, {
                count: updated,
                updatedAt: serverTimestamp(),
              });
            }
            return updated;
          }),
          4500,
          'FIRESTORE_WRITE_TIMEOUT',
        );

        saveSupportersCountCache(nextCount);
        broadcastSync({ type: 'supporters', count: nextCount });
        return { count: nextCount };
      } catch (txError) {
        if (
          (txError instanceof Error && txError.message === 'FIRESTORE_WRITE_TIMEOUT') ||
          isQuotaExceededError(txError)
        ) {
          if (isQuotaExceededError(txError)) markQuotaCooldown();
          return {
            count: currentCached,
            quotaDeferred: true,
          };
        }
        handleFirestoreError(txError, OperationType.WRITE, path);
      }
    }

    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function getCachedCampaignConfig(): CampaignConfig {
  const cached = readJsonStorage<{
    config: Omit<CampaignConfig, 'updatedAt'> & { updatedAtMs?: number | null };
    fetchedAt: number;
  }>(CONFIG_CACHE_KEY);

  if (cached?.config && cached.config.frameUrl && cached.config.brandTitle) {
    return {
      ...cached.config,
      updatedAt:
        typeof cached.config.updatedAtMs === 'number'
          ? new Date(cached.config.updatedAtMs)
          : null,
    };
  }
  return DEFAULT_CAMPAIGN_CONFIG;
}

function saveCampaignConfigCache(config: CampaignConfig): void {
  writeJsonStorage(CONFIG_CACHE_KEY, {
    config: {
      frameUrl: config.frameUrl,
      brandTitle: config.brandTitle,
      campaignTitle: config.campaignTitle,
      campaignSubtitle: config.campaignSubtitle,
      editorPrompt: config.editorPrompt,
      updatedBy: config.updatedBy,
      updatedAtMs: config.updatedAt ? config.updatedAt.getTime() : null,
    },
    fetchedAt: Date.now(),
  });
}

export async function fetchCampaignConfig(options?: {
  force?: boolean;
}): Promise<CampaignConfig> {
  const cached = readJsonStorage<{
    config: Omit<CampaignConfig, 'updatedAt'> & { updatedAtMs?: number | null };
    fetchedAt: number;
  }>(CONFIG_CACHE_KEY);
  const now = Date.now();

  if (!options?.force && cached?.config && now - cached.fetchedAt < CONFIG_CACHE_TTL_MS) {
    return {
      ...cached.config,
      updatedAt:
        typeof cached.config.updatedAtMs === 'number'
          ? new Date(cached.config.updatedAtMs)
          : null,
    };
  }

  if (isInQuotaCooldown()) {
    return getCachedCampaignConfig();
  }

  if (configInflight && !options?.force) {
    return configInflight;
  }

  const task = (async () => {
    try {
      const snapshot = await getDoc(doc(db, CONFIG_COLLECTION, ACTIVE_CONFIG_ID));
      if (!snapshot.exists()) {
        saveCampaignConfigCache(DEFAULT_CAMPAIGN_CONFIG);
        return DEFAULT_CAMPAIGN_CONFIG;
      }
      const data = snapshot.data();
      const resolved: CampaignConfig = {
        frameUrl:
          typeof data.frameUrl === 'string' && data.frameUrl.length > 0
            ? data.frameUrl
            : DEFAULT_CAMPAIGN_CONFIG.frameUrl,
        brandTitle:
          typeof data.brandTitle === 'string' && data.brandTitle.length > 0
            ? data.brandTitle
            : DEFAULT_CAMPAIGN_CONFIG.brandTitle,
        campaignTitle:
          typeof data.campaignTitle === 'string' && data.campaignTitle.length > 0
            ? data.campaignTitle
            : DEFAULT_CAMPAIGN_CONFIG.campaignTitle,
        campaignSubtitle:
          typeof data.campaignSubtitle === 'string'
            ? data.campaignSubtitle
            : DEFAULT_CAMPAIGN_CONFIG.campaignSubtitle,
        editorPrompt:
          typeof data.editorPrompt === 'string'
            ? data.editorPrompt
            : DEFAULT_CAMPAIGN_CONFIG.editorPrompt,
        updatedAt: mapTimestamp(data.updatedAt),
        updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
      };
      saveCampaignConfigCache(resolved);
      broadcastSync({ type: 'config', config: resolved });
      return resolved;
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markQuotaCooldown();
      }
      return getCachedCampaignConfig();
    } finally {
      configInflight = null;
    }
  })();

  configInflight = task;
  return task;
}

export async function saveCampaignConfig(
  config: Pick<
    CampaignConfig,
    'frameUrl' | 'brandTitle' | 'campaignTitle' | 'campaignSubtitle' | 'editorPrompt'
  >,
  adminUid: string,
): Promise<void> {
  const path = `${CONFIG_COLLECTION}/${ACTIVE_CONFIG_ID}`;
  const cleanFrame = config.frameUrl.trim().slice(0, 300);
  if (!/^(\/assets\/aistudio\/|\/uploads\/frames\/)[a-zA-Z0-9_\-]+\.png$/.test(cleanFrame)) {
    throw new Error('Invalid campaign frame URL format.');
  }

  const cleanBrand = config.brandTitle.trim().slice(0, 80) || DEFAULT_CAMPAIGN_CONFIG.brandTitle;
  const cleanTitle =
    config.campaignTitle.trim().slice(0, 120) || DEFAULT_CAMPAIGN_CONFIG.campaignTitle;
  const cleanSubtitle = config.campaignSubtitle.trim().slice(0, 200);
  const cleanPrompt = config.editorPrompt.trim().slice(0, 240);

  try {
    await ensureFirestoreNetwork();
    await setDoc(doc(db, CONFIG_COLLECTION, ACTIVE_CONFIG_ID), {
      frameUrl: cleanFrame,
      brandTitle: cleanBrand,
      campaignTitle: cleanTitle,
      campaignSubtitle: cleanSubtitle,
      editorPrompt: cleanPrompt,
      updatedAt: serverTimestamp(),
      updatedBy: adminUid.slice(0, 128),
    });

    const nextConfig: CampaignConfig = {
      frameUrl: cleanFrame,
      brandTitle: cleanBrand,
      campaignTitle: cleanTitle,
      campaignSubtitle: cleanSubtitle,
      editorPrompt: cleanPrompt,
      updatedAt: new Date(),
      updatedBy: adminUid.slice(0, 128),
    };
    saveCampaignConfigCache(nextConfig);
    broadcastSync({ type: 'config', config: nextConfig });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function uploadCampaignFrameAsAdmin(
  file: File,
  idToken: string,
): Promise<{
  frameUrl: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  fileSize: number;
}> {
  const formData = new FormData();
  formData.append('frame', file);

  const response = await fetch('/api/admin/frame', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to upload campaign frame.');
  }
  return data;
}

export async function listCampaignFramesAsAdmin(idToken: string): Promise<FrameAsset[]> {
  const response = await fetch('/api/admin/frames', {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load campaign frames.');
  }
  return Array.isArray(data.frames) ? data.frames : [];
}

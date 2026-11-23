import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  isQuotaExceededError,
  OperationType,
} from '../lib/firebase';
import {
  CampaignConfig,
  DEFAULT_CAMPAIGN_CONFIG,
  FrameAsset,
  GalleryItem,
} from '../types/campaign';

const STATS_COLLECTION = 'stats';
const SUPPORTERS_DOC_ID = 'supporters';
export const SUPPORTERS_BASE_COUNT = 700;
const CONFIG_COLLECTION = 'campaign_config';
const ACTIVE_CONFIG_ID = 'active';
const GALLERY_COLLECTION = 'gallery_items';
const GALLERY_EPOCH_TIMESTAMP = Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'));
const CHUNK_CHAR_LIMIT = 400_000;
const UPLOAD_COOLDOWN_MS = 1500;

const STATS_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const CONFIG_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const GALLERY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const GALLERY_COUNT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const SUPPORTERS_CACHE_KEY = 'dmc_supporters_cache_v1';
const CONFIG_CACHE_KEY = 'dmc_campaign_config_cache_v1';
const GALLERY_CACHE_KEY = 'dmc_gallery_cache_v1';
const GALLERY_COUNT_CACHE_KEY = 'dmc_gallery_count_cache_v1';
const SYNC_CHANNEL_NAME = 'dmc_jui_sync_v1';

const MEDIA_CACHE_NAME = 'dmc-gallery-media-v1';

let lastUploadTimestamp = 0;

const galleryBlobUrlCache = new Map<string, string>();
const galleryBlobInflight = new Map<string, Promise<string>>();
const galleryThumbUrlCache = new Map<string, string>();
const galleryThumbInflight = new Map<string, Promise<string>>();

let supportersInflight: Promise<number> | null = null;
let configInflight: Promise<CampaignConfig> | null = null;
let galleryPageInflight: Promise<GalleryPageResult> | null = null;

interface CachedGalleryItem {
  id: string;
  imageUrl: string;
  supporterName: string;
  city: string;
  mimeType: 'image/png' | 'image/jpeg';
  fileSize: number;
  chunkCount: number;
  hasThumbnail: boolean;
  createdAtMs: number | null;
}

interface GalleryCachePayload {
  items: CachedGalleryItem[];
  totalCount: number;
  hasMore: boolean;
  fetchedAt: number;
}

export interface GalleryPageResult {
  items: GalleryItem[];
  totalCount: number;
  hasMore: boolean;
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  lastCreatedAtMs: number | null;
  fromCache: boolean;
  quotaFallback?: boolean;
}

type SyncMessage =
  | { type: 'supporters'; count: number }
  | { type: 'config'; config: CampaignConfig }
  | { type: 'gallery' };

const supportersListeners = new Set<(count: number) => void>();
const configListeners = new Set<(config: CampaignConfig) => void>();
const galleryListeners = new Set<() => void>();

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
        } else if (payload.type === 'gallery') {
          galleryListeners.forEach((cb) => cb());
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
  } else if (message.type === 'gallery') {
    galleryListeners.forEach((cb) => cb());
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

export function subscribeLocalGalleryUpdates(cb: () => void): () => void {
  getSyncChannel();
  galleryListeners.add(cb);
  return () => {
    galleryListeners.delete(cb);
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

function toCachedItem(item: GalleryItem): CachedGalleryItem {
  return {
    id: item.id,
    imageUrl: item.imageUrl,
    supporterName: item.supporterName,
    city: item.city,
    mimeType: item.mimeType,
    fileSize: item.fileSize,
    chunkCount: item.chunkCount || 0,
    hasThumbnail: Boolean(item.hasThumbnail),
    createdAtMs: item.createdAt ? item.createdAt.getTime() : null,
  };
}

function fromCachedItem(cached: CachedGalleryItem): GalleryItem {
  return {
    id: cached.id,
    imageUrl: cached.imageUrl,
    supporterName: cached.supporterName,
    city: cached.city,
    mimeType: cached.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    fileSize: cached.fileSize,
    chunkCount: cached.chunkCount,
    hasThumbnail: cached.hasThumbnail,
    createdAt: typeof cached.createdAtMs === 'number' ? new Date(cached.createdAtMs) : null,
  };
}

async function readPersistentCachedBlob(key: string): Promise<Blob | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    const cache = await window.caches.open(MEDIA_CACHE_NAME);
    const matched = await cache.match(key);
    if (!matched) return null;
    const blob = await matched.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

async function writePersistentCachedBlob(key: string, blob: Blob): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await window.caches.open(MEDIA_CACHE_NAME);
    await cache.put(
      key,
      new Response(blob, {
        headers: {
          'Content-Type': blob.type || 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      }),
    );
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

async function deletePersistentCachedItem(itemId: string): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await window.caches.open(MEDIA_CACHE_NAME);
    await Promise.all([
      cache.delete(`/_dmc_cache/full/${itemId}`),
      cache.delete(`/_dmc_cache/thumb/${itemId}`),
    ]);
  } catch {
    // Ignore cache cleanup errors
  }
}

function mapTimestamp(value: unknown): Date | null {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  return null;
}

function mapGalleryDoc(snap: QueryDocumentSnapshot<DocumentData>): GalleryItem {
  const data = snap.data();
  return {
    id: snap.id,
    imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : '',
    supporterName: typeof data.supporterName === 'string' ? data.supporterName : '',
    city: typeof data.city === 'string' ? data.city : '',
    mimeType: data.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    fileSize: typeof data.fileSize === 'number' ? data.fileSize : 0,
    chunkCount: typeof data.chunkCount === 'number' ? data.chunkCount : 0,
    hasThumbnail: Boolean(data.hasThumbnail),
    createdAt: mapTimestamp(data.createdAt),
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const commaIdx = result.indexOf(',');
        if (commaIdx === -1) {
          reject(new Error('Could not encode image data.'));
          return;
        }
        resolve(result.slice(commaIdx + 1));
      };
      reader.onerror = () => reject(new Error('Failed to read composed image.'));
      reader.readAsDataURL(blob);
    });
  }

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const blockSize = 0x2000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += blockSize) {
    const slice = bytes.subarray(i, i + blockSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

function base64ToBlob(base64: string, mimeType: 'image/png' | 'image/jpeg'): Blob {
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new Error('Gallery image data is corrupted.');
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function validateImageBlob(blob: Blob, expectedMime: 'image/png' | 'image/jpeg'): Promise<void> {
  if (!(blob instanceof Blob) || blob.size < 128) {
    throw new Error('Composed campaign image is empty or corrupted.');
  }
  if (blob.size > 10 * 1024 * 1024) {
    throw new Error('Composed campaign image exceeds the maximum allowed size.');
  }

  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const isPng =
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a;
  const isJpeg =
    header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;

  if (expectedMime === 'image/png' && !isPng) {
    throw new Error('Generated image is not a valid PNG.');
  }
  if (expectedMime === 'image/jpeg' && !isJpeg) {
    throw new Error('Generated image is not a valid JPEG.');
  }
}

export function getCachedGalleryItemImageUrl(
  itemId: string,
  variant: 'thumbnail' | 'full' = 'full',
): string | null {
  if (variant === 'thumbnail') {
    return galleryThumbUrlCache.get(itemId) || galleryBlobUrlCache.get(itemId) || null;
  }
  return galleryBlobUrlCache.get(itemId) || null;
}

export async function resolveGalleryItemThumbnailUrl(item: GalleryItem): Promise<string> {
  if (!item.chunkCount || item.chunkCount <= 0) {
    if (!item.imageUrl) {
      throw new Error('Image URL is missing.');
    }
    return item.imageUrl;
  }

  const cachedFull = galleryBlobUrlCache.get(item.id);
  if (cachedFull) {
    return cachedFull;
  }

  const cachedThumb = galleryThumbUrlCache.get(item.id);
  if (cachedThumb) {
    return cachedThumb;
  }

  if (!item.hasThumbnail) {
    return resolveGalleryItemImageUrl(item);
  }

  const inflight = galleryThumbInflight.get(item.id);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const cacheKey = `/_dmc_cache/thumb/${item.id}`;
    const persisted = await readPersistentCachedBlob(cacheKey);
    if (persisted) {
      const objectUrl = URL.createObjectURL(persisted);
      galleryThumbUrlCache.set(item.id, objectUrl);
      return objectUrl;
    }

    const thumbSnap = await getDoc(doc(db, GALLERY_COLLECTION, item.id, 'chunks', 'thumb'));
    if (thumbSnap.exists()) {
      const thumbData = thumbSnap.data()?.data;
      if (typeof thumbData === 'string' && thumbData.length > 0) {
        const blob = base64ToBlob(thumbData, 'image/jpeg');
        void writePersistentCachedBlob(cacheKey, blob);
        const objectUrl = URL.createObjectURL(blob);
        galleryThumbUrlCache.set(item.id, objectUrl);
        return objectUrl;
      }
    }

    return resolveGalleryItemImageUrl(item);
  })();

  galleryThumbInflight.set(item.id, promise);
  try {
    return await promise;
  } finally {
    galleryThumbInflight.delete(item.id);
  }
}

export async function resolveGalleryItemImageUrl(item: GalleryItem): Promise<string> {
  if (!item.chunkCount || item.chunkCount <= 0) {
    if (!item.imageUrl) {
      throw new Error('Image URL is missing.');
    }
    return item.imageUrl;
  }

  const cached = galleryBlobUrlCache.get(item.id);
  if (cached) {
    return cached;
  }

  const inflight = galleryBlobInflight.get(item.id);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const cacheKey = `/_dmc_cache/full/${item.id}`;
    const persisted = await readPersistentCachedBlob(cacheKey);
    const blob = persisted ?? (await assembleChunkedBlob(item));
    if (!persisted) {
      void writePersistentCachedBlob(cacheKey, blob);
    }
    const objectUrl = URL.createObjectURL(blob);
    galleryBlobUrlCache.set(item.id, objectUrl);
    return objectUrl;
  })();

  galleryBlobInflight.set(item.id, promise);
  try {
    return await promise;
  } finally {
    galleryBlobInflight.delete(item.id);
  }
}

async function assembleChunkedBlob(item: GalleryItem): Promise<Blob> {
  const chunkCount = item.chunkCount || 0;
  const chunkRefs = Array.from({ length: chunkCount }, (_, i) =>
    getDoc(doc(db, GALLERY_COLLECTION, item.id, 'chunks', String(i))),
  );
  const snapshots = await Promise.all(chunkRefs);
  const parts: string[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (!snap.exists()) {
      throw new Error('Gallery image data is incomplete.');
    }
    const chunkData = snap.data()?.data;
    if (typeof chunkData !== 'string' || chunkData.length === 0) {
      throw new Error('Gallery image data is invalid.');
    }
    parts.push(chunkData);
  }

  return base64ToBlob(parts.join(''), item.mimeType);
}

export async function fetchGalleryItemBlob(item: GalleryItem): Promise<Blob> {
  if (item.chunkCount && item.chunkCount > 0) {
    const cachedUrl = galleryBlobUrlCache.get(item.id);
    if (cachedUrl) {
      const cachedResp = await fetch(cachedUrl);
      if (cachedResp.ok) {
        return await cachedResp.blob();
      }
    }
    const cacheKey = `/_dmc_cache/full/${item.id}`;
    const persisted = await readPersistentCachedBlob(cacheKey);
    if (persisted) {
      return persisted;
    }
    const blob = await assembleChunkedBlob(item);
    void writePersistentCachedBlob(cacheKey, blob);
    return blob;
  }

  if (!item.imageUrl) {
    throw new Error('Image file is unavailable.');
  }

  const response = await fetch(item.imageUrl);
  if (!response.ok) {
    throw new Error('This image file is no longer available on the server.');
  }
  const blob = await response.blob();
  if (!blob || blob.size === 0) {
    throw new Error('Downloaded image is empty.');
  }
  return blob;
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

  if (supportersInflight && !options?.force) {
    return supportersInflight;
  }

  const docRef = doc(db, STATS_COLLECTION, SUPPORTERS_DOC_ID);
  const path = `${STATS_COLLECTION}/${SUPPORTERS_DOC_ID}`;

  const task = (async () => {
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const rawCount = snap.data()?.count;
        const normalized =
          typeof rawCount === 'number' && rawCount >= SUPPORTERS_BASE_COUNT
            ? rawCount
            : SUPPORTERS_BASE_COUNT;
        saveSupportersCountCache(normalized);
        broadcastSync({ type: 'supporters', count: normalized });
        return normalized;
      }

      // Initialize once at 700 baseline if document genuinely does not exist
      const initialCount = await runTransaction(db, async (tx) => {
        const txSnap = await tx.get(docRef);
        if (txSnap.exists()) {
          const rawCount = txSnap.data()?.count;
          return typeof rawCount === 'number' && rawCount >= SUPPORTERS_BASE_COUNT
            ? rawCount
            : SUPPORTERS_BASE_COUNT;
        }
        tx.set(docRef, {
          count: SUPPORTERS_BASE_COUNT,
          updatedAt: serverTimestamp(),
        });
        return SUPPORTERS_BASE_COUNT;
      });
      saveSupportersCountCache(initialCount);
      broadcastSync({ type: 'supporters', count: initialCount });
      return initialCount;
    } catch (error) {
      if (isQuotaExceededError(error)) {
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

export async function registerSupporterOnce(
  _action: 'import' | 'download' | 'upload' = 'download',
): Promise<{ count: number; alreadyRegistered: boolean; quotaDeferred?: boolean }> {
  const statsRef = doc(db, STATS_COLLECTION, SUPPORTERS_DOC_ID);
  const path = `${STATS_COLLECTION}/${SUPPORTERS_DOC_ID}`;

  try {
    const nextCount = await runTransaction(db, async (tx) => {
      const statsSnap = await tx.get(statsRef);
      const existingCount = statsSnap.exists()
        ? typeof statsSnap.data()?.count === 'number' && statsSnap.data()?.count >= 0
          ? statsSnap.data()?.count
          : 0
        : 0;

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
    });

    saveSupportersCountCache(nextCount);
    broadcastSync({ type: 'supporters', count: nextCount });
    return { count: nextCount, alreadyRegistered: false };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return {
        count: getCachedSupportersCount(),
        alreadyRegistered: false,
        quotaDeferred: true,
      };
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function incrementSupportersCounter(): Promise<number> {
  const result = await registerSupporterOnce('download');
  return result.count;
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

  if (configInflight && !options?.force) {
    return configInflight;
  }

  const path = `${CONFIG_COLLECTION}/${ACTIVE_CONFIG_ID}`;
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
    } catch {
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

export function getCachedGallerySnapshot(): GalleryPageResult | null {
  const cached = readJsonStorage<GalleryCachePayload>(GALLERY_CACHE_KEY);
  if (!cached || !Array.isArray(cached.items)) return null;
  const items = cached.items.map(fromCachedItem);
  const last = items.length > 0 ? items[items.length - 1] : null;
  return {
    items,
    totalCount: typeof cached.totalCount === 'number' ? cached.totalCount : items.length,
    hasMore: Boolean(cached.hasMore),
    lastDoc: null,
    lastCreatedAtMs: last?.createdAt ? last.createdAt.getTime() : null,
    fromCache: true,
  };
}

function saveGalleryCache(payload: GalleryCachePayload): void {
  writeJsonStorage(GALLERY_CACHE_KEY, payload);
  writeJsonStorage(GALLERY_COUNT_CACHE_KEY, {
    count: payload.totalCount,
    fetchedAt: payload.fetchedAt,
  });
}

function prependItemToGalleryCache(item: GalleryItem): void {
  const cached = readJsonStorage<GalleryCachePayload>(GALLERY_CACHE_KEY);
  const existingItems = cached?.items || [];
  const filtered = existingItems.filter((x) => x.id !== item.id);
  const nextItems = [toCachedItem(item), ...filtered].slice(0, 12);
  const nextCount = (cached?.totalCount ?? filtered.length) + 1;

  saveGalleryCache({
    items: nextItems,
    totalCount: nextCount,
    hasMore: Boolean(cached?.hasMore) || filtered.length >= 12,
    fetchedAt: Date.now(),
  });
  broadcastSync({ type: 'gallery' });
}

function removeItemFromGalleryCache(itemId: string): void {
  const cached = readJsonStorage<GalleryCachePayload>(GALLERY_CACHE_KEY);
  if (!cached) return;
  const nextItems = cached.items.filter((x) => x.id !== itemId);
  const nextCount = Math.max(0, (cached.totalCount || 1) - 1);
  saveGalleryCache({
    items: nextItems,
    totalCount: nextCount,
    hasMore: cached.hasMore,
    fetchedAt: cached.fetchedAt,
  });
  broadcastSync({ type: 'gallery' });
}

export async function uploadToGalleryWithProgress(
  blob: Blob,
  meta: {
    supporterName: string;
    city: string;
    mimeType: 'image/png' | 'image/jpeg';
    thumbnailBlob?: Blob;
  },
  onProgress: (percent: number) => void,
): Promise<GalleryItem> {
  const now = Date.now();
  if (now - lastUploadTimestamp < UPLOAD_COOLDOWN_MS) {
    throw new Error('Please wait a moment before uploading again.');
  }

  onProgress(30);
  await validateImageBlob(blob, meta.mimeType);

  onProgress(48);
  const shouldEncodeThumb = Boolean(
    meta.thumbnailBlob &&
      meta.thumbnailBlob.size > 128 &&
      meta.thumbnailBlob.size <= 350_000,
  );

  const [base64, encodedThumb] = await Promise.all([
    blobToBase64(blob),
    shouldEncodeThumb && meta.thumbnailBlob
      ? blobToBase64(meta.thumbnailBlob)
      : Promise.resolve(null),
  ]);

  const chunks: string[] = [];
  for (let offset = 0; offset < base64.length; offset += CHUNK_CHAR_LIMIT) {
    chunks.push(base64.slice(offset, offset + CHUNK_CHAR_LIMIT));
  }

  if (chunks.length === 0 || chunks.length >= 12) {
    throw new Error('Composed image is too large to save to the gallery.');
  }

  const thumbBase64 =
    encodedThumb && encodedThumb.length > 0 && encodedThumb.length <= 500_000
      ? encodedThumb
      : null;

  onProgress(72);

  const cleanName = meta.supporterName.trim().slice(0, 60);
  const cleanCity = meta.city.trim().slice(0, 60);
  const itemRef = doc(collection(db, GALLERY_COLLECTION));
  const imageRefUrl = `firestore://${itemRef.id}`;
  const hasThumbnail = Boolean(thumbBase64);

  try {
    const batch = writeBatch(db);
    batch.set(itemRef, {
      imageUrl: imageRefUrl,
      supporterName: cleanName,
      city: cleanCity,
      mimeType: meta.mimeType,
      fileSize: blob.size,
      chunkCount: chunks.length,
      hasThumbnail,
      createdAt: serverTimestamp(),
    });

    for (let i = 0; i < chunks.length; i++) {
      batch.set(doc(db, GALLERY_COLLECTION, itemRef.id, 'chunks', String(i)), {
        index: i,
        data: chunks[i],
      });
    }

    if (thumbBase64) {
      batch.set(doc(db, GALLERY_COLLECTION, itemRef.id, 'chunks', 'thumb'), {
        index: 0,
        data: thumbBase64,
      });
    }

    onProgress(86);
    await batch.commit();
    lastUploadTimestamp = Date.now();

    // Pre-warm both memory and persistent Cache API with full & thumbnail blobs
    const localUrl = URL.createObjectURL(blob);
    galleryBlobUrlCache.set(itemRef.id, localUrl);
    void writePersistentCachedBlob(`/_dmc_cache/full/${itemRef.id}`, blob);

    if (meta.thumbnailBlob && hasThumbnail) {
      const thumbUrl = URL.createObjectURL(meta.thumbnailBlob);
      galleryThumbUrlCache.set(itemRef.id, thumbUrl);
      void writePersistentCachedBlob(`/_dmc_cache/thumb/${itemRef.id}`, meta.thumbnailBlob);
    }

    const createdItem: GalleryItem = {
      id: itemRef.id,
      imageUrl: imageRefUrl,
      supporterName: cleanName,
      city: cleanCity,
      mimeType: meta.mimeType,
      fileSize: blob.size,
      chunkCount: chunks.length,
      hasThumbnail,
      createdAt: new Date(),
    };

    prependItemToGalleryCache(createdItem);
    onProgress(100);
    return createdItem;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, GALLERY_COLLECTION);
  }
}

export async function fetchGalleryTotalCount(options?: { force?: boolean }): Promise<number> {
  const cached = readJsonStorage<{ count: number; fetchedAt: number }>(GALLERY_COUNT_CACHE_KEY);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < GALLERY_COUNT_CACHE_TTL_MS) {
    return cached.count;
  }

  try {
    const q = query(
      collection(db, GALLERY_COLLECTION),
      where('createdAt', '>=', GALLERY_EPOCH_TIMESTAMP),
    );
    const snapshot = await getCountFromServer(q);
    const count = snapshot.data().count;
    writeJsonStorage(GALLERY_COUNT_CACHE_KEY, { count, fetchedAt: Date.now() });
    return count;
  } catch (error) {
    if (cached && isQuotaExceededError(error)) {
      return cached.count;
    }
    handleFirestoreError(error, OperationType.LIST, GALLERY_COLLECTION);
  }
}

export async function fetchGalleryInitialPage(
  pageSize: number,
  options?: { force?: boolean },
): Promise<GalleryPageResult> {
  const cachedPayload = readJsonStorage<GalleryCachePayload>(GALLERY_CACHE_KEY);
  const now = Date.now();

  if (
    !options?.force &&
    cachedPayload &&
    Array.isArray(cachedPayload.items) &&
    now - cachedPayload.fetchedAt < GALLERY_CACHE_TTL_MS &&
    cachedPayload.items.length <= pageSize
  ) {
    const cachedItems = cachedPayload.items.map(fromCachedItem);
    const last = cachedItems.length > 0 ? cachedItems[cachedItems.length - 1] : null;
    return {
      items: cachedItems,
      totalCount: cachedPayload.totalCount,
      hasMore: cachedPayload.hasMore,
      lastDoc: null,
      lastCreatedAtMs: last?.createdAt ? last.createdAt.getTime() : null,
      fromCache: true,
    };
  }

  if (galleryPageInflight && !options?.force) {
    return galleryPageInflight;
  }

  const task = (async (): Promise<GalleryPageResult> => {
    try {
      const q = query(
        collection(db, GALLERY_COLLECTION),
        where('createdAt', '>=', GALLERY_EPOCH_TIMESTAMP),
        orderBy('createdAt', 'desc'),
        limit(pageSize),
      );
      const snapshot = await getDocs(q);
      const items = snapshot.docs.map(mapGalleryDoc);
      const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
      const lastItem = items.length > 0 ? items[items.length - 1] : null;
      const hasMore = snapshot.docs.length === pageSize;

      // Avoid extra getCountFromServer reads whenever all items fit on page 1
      let totalCount = items.length;
      if (hasMore) {
        try {
          totalCount = await fetchGalleryTotalCount({ force: options?.force });
        } catch {
          totalCount = Math.max(items.length, cachedPayload?.totalCount || 0);
        }
      }

      if (items.length <= 12) {
        saveGalleryCache({
          items: items.map(toCachedItem),
          totalCount,
          hasMore,
          fetchedAt: Date.now(),
        });
      }

      return {
        items,
        totalCount,
        hasMore,
        lastDoc,
        lastCreatedAtMs: lastItem?.createdAt ? lastItem.createdAt.getTime() : null,
        fromCache: false,
      };
    } catch (error) {
      if (isQuotaExceededError(error) && cachedPayload && cachedPayload.items.length > 0) {
        const cachedItems = cachedPayload.items.map(fromCachedItem);
        const last = cachedItems.length > 0 ? cachedItems[cachedItems.length - 1] : null;
        return {
          items: cachedItems,
          totalCount: cachedPayload.totalCount,
          hasMore: cachedPayload.hasMore,
          lastDoc: null,
          lastCreatedAtMs: last?.createdAt ? last.createdAt.getTime() : null,
          fromCache: true,
          quotaFallback: true,
        };
      }
      handleFirestoreError(error, OperationType.LIST, GALLERY_COLLECTION);
    } finally {
      galleryPageInflight = null;
    }
  })();

  galleryPageInflight = task;
  return task;
}

export async function fetchNextGalleryPage(
  pageSize: number,
  cursor: QueryDocumentSnapshot<DocumentData> | number,
): Promise<{
  items: GalleryItem[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  lastCreatedAtMs: number | null;
  hasMore: boolean;
}> {
  try {
    const startAfterCursor =
      typeof cursor === 'number' ? Timestamp.fromMillis(cursor) : cursor;

    const q = query(
      collection(db, GALLERY_COLLECTION),
      where('createdAt', '>=', GALLERY_EPOCH_TIMESTAMP),
      orderBy('createdAt', 'desc'),
      startAfter(startAfterCursor),
      limit(pageSize),
    );
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map(mapGalleryDoc);
    const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
    const lastItem = items.length > 0 ? items[items.length - 1] : null;
    return {
      items,
      lastDoc,
      lastCreatedAtMs: lastItem?.createdAt ? lastItem.createdAt.getTime() : null,
      hasMore: snapshot.docs.length === pageSize,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, GALLERY_COLLECTION);
  }
}

export async function deleteGalleryItemAsAdmin(
  item: GalleryItem,
  idToken: string,
): Promise<void> {
  const docPath = `${GALLERY_COLLECTION}/${item.id}`;
  try {
    const batch = writeBatch(db);
    const chunkCount = item.chunkCount || 0;
    for (let i = 0; i < chunkCount; i++) {
      batch.delete(doc(db, GALLERY_COLLECTION, item.id, 'chunks', String(i)));
    }
    if (item.hasThumbnail) {
      batch.delete(doc(db, GALLERY_COLLECTION, item.id, 'chunks', 'thumb'));
    }
    batch.delete(doc(db, GALLERY_COLLECTION, item.id));
    await batch.commit();
    galleryBlobUrlCache.delete(item.id);
    galleryThumbUrlCache.delete(item.id);
    void deletePersistentCachedItem(item.id);
    removeItemFromGalleryCache(item.id);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }

  // Clean up stored image file on server if legacy local path
  if (item.imageUrl.startsWith('/uploads/gallery/')) {
    await fetch('/api/admin/gallery-file', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ imageUrl: item.imageUrl }),
    });
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

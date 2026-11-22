import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
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
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  CampaignConfig,
  DEFAULT_CAMPAIGN_CONFIG,
  FrameAsset,
  GalleryItem,
} from '../types/campaign';

const STATS_COLLECTION = 'stats';
const SUPPORTERS_DOC_ID = 'supporters';
const CONFIG_COLLECTION = 'campaign_config';
const ACTIVE_CONFIG_ID = 'active';
const GALLERY_COLLECTION = 'gallery_items';
const GALLERY_EPOCH_TIMESTAMP = Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'));
const CHUNK_CHAR_LIMIT = 450_000;

const galleryBlobUrlCache = new Map<string, string>();
const galleryBlobInflight = new Map<string, Promise<string>>();

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
    createdAt: mapTimestamp(data.createdAt),
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const blockSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += blockSize) {
    const slice = bytes.subarray(i, i + blockSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: 'image/png' | 'image/jpeg'): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function resolveGalleryItemImageUrl(item: GalleryItem): Promise<string> {
  if (!item.chunkCount || item.chunkCount <= 0) {
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

    const blob = base64ToBlob(parts.join(''), item.mimeType);
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

export function subscribeSupportersCount(
  onCount: (count: number) => void,
  onError?: (err: Error) => void,
): () => void {
  const path = `${STATS_COLLECTION}/${SUPPORTERS_DOC_ID}`;
  return onSnapshot(
    doc(db, STATS_COLLECTION, SUPPORTERS_DOC_ID),
    (snapshot) => {
      if (!snapshot.exists()) {
        onCount(0);
        return;
      }
      const rawCount = snapshot.data()?.count;
      onCount(typeof rawCount === 'number' && rawCount >= 0 ? rawCount : 0);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    },
  );
}

export async function initializeSupportersCounter(): Promise<number> {
  const docRef = doc(db, STATS_COLLECTION, SUPPORTERS_DOC_ID);
  const path = `${STATS_COLLECTION}/${SUPPORTERS_DOC_ID}`;
  try {
    const serverSnap = await getDocFromServer(docRef);
    if (serverSnap.exists()) {
      const rawCount = serverSnap.data()?.count;
      return typeof rawCount === 'number' && rawCount >= 0 ? rawCount : 0;
    }

    return await runTransaction(db, async (tx) => {
      const txSnap = await tx.get(docRef);
      if (txSnap.exists()) {
        const rawCount = txSnap.data()?.count;
        return typeof rawCount === 'number' && rawCount >= 0 ? rawCount : 0;
      }
      tx.set(docRef, {
        count: 0,
        updatedAt: serverTimestamp(),
      });
      return 0;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function incrementSupportersCounter(): Promise<number> {
  const docRef = doc(db, STATS_COLLECTION, SUPPORTERS_DOC_ID);
  const path = `${STATS_COLLECTION}/${SUPPORTERS_DOC_ID}`;
  try {
    const newCount = await runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists()) {
        tx.set(docRef, {
          count: 1,
          updatedAt: serverTimestamp(),
        });
        return 1;
      }
      const current = typeof snap.data()?.count === 'number' ? snap.data().count : 0;
      const next = current + 1;
      tx.update(docRef, {
        count: next,
        updatedAt: serverTimestamp(),
      });
      return next;
    });
    return newCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeCampaignConfig(
  onConfig: (config: CampaignConfig) => void,
  onError?: (err: Error) => void,
): () => void {
  const path = `${CONFIG_COLLECTION}/${ACTIVE_CONFIG_ID}`;
  return onSnapshot(
    doc(db, CONFIG_COLLECTION, ACTIVE_CONFIG_ID),
    (snapshot) => {
      if (!snapshot.exists()) {
        onConfig(DEFAULT_CAMPAIGN_CONFIG);
        return;
      }
      const data = snapshot.data();
      onConfig({
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
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    },
  );
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
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function uploadToGalleryWithProgress(
  blob: Blob,
  meta: {
    supporterName: string;
    city: string;
    mimeType: 'image/png' | 'image/jpeg';
  },
  onProgress: (percent: number) => void,
): Promise<GalleryItem> {
  onProgress(10);

  // Server-side rate limiting, spam check, and magic-byte image validation
  await new Promise<void>((resolve, reject) => {
    const formData = new FormData();
    const ext = meta.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    formData.append('image', blob, `dmc-campaign.${ext}`);
    formData.append('website', '');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/gallery/upload', true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const pct = 10 + Math.round((event.loaded / event.total) * 40);
        onProgress(Math.min(50, pct));
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && parsed.imageUrl) {
          resolve();
        } else {
          reject(new Error(parsed.error || 'Upload validation failed. Please try again.'));
        }
      } catch {
        reject(new Error('Unexpected server response during upload.'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading image.'));
    };

    xhr.send(formData);
  });

  onProgress(60);

  // Encode and store persistently in Firestore chunks so images survive restarts across all devices
  const base64 = await blobToBase64(blob);
  const chunks: string[] = [];
  for (let offset = 0; offset < base64.length; offset += CHUNK_CHAR_LIMIT) {
    chunks.push(base64.slice(offset, offset + CHUNK_CHAR_LIMIT));
  }

  if (chunks.length === 0 || chunks.length >= 12) {
    throw new Error('Composed image is too large to save to the gallery.');
  }

  onProgress(75);

  const cleanName = meta.supporterName.trim().slice(0, 60);
  const cleanCity = meta.city.trim().slice(0, 60);
  const itemRef = doc(collection(db, GALLERY_COLLECTION));
  const imageRefUrl = `firestore://${itemRef.id}`;

  try {
    const batch = writeBatch(db);
    batch.set(itemRef, {
      imageUrl: imageRefUrl,
      supporterName: cleanName,
      city: cleanCity,
      mimeType: meta.mimeType,
      fileSize: blob.size,
      chunkCount: chunks.length,
      createdAt: serverTimestamp(),
    });

    for (let i = 0; i < chunks.length; i++) {
      batch.set(doc(db, GALLERY_COLLECTION, itemRef.id, 'chunks', String(i)), {
        index: i,
        data: chunks[i],
      });
    }

    await batch.commit();

    // Pre-warm client cache with the newly uploaded image
    const localUrl = URL.createObjectURL(blob);
    galleryBlobUrlCache.set(itemRef.id, localUrl);

    onProgress(100);
    return {
      id: itemRef.id,
      imageUrl: imageRefUrl,
      supporterName: cleanName,
      city: cleanCity,
      mimeType: meta.mimeType,
      fileSize: blob.size,
      chunkCount: chunks.length,
      createdAt: new Date(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, GALLERY_COLLECTION);
  }
}

export async function fetchGalleryTotalCount(): Promise<number> {
  try {
    const q = query(
      collection(db, GALLERY_COLLECTION),
      where('createdAt', '>=', GALLERY_EPOCH_TIMESTAMP),
    );
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, GALLERY_COLLECTION);
  }
}

export function subscribeLatestGalleryItems(
  pageSize: number,
  onItems: (items: GalleryItem[], lastDoc: QueryDocumentSnapshot<DocumentData> | null) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, GALLERY_COLLECTION),
    where('createdAt', '>=', GALLERY_EPOCH_TIMESTAMP),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map(mapGalleryDoc);
      const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
      onItems(items, lastDoc);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, GALLERY_COLLECTION);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    },
  );
}

export async function fetchNextGalleryPage(
  pageSize: number,
  cursor: QueryDocumentSnapshot<DocumentData>,
): Promise<{
  items: GalleryItem[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}> {
  try {
    const q = query(
      collection(db, GALLERY_COLLECTION),
      where('createdAt', '>=', GALLERY_EPOCH_TIMESTAMP),
      orderBy('createdAt', 'desc'),
      startAfter(cursor),
      limit(pageSize),
    );
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map(mapGalleryDoc);
    const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
    return {
      items,
      lastDoc,
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
    batch.delete(doc(db, GALLERY_COLLECTION, item.id));
    await batch.commit();
    galleryBlobUrlCache.delete(item.id);
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

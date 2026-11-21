import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
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
    createdAt: mapTimestamp(data.createdAt),
  };
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
  const uploadResult = await new Promise<{
    imageUrl: string;
    mimeType: 'image/png' | 'image/jpeg';
    fileSize: number;
  }>((resolve, reject) => {
    const formData = new FormData();
    const ext = meta.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    formData.append('image', blob, `dmc-campaign.${ext}`);
    formData.append('website', '');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/gallery/upload', true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.min(92, Math.round((event.loaded / event.total) * 92));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && parsed.imageUrl) {
          onProgress(95);
          resolve({
            imageUrl: parsed.imageUrl,
            mimeType: parsed.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
            fileSize: Number(parsed.fileSize) || blob.size,
          });
        } else {
          reject(new Error(parsed.error || 'Upload failed. Please try again.'));
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

  const cleanName = meta.supporterName.trim().slice(0, 60);
  const cleanCity = meta.city.trim().slice(0, 60);

  try {
    const docRef = await addDoc(collection(db, GALLERY_COLLECTION), {
      imageUrl: uploadResult.imageUrl,
      supporterName: cleanName,
      city: cleanCity,
      mimeType: uploadResult.mimeType,
      fileSize: uploadResult.fileSize,
      createdAt: serverTimestamp(),
    });
    onProgress(100);
    return {
      id: docRef.id,
      imageUrl: uploadResult.imageUrl,
      supporterName: cleanName,
      city: cleanCity,
      mimeType: uploadResult.mimeType,
      fileSize: uploadResult.fileSize,
      createdAt: new Date(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, GALLERY_COLLECTION);
  }
}

export async function fetchGalleryTotalCount(): Promise<number> {
  try {
    const snapshot = await getCountFromServer(collection(db, GALLERY_COLLECTION));
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
    await deleteDoc(doc(db, GALLERY_COLLECTION, item.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }

  // Clean up stored image file on server (best-effort after DB record deleted)
  await fetch('/api/admin/gallery-file', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ imageUrl: item.imageUrl }),
  });
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

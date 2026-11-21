export type AppRoute = 'editor' | 'gallery' | 'admin';

export interface CampaignConfig {
  frameUrl: string;
  brandTitle: string;
  campaignTitle: string;
  campaignSubtitle: string;
  editorPrompt: string;
  updatedAt?: Date | null;
  updatedBy?: string;
}

export interface GalleryItem {
  id: string;
  imageUrl: string;
  supporterName: string;
  city: string;
  mimeType: 'image/png' | 'image/jpeg';
  fileSize: number;
  createdAt: Date | null;
}

export interface FrameAsset {
  frameUrl: string;
  label: string;
  isDefault: boolean;
  createdAt: number;
}

export const DEFAULT_FRAME_URL = '/assets/aistudio/frame_28fe0992.png';

export const DEFAULT_CAMPAIGN_CONFIG: CampaignConfig = {
  frameUrl: DEFAULT_FRAME_URL,
  brandTitle: 'DMC JUI Punjab',
  campaignTitle: 'Tahaffuz-e-Aaeen-e-Pakistan',
  campaignSubtitle: 'Awami Huqooq Conference · Sargodha · 26 November 2026',
  editorPrompt:
    'Import your portrait, adjust zoom and framing inside the official campaign frame, and download or share to the DMC Gallery.',
};

export const AUTHORIZED_ADMIN_EMAIL = 'graphicsmalik123@gmail.com';

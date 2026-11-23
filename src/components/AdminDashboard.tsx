import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  CheckCircle2,
  Lock,
  LogOut,
  Save,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';
import {
  listCampaignFramesAsAdmin,
  saveCampaignConfig,
  uploadCampaignFrameAsAdmin,
} from '../services/campaignService';
import {
  AUTHORIZED_ADMIN_EMAIL,
  CampaignConfig,
  FrameAsset,
} from '../types/campaign';

interface AdminDashboardProps {
  config: CampaignConfig;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  config,
}) => {
  const [authUser, setAuthUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Campaign Settings Form State
  const [frameUrl, setFrameUrl] = useState(config.frameUrl);
  const [brandTitle, setBrandTitle] = useState(config.brandTitle);
  const [campaignTitle, setCampaignTitle] = useState(config.campaignTitle);
  const [campaignSubtitle, setCampaignSubtitle] = useState(config.campaignSubtitle);
  const [editorPrompt, setEditorPrompt] = useState(config.editorPrompt);

  // Frame Management State
  const [frames, setFrames] = useState<FrameAsset[]>([]);
  const [uploadingFrame, setUploadingFrame] = useState(false);
  const [frameStatus, setFrameStatus] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSavedNotice, setConfigSavedNotice] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    setFrameUrl(config.frameUrl);
    setBrandTitle(config.brandTitle);
    setCampaignTitle(config.campaignTitle);
    setCampaignSubtitle(config.campaignSubtitle);
    setEditorPrompt(config.editorPrompt);
  }, [config]);

  const isAuthorizedAdmin = Boolean(
    authUser &&
      authUser.emailVerified &&
      authUser.email?.toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase(),
  );

  const loadFramesList = useCallback(async () => {
    if (!authUser || !isAuthorizedAdmin) return;
    try {
      const token = await authUser.getIdToken();
      const list = await listCampaignFramesAsAdmin(token);
      setFrames(list);
    } catch {
      // Non-fatal; active frame still displays
    }
  }, [authUser, isAuthorizedAdmin]);

  useEffect(() => {
    if (!isAuthorizedAdmin) return;
    void loadFramesList();
  }, [isAuthorizedAdmin, loadFramesList]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to complete administrator sign-in.',
      );
    }
  };

  const handleFrameUpload = async (file: File) => {
    if (!authUser || !isAuthorizedAdmin) return;
    setAdminError(null);
    setFrameStatus(null);

    if (file.type !== 'image/png') {
      setAdminError('Campaign frame must be a PNG file with a transparent background.');
      return;
    }

    setUploadingFrame(true);
    try {
      const token = await authUser.getIdToken();
      const result = await uploadCampaignFrameAsAdmin(file, token);
      setFrameUrl(result.frameUrl);

      await saveCampaignConfig(
        {
          frameUrl: result.frameUrl,
          brandTitle,
          campaignTitle,
          campaignSubtitle,
          editorPrompt,
        },
        authUser.uid,
      );

      setFrameStatus(
        result.hasAlpha
          ? `Uploaded and activated new PNG frame (${result.width}×${result.height}px, transparent alpha detected).`
          : `Uploaded and activated PNG (${result.width}×${result.height}px). Note: no alpha channel was detected—ensure the photo cutout area is transparent.`,
      );
      await loadFramesList();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to upload campaign frame.');
    } finally {
      setUploadingFrame(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || !isAuthorizedAdmin) return;
    setAdminError(null);
    setConfigSavedNotice(null);
    setSavingConfig(true);

    try {
      await saveCampaignConfig(
        {
          frameUrl,
          brandTitle,
          campaignTitle,
          campaignSubtitle,
          editorPrompt,
        },
        authUser.uid,
      );
      setConfigSavedNotice('Campaign branding and frame settings updated live.');
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to save campaign settings.');
    } finally {
      setSavingConfig(false);
    }
  };

  if (!authReady) {
    return (
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16 text-center text-sm text-[#5C6660]">
        Verifying administrator session...
      </section>
    );
  }

  // Gate 1: Unauthenticated visitor
  if (!authUser) {
    return (
      <section className="max-w-lg mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white border border-[#E4E7E2] rounded-2xl p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-[#F4F7F5] border border-[#DCE5DF] text-[#064E3B] flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold text-[#141D18]">
            Administrator Portal
          </h1>
          <p className="mt-2 text-sm text-[#5C6660] leading-relaxed">
            Restricted to authorized DMC JUI Punjab administrators. Sign in with your verified
            administrator Google account to manage campaign frames, branding, and gallery
            moderation.
          </p>

          {authError && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 text-xs font-medium">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="mt-6 w-full py-3 px-5 rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#053D2E] transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </section>
    );
  }

  // Gate 2: Signed in, but not authorized admin
  if (!isAuthorizedAdmin) {
    return (
      <section className="max-w-lg mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white border border-red-200 rounded-2xl p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold text-[#141D18]">
            Access Restricted
          </h1>
          <p className="mt-2 text-sm text-[#5C6660]">
            The signed-in account ({authUser.email || 'unknown'}) does not have administrator
            privileges for DMC JUI Punjab.
          </p>
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#E4E7E2] text-sm font-semibold text-[#141D18] hover:bg-[#F4F5F3]"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8">
      {/* Top Bar Summary */}
      <div className="pb-6 border-b border-[#E4E7E2] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-[#B08D57] uppercase">
            Authorized Management Console
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[#141D18]">
            Campaign Admin Dashboard
          </h1>
          <p className="mt-1 text-xs text-[#5C6660]">
            Signed in as {authUser.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void signOut(auth)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E4E7E2] bg-white text-sm font-semibold text-[#141D18] hover:bg-[#F4F5F3] self-start sm:self-auto"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>

      {/* KPI Metrics Strip */}
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white border border-[#E4E7E2] rounded-2xl p-5">
          <p className="text-xs font-semibold tracking-wider text-[#5C6660] uppercase">
            Available Campaign Frames
          </p>
          <p className="mt-2 font-mono-tabular text-3xl font-bold text-[#141D18]">
            {Math.max(1, frames.length)}
          </p>
        </div>
      </div>

      {adminError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm font-medium">
          {adminError}
        </div>
      )}

      {/* Campaign Frame Manager + Branding Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Frame Upload & Preview */}
        <div className="lg:col-span-5 bg-white border border-[#E4E7E2] rounded-2xl p-6 flex flex-col gap-5">
          <div>
            <h2 className="font-display text-lg font-bold text-[#141D18]">
              Campaign PNG Frame
            </h2>
            <p className="mt-1 text-xs text-[#5C6660]">
              Upload a transparent PNG frame. It automatically updates the Profile Studio for all
              visitors.
            </p>
          </div>

          {/* Checkerboard Preview */}
          <div className="aspect-square w-full max-w-[320px] mx-auto rounded-xl overflow-hidden border border-[#E4E7E2] checkerboard-bg">
            <img
              src={frameUrl}
              alt="Active campaign frame preview"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>

          <label className="w-full py-3 px-4 rounded-xl bg-[#064E3B] hover:bg-[#053D2E] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors">
            <Upload className="w-4 h-4" />
            {uploadingFrame ? 'Uploading PNG Frame...' : 'Upload & Activate New PNG Frame'}
            <input
              type="file"
              accept="image/png"
              disabled={uploadingFrame}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFrameUpload(file);
                e.target.value = '';
              }}
            />
          </label>

          {frameStatus && (
            <div className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#064E3B] rounded-xl px-3.5 py-2.5 text-xs font-medium flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{frameStatus}</span>
            </div>
          )}

          {/* Switch between existing uploaded frames */}
          {frames.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[#5C6660] uppercase tracking-wider mb-2">
                Saved Frames
              </h3>
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                {frames.map((frame) => {
                  const isSelected = frame.frameUrl === frameUrl;
                  return (
                    <button
                      key={frame.frameUrl}
                      type="button"
                      onClick={() => setFrameUrl(frame.frameUrl)}
                      className={`w-full p-2 rounded-xl border text-left flex items-center gap-3 transition-colors ${
                        isSelected
                          ? 'border-[#064E3B] bg-[#F2F7F4]'
                          : 'border-[#E4E7E2] hover:bg-[#FAF9F6]'
                      }`}
                    >
                      <img
                        src={frame.frameUrl}
                        alt={frame.label}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-lg object-contain checkerboard-bg border border-[#E4E7E2] shrink-0"
                      />
                      <span className="text-xs font-medium text-[#141D18] truncate flex-1">
                        {frame.label}
                      </span>
                      {isSelected && (
                        <span className="text-[11px] font-semibold text-[#064E3B] shrink-0">
                          Selected
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Website Branding & Campaign Copy Form */}
        <form
          onSubmit={handleSaveSettings}
          className="lg:col-span-7 bg-white border border-[#E4E7E2] rounded-2xl p-6 flex flex-col gap-5"
        >
          <div>
            <h2 className="font-display text-lg font-bold text-[#141D18]">
              Website Branding &amp; Campaign Settings
            </h2>
            <p className="mt-1 text-xs text-[#5C6660]">
              Update header branding, campaign title, event date, and visitor instructions without
              touching code.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label
                htmlFor="admin-brand-title"
                className="block text-xs font-semibold text-[#141D18] mb-1.5"
              >
                Website Header Brand Name
              </label>
              <input
                id="admin-brand-title"
                type="text"
                required
                maxLength={80}
                value={brandTitle}
                onChange={(e) => setBrandTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#E4E7E2] bg-[#FAF9F6] text-[#141D18] focus:outline-none focus:border-[#064E3B]"
              />
            </div>

            <div>
              <label
                htmlFor="admin-campaign-title"
                className="block text-xs font-semibold text-[#141D18] mb-1.5"
              >
                Campaign Headline
              </label>
              <input
                id="admin-campaign-title"
                type="text"
                required
                maxLength={120}
                value={campaignTitle}
                onChange={(e) => setCampaignTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#E4E7E2] bg-[#FAF9F6] text-[#141D18] focus:outline-none focus:border-[#064E3B]"
              />
            </div>

            <div>
              <label
                htmlFor="admin-campaign-subtitle"
                className="block text-xs font-semibold text-[#141D18] mb-1.5"
              >
                Event Details / Tagline
              </label>
              <input
                id="admin-campaign-subtitle"
                type="text"
                maxLength={200}
                value={campaignSubtitle}
                onChange={(e) => setCampaignSubtitle(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#E4E7E2] bg-[#FAF9F6] text-[#141D18] focus:outline-none focus:border-[#064E3B]"
              />
            </div>

            <div>
              <label
                htmlFor="admin-editor-prompt"
                className="block text-xs font-semibold text-[#141D18] mb-1.5"
              >
                Editor Instructions
              </label>
              <textarea
                id="admin-editor-prompt"
                rows={3}
                maxLength={240}
                value={editorPrompt}
                onChange={(e) => setEditorPrompt(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#E4E7E2] bg-[#FAF9F6] text-[#141D18] focus:outline-none focus:border-[#064E3B]"
              />
            </div>
          </div>

          {configSavedNotice && (
            <div className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#064E3B] rounded-xl px-4 py-2.5 text-xs font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{configSavedNotice}</span>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingConfig}
              className="px-6 py-2.5 rounded-xl bg-[#064E3B] hover:bg-[#053D2E] text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {savingConfig ? 'Saving Settings...' : 'Save Campaign Settings'}
            </button>
          </div>
        </form>
      </div>

    </section>
  );
};

import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

const firebaseConfig = {
  apiKey: environment?.PUBLIC_FIREBASE_API_KEY,
  authDomain: environment?.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: environment?.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: environment?.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: environment?.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: environment?.PUBLIC_FIREBASE_APP_ID,
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const appCheckSiteKey = environment?.PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
if (appCheckSiteKey && typeof window !== 'undefined') {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

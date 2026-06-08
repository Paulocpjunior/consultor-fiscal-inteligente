import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDIqWgUuLjkrrg1vQe5FuN1TY22WHoPQQs",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "consultorfiscalapp.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "consultorfiscalapp",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "consultorfiscalapp.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "631239634290",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:631239634290:web:1edfcab8ba8e21f27c41eb",
};

export const isFirebaseConfigured = true;

export const isFirebaseStorageConfigured =
  isFirebaseConfigured && !!firebaseConfig.storageBucket;

const apps = getApps();
const app: FirebaseApp = apps.length === 0
  ? initializeApp(firebaseConfig)
  : (apps[0] as FirebaseApp);

const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);
const storage: FirebaseStorage | null = isFirebaseStorageConfigured
  ? getStorage(app)
  : null;

if (!isFirebaseStorageConfigured) {
  console.warn('⚠️ Firebase Storage bucket não configurado. Upload de XMLs ficará indisponível.');
}

export { auth, db, storage };
export default app;

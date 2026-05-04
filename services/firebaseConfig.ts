import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDIqWgUuLjkrrg1vQe5FuN1TY22WHoPQQs",
  authDomain: "consultorfiscalapp.firebaseapp.com",
  projectId: "consultorfiscalapp",
  storageBucket: "consultorfiscalapp.firebasestorage.app",
  messagingSenderId: "631239634290",
  appId: "1:631239634290:web:1edfcab8ba8e21f27c41eb",
};

export const isFirebaseConfigured = true;

export const isFirebaseStorageConfigured =
  isFirebaseConfigured && !!firebaseConfig.storageBucket;

let app: FirebaseApp | undefined;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0];
auth = getAuth(app);
db = getFirestore(app);
if (isFirebaseStorageConfigured) {
  storage = getStorage(app);
} else {
  console.warn('⚠️ Firebase Storage bucket não configurado. Upload de XMLs ficará indisponível.');
}

export { auth, db, storage };
export default app;

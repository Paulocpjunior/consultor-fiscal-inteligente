import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// Configuracao Firebase via env vars (VITE_FIREBASE_*).
// Fallback hard-coded foi REMOVIDO em 06/2026 — evita que um fork malicioso
// rode com nosso projeto prod, e forca build do CI a passar as envs corretas.
// Em dev local, defina VITE_FIREBASE_API_KEY etc no .env.local.
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: env.VITE_FIREBASE_APP_ID as string,
};

const requiredKeys = ['apiKey','authDomain','projectId','messagingSenderId','appId'] as const;
const missing = requiredKeys.filter(k => !firebaseConfig[k]);
export const isFirebaseConfigured = missing.length === 0;
if (!isFirebaseConfigured) {
  console.error('❌ Firebase nao configurado. Defina as envs VITE_FIREBASE_*. Faltando:', missing.join(', '));
}

export const isFirebaseStorageConfigured =
  isFirebaseConfigured && !!firebaseConfig.storageBucket;

// Se as envs estao faltando, lanca erro fatal no boot. Isso e proposital:
// a app NAO pode rodar sem Firebase configurado, e sem isso o auth nao
// funciona. Codigo a jusante assume auth/db nao-null (centenas de pontos),
// entao um boot que falha cedo e melhor do que um booleano isFirebaseConfigured
// que cascateia null-checks por toda a base.
if (!isFirebaseConfigured) {
  throw new Error(
    `Firebase nao configurado. Defina as envs VITE_FIREBASE_* (faltando: ${missing.join(', ')}). ` +
    `Veja .env.example.`
  );
}

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

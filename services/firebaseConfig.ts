import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// Configuracao Firebase via env vars (VITE_FIREBASE_*).
// Fallback hard-coded foi REMOVIDO em 06/2026 — evita que um fork malicioso
// rode com nosso projeto prod, e forca build do CI a passar as envs corretas.
// Em dev local, defina VITE_FIREBASE_API_KEY etc no .env.local.
const env = import.meta.env;

const envString = (value: unknown, opts: { stripTrailingComma?: boolean } = {}): string => {
  let out = String(value || '').trim();
  if (opts.stripTrailingComma) out = out.replace(/,+$/, '').trim();
  return out;
};

const firebaseConfig = {
  apiKey: envString(env.VITE_FIREBASE_API_KEY),
  authDomain: envString(env.VITE_FIREBASE_AUTH_DOMAIN, { stripTrailingComma: true }),
  projectId: envString(env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: envString(env.VITE_FIREBASE_STORAGE_BUCKET) || undefined,
  messagingSenderId: envString(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: envString(env.VITE_FIREBASE_APP_ID),
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

// SESSÃO POR ABA, não por navegador (Paulo, 23/08: "devem SEMPRE forçar login
// do usuário toda vez que sair e voltar ao sistema"). O padrão do Firebase é
// browserLocalPersistence — o login sobrevivia a fechar o navegador, então
// quem abrisse o app dias depois entrava direto, num computador que pode ser
// compartilhado. browserSessionPersistence encerra ao fechar a aba/navegador
// e PRESERVA o F5: recarregar (inclusive o hard reload do UpdateBanner) não
// derruba ninguém no meio do trabalho.
setPersistence(auth, browserSessionPersistence).catch((e) => {
    // Navegador sem sessionStorage (modo restrito): segue no padrão em vez de
    // travar o login — mas DIZ, porque aí a sessão sobrevive ao fechamento.
    console.warn('[auth] não foi possível fixar a sessão por aba:', e?.message || e);
});
const db: Firestore = getFirestore(app);
const storage: FirebaseStorage | null = isFirebaseStorageConfigured
  ? getStorage(app)
  : null;

if (!isFirebaseStorageConfigured) {
  console.warn('⚠️ Firebase Storage bucket não configurado. Upload de XMLs ficará indisponível.');
}

export { auth, db, storage };
export default app;

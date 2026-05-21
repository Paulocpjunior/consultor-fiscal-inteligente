import admin from 'firebase-admin';
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
const db = admin.firestore();
const EMPRESA_ID = '858e9019-33c3-4694-97cb-65078597da25';

await db.collection('nfse_tomada_estado').doc(EMPRESA_ID).set({
    ultimoNSU: 0,
    ultimaSincronizacao: new Date().toISOString(),
    ultimoErro: null,
    resetadoEm: new Date().toISOString(),
}, { merge: true });

console.log("✅ ultimoNSU resetado pra 0 — proxima sync busca tudo desde inicio");
process.exit(0);

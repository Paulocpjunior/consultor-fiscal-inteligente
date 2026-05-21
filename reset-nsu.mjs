import admin from 'firebase-admin';
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
await admin.firestore().collection('nfse_tomada_estado')
  .doc('858e9019-33c3-4694-97cb-65078597da25')
  .set({ ultimoNSU: 0, resetadoEm: new Date().toISOString() }, { merge: true });
console.log("NSU resetado");
process.exit(0);

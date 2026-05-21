import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
const db = admin.firestore();

const EMPRESA_ID = '858e9019-33c3-4694-97cb-65078597da25';

console.log("=== Verifica cert metadata em empresas_certificados ===");
const certSnap = await db.collection('empresas_certificados').doc(EMPRESA_ID).get();
if (certSnap.exists) {
    const d = certSnap.data();
    console.log(`✅ Cert metadata existe`);
    console.log(`   CNPJ: ${d.cnpj}`);
    console.log(`   storagePath: ${d.storagePath}`);
    console.log(`   uploadedAt: ${d.uploadedAt}`);
    console.log(`   validUntil: ${d.validUntil}`);
} else {
    console.log(`❌ Sem cert metadata para empresa ${EMPRESA_ID}`);
}

console.log("\n=== Lista todos certs cadastrados ===");
const allCerts = await db.collection('empresas_certificados').get();
console.log(`Total: ${allCerts.size}`);
allCerts.forEach(d => {
    const data = d.data();
    console.log(`  ${d.id}: CNPJ=${data.cnpj} validUntil=${data.validUntil}`);
});

process.exit(0);

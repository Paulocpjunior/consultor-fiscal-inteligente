import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
const db = admin.firestore();

const EMPRESA_ID = '858e9019-33c3-4694-97cb-65078597da25';

console.log("=== 1. Verifica cert metadata em empresas_certificados ===");
const certSnap = await db.collection('empresas_certificados').doc(EMPRESA_ID).get();
if (certSnap.exists) {
    const d = certSnap.data();
    console.log(`✅ Cert metadata existe`);
    console.log(`   CNPJ: ${d.cnpj}`);
    console.log(`   storagePath: ${d.storagePath}`);
    console.log(`   validUntil: ${d.validUntil || '(?)'}`);
} else {
    console.log(`❌ SEM cert metadata para empresa ${EMPRESA_ID}`);
    console.log(`   -> Precisa carregar cert A1 pela UI (tela Certificados) ANTES de captura real`);
    console.log(`   -> Captura ainda vai funcionar em modo "restrita" mas vai dar erro ao chamar Sefin sem cert`);
}

console.log("\n=== 2. Ativa flag capturarNfseTomada=true ===");
await db.collection('simples_empresas').doc(EMPRESA_ID).update({
    capturarNfseTomada: true,
});
console.log(`✅ simples_empresas/${EMPRESA_ID}.capturarNfseTomada = true`);

console.log("\n=== 3. Confirma estado pos-update ===");
const after = await db.collection('simples_empresas').doc(EMPRESA_ID).get();
const data = after.data();
console.log(`   Nome: ${data.nome || data.razaoSocial}`);
console.log(`   CNPJ: ${data.cnpj}`);
console.log(`   capturarSefaz: ${data.capturarSefaz}`);
console.log(`   capturarNfseTomada: ${data.capturarNfseTomada}`);

process.exit(0);

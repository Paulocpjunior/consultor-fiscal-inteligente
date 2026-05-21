import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
const db = admin.firestore();
const storage = admin.storage();

const EMPRESA_ID = '858e9019-33c3-4694-97cb-65078597da25';
const SP_CNPJ_DIGITS = '44388152000189';

console.log("=== 1. Lista TODOS os certs cadastrados em empresas_certificados ===");
const allCerts = await db.collection('empresas_certificados').get();
console.log(`Total: ${allCerts.size} certs`);
allCerts.forEach(d => {
    const data = d.data();
    const isSP = data.cnpj?.replace(/\D/g, '') === SP_CNPJ_DIGITS;
    console.log(`  ${isSP ? '🎯' : '  '} ID: ${d.id}`);
    console.log(`     CNPJ: ${data.cnpj}`);
    console.log(`     storagePath: ${data.storagePath}`);
    console.log(`     uploadedAt: ${data.uploadedAt}`);
});

console.log("\n=== 2. Procura por OUTRAS coleções de certificados ===");
// As coleções top-level que podem conter "cert" no nome
const collections = await db.listCollections();
for (const col of collections) {
    if (col.id.toLowerCase().includes('cert') || col.id.toLowerCase().includes('certif')) {
        console.log(`  📂 Coleção encontrada: ${col.id}`);
    }
}

console.log("\n=== 3. Lista arquivos .pfx no Firebase Storage ===");
const bucket = storage.bucket();
try {
    const [files] = await bucket.getFiles({ prefix: 'certs/', maxResults: 50 });
    console.log(`Total: ${files.length} arquivos em certs/`);
    files.forEach(f => {
        const isSP = f.name.includes(EMPRESA_ID) || f.name.includes(SP_CNPJ_DIGITS);
        console.log(`  ${isSP ? '🎯' : '  '} ${f.name}  (${f.metadata.size} bytes, ${f.metadata.updated})`);
    });
} catch (err) {
    console.log(`  ❌ Erro: ${err.message}`);
}

process.exit(0);

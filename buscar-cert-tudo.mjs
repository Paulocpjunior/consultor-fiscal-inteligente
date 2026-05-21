import admin from 'firebase-admin';
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
const db = admin.firestore();
const storage = admin.storage();

console.log("=== Lista TODAS as coleções top-level ===");
const all = await db.listCollections();
all.forEach(c => console.log(`  📂 ${c.id}`));

console.log("\n=== Busca em TODAS as coleções por CNPJ 44388152000189 ===");
for (const col of all) {
    try {
        const snap = await col.where('cnpj', '==', '44388152000189').get();
        if (snap.size > 0) {
            console.log(`  🎯 ${col.id} (${snap.size} doc)`);
            snap.forEach(d => console.log(`     ID: ${d.id}`));
        }
    } catch (e) { /* coleção não tem campo cnpj, ignora */ }
}

console.log("\n=== Lista TUDO em certs/ no Storage ===");
const bucket = storage.bucket();
const [files] = await bucket.getFiles({ prefix: 'certs/', maxResults: 100 });
console.log(`Total arquivos: ${files.length}`);
const spFiles = files.filter(f => f.name.includes('858e9019') || f.name.includes('44388'));
console.log(`Filtrados (858e9019 ou 44388): ${spFiles.length}`);
spFiles.forEach(f => console.log(`  ${f.name} (${f.metadata.size} bytes)`));

console.log("\n=== Procura cert do escritório no Secret Manager ===");
console.log("(Pode estar lá em vez do Storage — usado pelo nfse-sp-client)");

process.exit(0);

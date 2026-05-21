import admin from 'firebase-admin';
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
const db = admin.firestore();

console.log("=== TODOS os 38 certs - apenas CNPJ ===");
const all = await db.collection('empresas_certificados').get();
const cnpjs = [];
all.forEach(d => {
    const data = d.data();
    cnpjs.push({ id: d.id, cnpj: data.cnpj });
});

// Procura especificamente CNPJs com '44' no inicio (S&P começa com 44388)
console.log("\n=== Filtro: CNPJs que começam com 44 ===");
const match44 = cnpjs.filter(c => (c.cnpj || '').startsWith('44'));
match44.forEach(c => console.log(`  ${c.id}: ${c.cnpj}`));

console.log("\n=== Filtro: CNPJ exato 44388152000189 ===");
const exact = cnpjs.filter(c => (c.cnpj || '').replace(/\D/g,'') === '44388152000189');
console.log(`Total: ${exact.length}`);
exact.forEach(c => console.log(`  ${c.id}: ${c.cnpj}`));

console.log("\n=== Verifica diretamente o doc por ID 858e9019-... (empresa S&P) ===");
const direct = await db.collection('empresas_certificados').doc('858e9019-33c3-4694-97cb-65078597da25').get();
console.log(`Existe? ${direct.exists}`);

process.exit(0);

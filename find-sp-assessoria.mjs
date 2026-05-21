import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
const db = admin.firestore();

const SP_CNPJS = ['44388152000189', '44.388.152/0001-89'];

for (const col of ['lucro_empresas', 'simples_empresas']) {
    console.log(`\n=== Coleção: ${col} ===`);
    for (const cnpj of SP_CNPJS) {
        const snap = await db.collection(col).where('cnpj', '==', cnpj).get();
        if (snap.size > 0) {
            for (const d of snap.docs) {
                const data = d.data();
                console.log(`✅ ID: ${d.id}`);
                console.log(`   Nome: ${data.nome || data.razaoSocial || '(sem nome)'}`);
                console.log(`   CNPJ: ${data.cnpj}`);
                console.log(`   capturarSefaz: ${data.capturarSefaz}`);
                console.log(`   capturarNfseTomada: ${data.capturarNfseTomada}`);
                console.log(`   certA1Carregado: ${data.certA1Carregado}`);
            }
        } else {
            console.log(`  (não achou com CNPJ=${cnpj})`);
        }
    }
}

// Procura também por nome contendo "SP" + "Assessoria" se não achou por CNPJ
console.log("\n=== Busca complementar por nome ===");
for (const col of ['lucro_empresas', 'simples_empresas']) {
    const snap = await db.collection(col).limit(500).get();
    for (const d of snap.docs) {
        const data = d.data();
        const nome = (data.nome || data.razaoSocial || '').toUpperCase();
        if (nome.includes('SP ASSESSORIA') || nome.includes('SP CONTAB') || nome.includes('S P ASSESSORIA')) {
            console.log(`✅ ${col}/${d.id}: ${nome} | CNPJ=${data.cnpj}`);
        }
    }
}

process.exit(0);

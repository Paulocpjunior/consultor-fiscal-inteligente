import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'consultorfiscalapp',
    });
}
const db = admin.firestore();

const EMPRESA_ID = '858e9019-33c3-4694-97cb-65078597da25';

console.log("=== 1. Estado da sincronização (nfse_tomada_estado) ===");
const estadoSnap = await db.collection('nfse_tomada_estado').doc(EMPRESA_ID).get();
if (estadoSnap.exists) {
    console.log(JSON.stringify(estadoSnap.data(), null, 2));
} else {
    console.log("❌ Não existe");
}

console.log("\n=== 2. NFSe Tomadas persistidas (nfse_tomadas) ===");
const tomadasSnap = await db.collection('nfse_tomadas')
    .where('empresaId', '==', EMPRESA_ID)
    .get();

console.log(`Total: ${tomadasSnap.size}`);
tomadasSnap.forEach(d => {
    const data = d.data();
    console.log(`\n  📄 Chave: ${d.id}`);
    console.log(`     Prestador: ${data.prestador?.nome} (CNPJ ${data.prestador?.cnpj})`);
    console.log(`     Serviço: ${data.servico?.descricao}`);
    console.log(`     Valor bruto: R$ ${data.valorBruto?.toFixed(2)}`);
    console.log(`     Valor líquido: R$ ${data.valorLiquido?.toFixed(2)}`);
    console.log(`     Manifestação: ${data.manifestacao}`);
    console.log(`     SharePoint URL: ${data.sharepointUrl || '(falhou)'}`);
    console.log(`     Modo captura: ${data.modoCaptura}`);
});

process.exit(0);

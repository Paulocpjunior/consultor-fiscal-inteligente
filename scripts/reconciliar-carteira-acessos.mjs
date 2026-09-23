import admin from 'firebase-admin';

const aplicar = process.argv.includes('--apply');
admin.initializeApp({ projectId: 'consultorfiscalapp', credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const users = await db.collection('users').select('role').get();
const links = await db.collection('carteiras').select('colaboradorUid', 'empresaId').get();
const ids = new Set(users.docs.map(d => d.id));
const orfaos = links.docs.filter(d => !ids.has(d.data().colaboradorUid)).length;
let alterados = 0;
for (const user of users.docs) {
    await db.runTransaction(async tx => {
        const ref = db.collection('carteira_acessos').doc(user.id);
        const atual = await tx.get(ref);
        const vinculos = await tx.get(db.collection('carteiras').where('colaboradorUid', '==', user.id));
        const empresaIds = [...new Set(vinculos.docs.map(d => d.data().empresaId).filter(id => typeof id === 'string' && id && !id.includes('/')))].sort();
        if (JSON.stringify(atual.data()?.empresaIds) !== JSON.stringify(empresaIds)) {
            alterados++;
            if (aplicar) tx.set(ref, { empresaIds, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
        }
    });
}
console.log(JSON.stringify({ aplicar, usuarios: users.size, vinculos: links.size, vinculosSemUsuario: orfaos, indicesDivergentes: alterados }));
await db.terminate();

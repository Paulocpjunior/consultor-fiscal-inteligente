import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, getDocs, collection, query, where, limit, documentId } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const env = await initializeTestEnvironment({ projectId: 'demo-cfi-audit',
    firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9198, rules: readFileSync('storage.rules', 'utf8') },
});
let assertions = 0;
async function ok(p) { await assertSucceeds(p); assertions++; }
async function denied(p) { await assertFails(p); assertions++; }
try {
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        for (const uid of ['admin', 'principal', 'apoio', 'fora', 'criador']) {
            await setDoc(doc(db, 'users', uid), { role: uid === 'admin' ? 'admin' : 'colaborador' });
            await setDoc(doc(db, 'carteira_acessos', uid), { empresaIds: ['principal', 'apoio'].includes(uid) ? ['empresa-a'] : [] });
        }
        await setDoc(doc(db, 'simples_empresas', 'empresa-a'), { nome: 'A', createdBy: 'criador' });
        await setDoc(doc(db, 'lucro_empresas', 'empresa-b'), { nome: 'B', createdBy: 'admin' });
        await setDoc(doc(db, 'documentos_fiscais', 'nota-a'), { empresaId: 'empresa-a', createdBy: 'system:cron' });
        await setDoc(doc(db, 'nfp_analises', 'empresa-a'), { empresaId: 'empresa-a', analisadoPorUid: 'admin' });
        await setDoc(doc(db, 'nfp_analises', 'prospect_12345678000199'), { empresaId: 'prospect_12345678000199', analisadoPorUid: 'principal' });
        await setDoc(doc(db, 'carteiras', 'vinculo-a'), { empresaId: 'empresa-a', colaboradorUid: 'principal' });
        for (const uid of ['admin', 'principal', 'apoio', 'criador']) {
            await uploadBytes(ref(context.storage(), `xmls/empresa-a/${uid}.xml`), new Uint8Array([60, 62]), { contentType: 'application/xml' });
        }
    });
    for (const uid of ['admin', 'principal', 'apoio', 'criador']) {
        const db = env.authenticatedContext(uid).firestore();
        await ok(getDoc(doc(db, 'simples_empresas', 'empresa-a')));
        await ok(updateDoc(doc(db, 'simples_empresas', 'empresa-a'), { nome: 'A editada' }));
        await ok(getDoc(doc(db, 'documentos_fiscais', 'nota-a')));
        await ok(getDocs(query(collection(db, 'documentos_fiscais'), where('empresaId', '==', 'empresa-a'), limit(500))));
        await ok(getDocs(query(collection(db, 'simples_empresas'), where(documentId(), '==', 'empresa-a'), limit(500))));
        await ok(getDoc(doc(db, 'nfp_analises', 'empresa-a')));
        const storage = env.authenticatedContext(uid).storage();
        await denied(uploadBytes(ref(storage, `xmls/empresa-a/${uid}.xml`), new Uint8Array([60, 62]), { contentType: 'application/xml' }));
        await ok(getBytes(ref(storage, `xmls/empresa-a/${uid}.xml`)));
    }
    const outsider = env.authenticatedContext('fora').firestore();
    await denied(getDoc(doc(outsider, 'simples_empresas', 'empresa-a')));
    await denied(getDoc(doc(outsider, 'documentos_fiscais', 'nota-a')));
    await denied(updateDoc(doc(outsider, 'simples_empresas', 'empresa-a'), { nome: 'fraude' }));
    await denied(getDocs(query(collection(outsider, 'simples_empresas'), limit(500))));
    await denied(setDoc(doc(outsider, 'carteira_acessos', 'fora'), { empresaIds: ['empresa-a'] }));
    await denied(setDoc(doc(outsider, 'documentos_fiscais', 'nova'), { empresaId: 'empresa-a', createdBy: 'fora' }));
    await denied(getDoc(doc(outsider, 'nfp_analises', 'empresa-a')));
    await denied(getDoc(doc(outsider, 'nfp_analises', 'prospect_12345678000199')));
    const principal = env.authenticatedContext('principal').firestore();
    await ok(getDocs(query(collection(principal, 'documentos_fiscais'), where('empresaId', '==', 'empresa-a'), where('empresaId', '==', 'empresa-a'), limit(500))));
    await denied(updateDoc(doc(principal, 'documentos_fiscais', 'nota-a'), { empresaId: 'empresa-b' }));
    await denied(getDoc(doc(principal, 'lucro_empresas', 'empresa-b')));
    await ok(getDocs(query(collection(principal, 'carteiras'), where('colaboradorUid', '==', 'principal'), limit(500))));
    await denied(getDocs(query(collection(principal, 'carteiras'), limit(500))));
    await ok(getDoc(doc(principal, 'nfp_analises', 'prospect_12345678000199')));
    await denied(getBytes(ref(env.authenticatedContext('fora').storage(), 'xmls/empresa-a/principal.xml')));
    await denied(uploadBytes(ref(env.authenticatedContext('fora').storage(), 'nfse_pdfs/empresa-a/x.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' }));
    await denied(deleteObject(ref(env.authenticatedContext('principal').storage(), 'xmls/empresa-a/principal.xml')));
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'carteira_acessos', 'principal'), { empresaIds: [] }));
    await denied(getDoc(doc(principal, 'simples_empresas', 'empresa-a')));
    await denied(getBytes(ref(env.authenticatedContext('principal').storage(), 'xmls/empresa-a/principal.xml')));
    console.log(`Carteira: ${assertions} verificacoes de regras aprovadas.`);
} finally { await env.cleanup(); }

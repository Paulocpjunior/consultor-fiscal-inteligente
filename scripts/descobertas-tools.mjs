// scripts/descobertas-tools.mjs
// Triagem das empresas auto-descobertas no portal NFSe SP.
//
// O cron do portal cria stubs em `nfsesp_empresas_descobertas` quando acha
// um prestador autorizado (por CCM) que NÃO tem cadastro no Firestore.
// Ficam com statusCadastro='pendente-cnpj' e sem CNPJ. Esta ferramenta:
//   - list        — lista as descobertas (com status)
//   - status      — resumo por statusCadastro
//   - reconciliar — auto-vincula descobertas cujo CCM já bate com o ccmSp de
//                   uma empresa cadastrada (marca 'vinculada' + empresaId)
//   - ignorar <ccm> — marca uma descoberta como 'ignorada' (ruído)
//
// Uso (ADC do gcloud):
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/descobertas-tools.mjs list
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/descobertas-tools.mjs status
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/descobertas-tools.mjs reconciliar [--apply]
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/descobertas-tools.mjs ignorar 1234567

import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

const COL_DESCOBERTAS = 'nfsesp_empresas_descobertas';
const COLECOES_EMPRESA = ['simples_empresas', 'lucro_empresas'];
const normCcm = (s) => String(s || '').replace(/\D/g, '');
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

async function carregarDescobertas() {
    const snap = await db.collection(COL_DESCOBERTAS).get();
    return snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
}

// Map ccm (normalizado) -> empresa cadastrada (ignora perdedores do merge)
async function carregarEmpresasPorCcm() {
    const porCcm = new Map();
    for (const colecao of COLECOES_EMPRESA) {
        const snap = await db.collection(colecao).get();
        snap.forEach(d => {
            const e = d.data();
            if (e._merged_into) return;
            const ccm = normCcm(e.ccmSp);
            if (ccm) porCcm.set(ccm, {
                empresaId: d.id, empresaColecao: colecao,
                empresaNome: e.razaoSocial || e.nome || '', empresaCnpj: soDigitos(e.cnpj || e.empresaCnpj),
            });
        });
    }
    return porCcm;
}

async function cmdList() {
    const descs = await carregarDescobertas();
    descs.sort((a, b) => (a.statusCadastro || '').localeCompare(b.statusCadastro || ''));
    console.log(JSON.stringify({
        total: descs.length,
        descobertas: descs.map(d => ({
            ccm: d.ccm, nome: d.nome, statusCadastro: d.statusCadastro || '?',
            empresaId: d.empresaId || null,
            descobertoEm: d.descobertoEm?.toDate?.()?.toISOString?.()?.slice(0, 10) || null,
        })),
    }, null, 2));
}

async function cmdStatus() {
    const descs = await carregarDescobertas();
    const porStatus = {};
    for (const d of descs) porStatus[d.statusCadastro || '?'] = (porStatus[d.statusCadastro || '?'] || 0) + 1;
    console.log(JSON.stringify({ total: descs.length, porStatus }, null, 2));
}

async function cmdReconciliar(apply) {
    const [descs, porCcm] = await Promise.all([carregarDescobertas(), carregarEmpresasPorCcm()]);
    const log = { apply: !!apply, avaliadas: 0, vinculadas: 0, jaVinculadas: 0, semMatch: 0, ignoradas: 0 };
    const detalhe = [];
    let batch = db.batch();
    let n = 0;
    for (const d of descs) {
        if (d.statusCadastro === 'vinculada') { log.jaVinculadas++; continue; }
        if (d.statusCadastro === 'ignorada') { log.ignoradas++; continue; }
        log.avaliadas++;
        const emp = porCcm.get(normCcm(d.ccm));
        if (!emp) { log.semMatch++; continue; }
        detalhe.push({ ccm: d.ccm, nome: d.nome, vinculadaA: emp.empresaNome, empresaId: emp.empresaId, cnpj: emp.empresaCnpj });
        if (apply) {
            batch.update(d.ref, {
                statusCadastro: 'vinculada',
                empresaId: emp.empresaId,
                empresaColecao: emp.empresaColecao,
                empresaCnpj: emp.empresaCnpj,
                vinculadoEm: admin.firestore.FieldValue.serverTimestamp(),
                vinculadoPor: 'descobertas-tools',
            });
            n++;
            if (n % 400 === 0) { await batch.commit(); batch = db.batch(); }
        }
        log.vinculadas++;
    }
    if (apply && n % 400 !== 0) await batch.commit();
    console.log(JSON.stringify({ ...log, detalhe }, null, 2));
    console.log(apply
        ? '\n✓ descobertas vinculadas às empresas com CCM correspondente.'
        : '\n(DRY-RUN — nada gravado. Rode com --apply pra vincular.)');
}

async function cmdIgnorar(ccm) {
    if (!ccm) { console.error('✗ informe o CCM'); process.exit(1); }
    const stubId = `ccm-${ccm}`;
    const ref = db.collection(COL_DESCOBERTAS).doc(stubId);
    const snap = await ref.get();
    if (!snap.exists) { console.error(`✗ descoberta ${stubId} não encontrada`); process.exit(1); }
    await ref.update({ statusCadastro: 'ignorada', ignoradoEm: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`✓ ${stubId} marcada como ignorada`);
}

const [cmd, arg] = process.argv.slice(2);
const apply = process.argv.includes('--apply');
const arg1 = arg && !arg.startsWith('--') ? arg : null;

try {
    if (cmd === 'list') await cmdList();
    else if (cmd === 'status') await cmdStatus();
    else if (cmd === 'reconciliar') await cmdReconciliar(apply);
    else if (cmd === 'ignorar') await cmdIgnorar(arg1);
    else console.log('Comandos: list | status | reconciliar [--apply] | ignorar <ccm>');
} catch (e) {
    console.error('✗ erro:', e.message);
    process.exit(1);
}
process.exit(0);

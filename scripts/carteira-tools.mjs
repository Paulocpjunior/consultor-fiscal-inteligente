// scripts/carteira-tools.mjs
// Ferramenta de gestão em massa da carteira (empresa <-> colaborador).
//
// A coleção `carteiras` liga empresaId+colaboradorUid (papel principal/backup).
// O backfill aplicarCarteiraRetroativo() usa papel='principal' pra atribuir
// responsável às tarefas sem dono. Esta ferramenta popula a carteira em massa.
//
// Uso (com ADC do gcloud — rode antes: gcloud auth application-default login):
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs status
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs import carteira.csv [--dry-run]
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs atribuir-todas junior@spassessoriacontabil.com.br [--dry-run]
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs aplicar
//
// Formato do CSV (separador , ou ;):
//   cnpj,email[,papel]
//   44.388.152/0001-89,fulano@spassessoriacontabil.com.br
//   12345678000199,ciclana@spassessoriacontabil.com.br,principal
// (cabeçalho opcional — detectado e ignorado. papel default = principal.)

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

const COLECOES_EMPRESA = ['simples_empresas', 'lucro_empresas'];
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// ─── Carregadores ───────────────────────────────────────────────────────────
async function carregarUsuarios() {
    const snap = await db.collection('users').get();
    const porEmail = new Map();
    snap.forEach(d => {
        const x = d.data();
        const email = (x.email || '').trim().toLowerCase();
        const nome = x.nome || x.displayName || x.name || email;
        if (email) porEmail.set(email, { uid: d.id, nome, email, role: x.role || 'colaborador' });
    });
    return porEmail;
}

async function carregarEmpresas() {
    const porCnpj = new Map();
    const todas = [];
    for (const colecao of COLECOES_EMPRESA) {
        const snap = await db.collection(colecao).get();
        snap.forEach(d => {
            const e = d.data();
            const cnpj = soDigitos(e.cnpj || e.empresaCnpj);
            const nome = e.razaoSocial || e.nome || e.empresaNome || '';
            const reg = { empresaId: d.id, empresaColecao: colecao, empresaNome: nome, empresaCnpj: cnpj };
            todas.push(reg);
            if (cnpj) porCnpj.set(cnpj, reg);
        });
    }
    return { porCnpj, todas };
}

async function carregarCarteirasExistentes() {
    const snap = await db.collection('carteiras').get();
    const pares = new Set(); // `${empresaId}|${colaboradorUid}`
    const principalPorEmpresa = new Set(); // empresaId que já tem principal
    snap.forEach(d => {
        const c = d.data();
        pares.add(`${c.empresaId}|${c.colaboradorUid}`);
        if (c.papel === 'principal') principalPorEmpresa.add(c.empresaId);
    });
    return { total: snap.size, pares, principalPorEmpresa };
}

// ─── Comandos ─────────────────────────────────────────────────────────────--
async function cmdStatus() {
    const [usuarios, empresas, carteiras] = await Promise.all([
        carregarUsuarios(), carregarEmpresas(), carregarCarteirasExistentes(),
    ]);
    const admins = [...usuarios.values()].filter(u => u.role === 'admin').length;

    // tarefas sem responsável (a_fazer + em_andamento)
    const [a, b] = await Promise.all([
        db.collection('tarefas').where('status', '==', 'a_fazer').where('responsavel', '==', null).get(),
        db.collection('tarefas').where('status', '==', 'em_andamento').where('responsavel', '==', null).get(),
    ]);

    console.log(JSON.stringify({
        usuarios: usuarios.size,
        admins,
        colaboradores: usuarios.size - admins,
        empresas: empresas.todas.length,
        empresasSimples: empresas.todas.filter(e => e.empresaColecao === 'simples_empresas').length,
        empresasLucro: empresas.todas.filter(e => e.empresaColecao === 'lucro_empresas').length,
        empresasComCnpj: [...empresas.porCnpj.keys()].length,
        carteiras_vinculos: carteiras.total,
        empresas_com_titular_principal: carteiras.principalPorEmpresa.size,
        empresas_SEM_titular: empresas.todas.length - carteiras.principalPorEmpresa.size,
        tarefas_ativas_sem_responsavel: a.size + b.size,
    }, null, 2));
}

function parseCsv(caminho) {
    const txt = readFileSync(caminho, 'utf8');
    const linhas = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const rows = [];
    for (const linha of linhas) {
        const cols = linha.split(/[;,]/).map(c => c.trim());
        const cnpj = soDigitos(cols[0]);
        const email = (cols[1] || '').toLowerCase();
        const papel = (cols[2] || 'principal').toLowerCase() === 'backup' ? 'backup' : 'principal';
        // pula cabeçalho (col0 sem dígitos suficientes)
        if (cnpj.length < 14) continue;
        rows.push({ cnpj, email, papel });
    }
    return rows;
}

async function gravarVinculos(vinculos, dryRun) {
    const carteiras = await carregarCarteirasExistentes();
    const log = { criados: 0, jaExistiam: 0, vinculos: vinculos.length };
    let batch = db.batch();
    let n = 0;
    for (const v of vinculos) {
        const chave = `${v.empresaId}|${v.colaboradorUid}`;
        if (carteiras.pares.has(chave)) { log.jaExistiam++; continue; }
        carteiras.pares.add(chave);
        if (!dryRun) {
            const ref = db.collection('carteiras').doc();
            batch.set(ref, {
                empresaId: v.empresaId,
                empresaColecao: v.empresaColecao,
                empresaNome: v.empresaNome,
                empresaCnpj: v.empresaCnpj,
                colaboradorUid: v.colaboradorUid,
                colaboradorNome: v.colaboradorNome,
                papel: v.papel,
                atribuidoPor: 'script-carteira-tools',
                atribuidoEm: admin.firestore.FieldValue.serverTimestamp(),
            });
            n++;
            if (n % 400 === 0) { await batch.commit(); batch = db.batch(); }
        }
        log.criados++;
    }
    if (!dryRun && n % 400 !== 0) await batch.commit();
    return log;
}

async function cmdImport(caminho, dryRun) {
    if (!caminho) { console.error('✗ informe o caminho do CSV'); process.exit(1); }
    const [usuarios, empresas] = await Promise.all([carregarUsuarios(), carregarEmpresas()]);
    const rows = parseCsv(caminho);

    const vinculos = [];
    const cnpjNaoEncontrado = [];
    const emailNaoEncontrado = new Set();
    for (const r of rows) {
        const emp = empresas.porCnpj.get(r.cnpj);
        const col = usuarios.get(r.email);
        if (!emp) { cnpjNaoEncontrado.push(r.cnpj); continue; }
        if (!col) { emailNaoEncontrado.add(r.email); continue; }
        vinculos.push({ ...emp, colaboradorUid: col.uid, colaboradorNome: col.nome, papel: r.papel });
    }

    const log = await gravarVinculos(vinculos, dryRun);
    console.log(JSON.stringify({
        dryRun: !!dryRun,
        linhasCsv: rows.length,
        vinculosResolvidos: vinculos.length,
        ...log,
        cnpjNaoEncontrado: cnpjNaoEncontrado.slice(0, 30),
        cnpjNaoEncontradoTotal: cnpjNaoEncontrado.length,
        emailNaoEncontrado: [...emailNaoEncontrado],
    }, null, 2));
    console.log(dryRun ? '\n(DRY-RUN — nada gravado. Rode sem --dry-run pra aplicar.)' : '\n✓ carteiras gravadas. Agora rode: node scripts/carteira-tools.mjs aplicar');
}

async function cmdAtribuirTodas(email, dryRun) {
    if (!email) { console.error('✗ informe o email do colaborador'); process.exit(1); }
    const [usuarios, empresas] = await Promise.all([carregarUsuarios(), carregarEmpresas()]);
    const col = usuarios.get(email.toLowerCase());
    if (!col) { console.error(`✗ colaborador "${email}" não encontrado em users`); process.exit(1); }

    const vinculos = empresas.todas
        .filter(e => e.empresaCnpj)
        .map(e => ({ ...e, colaboradorUid: col.uid, colaboradorNome: col.nome, papel: 'principal' }));

    const log = await gravarVinculos(vinculos, dryRun);
    console.log(JSON.stringify({ dryRun: !!dryRun, colaborador: col.nome, email: col.email, empresas: vinculos.length, ...log }, null, 2));
    console.log(dryRun ? '\n(DRY-RUN — nada gravado.)' : '\n✓ carteiras gravadas. Agora rode: node scripts/carteira-tools.mjs aplicar');
}

async function cmdAplicar() {
    const { aplicarCarteiraRetroativo } = await import('../sefaz-backend/tarefas-orchestrator.js');
    const r = await aplicarCarteiraRetroativo();
    console.log(JSON.stringify(r, null, 2));
}

// ─── Dispatch ────────────────────────────────────────────────────────────--
const [cmd, arg] = process.argv.slice(2);
const dryRun = process.argv.includes('--dry-run');
const arg1 = arg && !arg.startsWith('--') ? arg : null;

try {
    if (cmd === 'status') await cmdStatus();
    else if (cmd === 'import') await cmdImport(arg1, dryRun);
    else if (cmd === 'atribuir-todas') await cmdAtribuirTodas(arg1, dryRun);
    else if (cmd === 'aplicar') await cmdAplicar();
    else {
        console.log('Comandos: status | import <csv> [--dry-run] | atribuir-todas <email> [--dry-run] | aplicar');
    }
} catch (e) {
    console.error('✗ erro:', e.message);
    process.exit(1);
}
process.exit(0);

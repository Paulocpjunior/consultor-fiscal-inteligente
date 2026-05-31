// scripts/carteira-tools.mjs
// Ferramenta de gestão em massa da carteira (empresa <-> colaborador).
//
// A coleção `carteiras` liga empresaId+colaboradorUid (papel principal/backup).
// O backfill aplicarCarteiraRetroativo() usa papel='principal' pra atribuir
// responsável às tarefas sem dono. Esta ferramenta popula a carteira em massa.
//
// Uso (com ADC do gcloud — rode antes: gcloud auth application-default login):
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs status
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs exportar-empresas carteira.csv
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs import carteira.csv [--dry-run]
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs atribuir-todas junior@spassessoriacontabil.com.br [--dry-run]
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/carteira-tools.mjs aplicar
//
// Fluxo recomendado:
//   1. exportar-empresas carteira.csv   → gera CSV com TODAS as empresas
//   2. preencha a coluna `email` (e `papel` se quiser) no Excel/Sheets
//   3. import carteira.csv --dry-run    → confere o que casou
//   4. import carteira.csv              → grava
//   5. aplicar                          → atribui responsável às tarefas órfãs
//
// O CSV é casado por `cnpj`; se o cnpj estiver vazio (empresa sem CNPJ),
// casa pelo `empresaId` (coluna preservada na exportação). Cabeçalho é
// detectado automaticamente; sem cabeçalho, assume ordem cnpj,email,papel.

import admin from 'firebase-admin';
import { readFileSync, writeFileSync } from 'fs';

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

const COLECOES_EMPRESA = ['simples_empresas', 'lucro_empresas'];
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const limpa = (s) => String(s || '').replace(/[;,\r\n]/g, ' ').trim(); // p/ campos textuais no CSV

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
    const porId = new Map();
    const todas = [];
    for (const colecao of COLECOES_EMPRESA) {
        const snap = await db.collection(colecao).get();
        snap.forEach(d => {
            const e = d.data();
            const cnpj = soDigitos(e.cnpj || e.empresaCnpj);
            const nome = e.razaoSocial || e.nome || e.empresaNome || '';
            const reg = { empresaId: d.id, empresaColecao: colecao, empresaNome: nome, empresaCnpj: cnpj };
            todas.push(reg);
            porId.set(d.id, reg);
            if (cnpj) porCnpj.set(cnpj, reg);
        });
    }
    return { porCnpj, porId, todas };
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

// ─── status ─────────────────────────────────────────────────────────────────
async function cmdStatus() {
    const [usuarios, empresas, carteiras] = await Promise.all([
        carregarUsuarios(), carregarEmpresas(), carregarCarteirasExistentes(),
    ]);
    const admins = [...usuarios.values()].filter(u => u.role === 'admin').length;
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
        empresasSemCnpj: empresas.todas.filter(e => !e.empresaCnpj).length,
        carteiras_vinculos: carteiras.total,
        empresas_com_titular_principal: carteiras.principalPorEmpresa.size,
        empresas_SEM_titular: empresas.todas.length - carteiras.principalPorEmpresa.size,
        tarefas_ativas_sem_responsavel: a.size + b.size,
    }, null, 2));
}

// ─── exportar-empresas ────────────────────────────────────────────────────--
async function cmdExportarEmpresas(caminho) {
    if (!caminho) { console.error('✗ informe o caminho de saída (ex: carteira.csv)'); process.exit(1); }
    const empresas = await carregarEmpresas();
    const linhas = ['cnpj,nome,email,papel,empresaColecao,empresaId'];
    // ordena por colecao + nome pra ficar fácil de preencher
    const ordenadas = [...empresas.todas].sort((x, y) =>
        (x.empresaColecao + x.empresaNome).localeCompare(y.empresaColecao + y.empresaNome));
    for (const e of ordenadas) {
        linhas.push([e.empresaCnpj, limpa(e.empresaNome), '', 'principal', e.empresaColecao, e.empresaId].join(','));
    }
    writeFileSync(caminho, linhas.join('\n') + '\n', 'utf8');
    console.log(`✓ ${ordenadas.length} empresas exportadas em ${caminho}`);
    console.log('  Preencha a coluna "email" (colaborador cadastrado em users) e rode:');
    console.log(`  node scripts/carteira-tools.mjs import ${caminho} --dry-run`);
}

// ─── parse CSV (header-aware) ─────────────────────────────────────────────--
function parseCsv(caminho) {
    const txt = readFileSync(caminho, 'utf8');
    const linhas = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (linhas.length === 0) return [];

    // detecta cabeçalho
    const primeira = linhas[0].toLowerCase();
    let idx = { cnpj: 0, email: 1, papel: 2, empresaId: -1 };
    let inicio = 0;
    if (primeira.includes('email') || primeira.includes('cnpj') || primeira.includes('empresaid')) {
        const cols = linhas[0].split(/[;,]/).map(c => c.trim().toLowerCase());
        idx = {
            cnpj: cols.indexOf('cnpj'),
            email: cols.indexOf('email'),
            papel: cols.indexOf('papel'),
            empresaId: cols.findIndex(c => c === 'empresaid'),
        };
        inicio = 1;
    }

    const rows = [];
    for (let i = inicio; i < linhas.length; i++) {
        const cols = linhas[i].split(/[;,]/).map(c => c.trim());
        const cnpj = soDigitos(idx.cnpj >= 0 ? cols[idx.cnpj] : '');
        const email = (idx.email >= 0 ? cols[idx.email] : '').toLowerCase();
        const papelRaw = (idx.papel >= 0 ? cols[idx.papel] : '') || 'principal';
        const papel = papelRaw.toLowerCase() === 'backup' ? 'backup' : 'principal';
        const empresaId = idx.empresaId >= 0 ? (cols[idx.empresaId] || '') : '';
        // ignora linha sem chave de empresa nem email
        if (!email || (cnpj.length < 14 && !empresaId)) continue;
        rows.push({ cnpj, email, papel, empresaId });
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

// ─── import ─────────────────────────────────────────────────────────────────
async function cmdImport(caminho, dryRun) {
    if (!caminho) { console.error('✗ informe o caminho do CSV'); process.exit(1); }
    const [usuarios, empresas] = await Promise.all([carregarUsuarios(), carregarEmpresas()]);
    const rows = parseCsv(caminho);

    const vinculos = [];
    const cnpjNaoEncontrado = [];
    const emailNaoEncontrado = new Set();
    let doisPrincipais = 0;
    const principalVisto = new Set();
    for (const r of rows) {
        const emp = (r.cnpj && empresas.porCnpj.get(r.cnpj)) || (r.empresaId && empresas.porId.get(r.empresaId));
        const col = usuarios.get(r.email);
        if (!emp) { cnpjNaoEncontrado.push(r.cnpj || r.empresaId); continue; }
        if (!col) { emailNaoEncontrado.add(r.email); continue; }
        if (r.papel === 'principal') {
            if (principalVisto.has(emp.empresaId)) { doisPrincipais++; continue; } // mantém o 1º principal
            principalVisto.add(emp.empresaId);
        }
        vinculos.push({ ...emp, colaboradorUid: col.uid, colaboradorNome: col.nome, papel: r.papel });
    }

    const log = await gravarVinculos(vinculos, dryRun);
    console.log(JSON.stringify({
        dryRun: !!dryRun,
        linhasCsv: rows.length,
        vinculosResolvidos: vinculos.length,
        ...log,
        empresasComDoisPrincipais_ignorados: doisPrincipais,
        cnpjNaoEncontrado: cnpjNaoEncontrado.slice(0, 30),
        cnpjNaoEncontradoTotal: cnpjNaoEncontrado.length,
        emailNaoEncontrado: [...emailNaoEncontrado],
    }, null, 2));
    console.log(dryRun ? '\n(DRY-RUN — nada gravado. Rode sem --dry-run pra aplicar.)' : '\n✓ carteiras gravadas. Agora rode: node scripts/carteira-tools.mjs aplicar');
}

// ─── atribuir-todas ─────────────────────────────────────────────────────────
async function cmdAtribuirTodas(email, dryRun) {
    if (!email) { console.error('✗ informe o email do colaborador'); process.exit(1); }
    const [usuarios, empresas] = await Promise.all([carregarUsuarios(), carregarEmpresas()]);
    const col = usuarios.get(email.toLowerCase());
    if (!col) { console.error(`✗ colaborador "${email}" não encontrado em users`); process.exit(1); }
    const vinculos = empresas.todas.map(e => ({ ...e, colaboradorUid: col.uid, colaboradorNome: col.nome, papel: 'principal' }));
    const log = await gravarVinculos(vinculos, dryRun);
    console.log(JSON.stringify({ dryRun: !!dryRun, colaborador: col.nome, email: col.email, empresas: vinculos.length, ...log }, null, 2));
    console.log(dryRun ? '\n(DRY-RUN — nada gravado.)' : '\n✓ carteiras gravadas. Agora rode: node scripts/carteira-tools.mjs aplicar');
}

// ─── aplicar (backfill) ───────────────────────────────────────────────────--
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
    else if (cmd === 'exportar-empresas') await cmdExportarEmpresas(arg1);
    else if (cmd === 'import') await cmdImport(arg1, dryRun);
    else if (cmd === 'atribuir-todas') await cmdAtribuirTodas(arg1, dryRun);
    else if (cmd === 'aplicar') await cmdAplicar();
    else {
        console.log('Comandos: status | exportar-empresas <csv> | import <csv> [--dry-run] | atribuir-todas <email> [--dry-run] | aplicar');
    }
} catch (e) {
    console.error('✗ erro:', e.message);
    process.exit(1);
}
process.exit(0);

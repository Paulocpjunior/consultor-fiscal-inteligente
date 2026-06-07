// scripts/listar-municipios-carteira.mjs
// Lista municipios da carteira do escritorio (Simples + LP) com:
//   - Quantidade de empresas por municipio/UF
//   - Quantidade ativa no ADN (Padrao Nacional)
//   - Quantidade com CCM/IE preenchidos
//   - Quantidade de NFSe ja capturadas
//
// Resultado serve pra priorizar Caminho A da Reforma:
//   - Empresas inativas em cidades com alto volume = baixa cobertura
//     - habilitar ADN onde a prefeitura ja aderiu
//   - Cidades sem nenhuma NFSe capturada = ou nao tem servico OU a
//     captura nao funciona
//
// Uso (com ADC do gcloud — rode antes: gcloud auth application-default login):
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/listar-municipios-carteira.mjs
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/listar-municipios-carteira.mjs --csv municipios.csv
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/listar-municipios-carteira.mjs --top 30
//
// Saida no console: top N por qtdEmpresas; CSV se passar --csv path.

import admin from 'firebase-admin';
import { writeFileSync } from 'fs';

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

const args = process.argv.slice(2);
const csvIdx = args.indexOf('--csv');
const csvPath = csvIdx !== -1 ? args[csvIdx + 1] : null;
const topIdx = args.indexOf('--top');
const topN = topIdx !== -1 ? parseInt(args[topIdx + 1], 10) : 20;

const norm = (s) => String(s || '').trim();
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// ─── Carrega empresas (Simples + LP) ───────────────────────────────────────
async function carregarEmpresas() {
    const colecoes = ['simples_empresas', 'lucro_empresas'];
    const empresas = [];
    for (const c of colecoes) {
        const snap = await db.collection(c).get();
        snap.forEach(d => {
            const e = d.data();
            if (e._merged_into) return;
            empresas.push({
                id: d.id,
                colecao: c,
                cnpj: soDigitos(e.cnpj),
                nome: e.nome || e.razaoSocial || '',
                uf: norm(e.dadosFiscais?.uf || e.uf),
                municipio: norm(e.dadosFiscais?.municipioNome || e.dadosFiscais?.municipio || e.municipio),
                codMunIBGE: norm(e.dadosFiscais?.codMunIBGE),
                ccm: norm(e.dadosFiscais?.ccmSp || e.ccmSp),
                ie: norm(e.dadosFiscais?.inscricaoEstadual),
                nfseNacionalDfeAtivo: e.nfseNacionalDfeAtivo === true,
                capturarSefaz: e.capturarSefaz !== false,
            });
        });
    }
    return empresas;
}

// ─── Conta NFSe capturadas por empresa (documentos_fiscais tipo NFSe) ─────
async function contarNfsePorEmpresa() {
    const porEmpresa = new Map();
    const snap = await db.collection('documentos_fiscais')
        .where('tipo', 'in', ['NFSe', 'nfse'])
        .get();
    snap.forEach(d => {
        const x = d.data();
        const empId = x.empresaId || x.empresa_id;
        if (!empId) return;
        porEmpresa.set(empId, (porEmpresa.get(empId) || 0) + 1);
    });
    return porEmpresa;
}

// ─── Agrupa por municipio ──────────────────────────────────────────────────
function agrupar(empresas, nfsePorEmpresa) {
    const map = new Map();
    for (const emp of empresas) {
        const chave = `${emp.uf || '?'}|${emp.municipio || '?'}|${emp.codMunIBGE || ''}`;
        if (!map.has(chave)) {
            map.set(chave, {
                uf: emp.uf || '?',
                municipio: emp.municipio || '?',
                codMunIBGE: emp.codMunIBGE || '',
                qtdEmpresas: 0,
                qtdAdnAtivo: 0,
                qtdComCcm: 0,
                qtdComIe: 0,
                qtdComNfseCapturada: 0,
                totalNfseCapturadas: 0,
            });
        }
        const reg = map.get(chave);
        reg.qtdEmpresas++;
        if (emp.nfseNacionalDfeAtivo) reg.qtdAdnAtivo++;
        if (emp.ccm) reg.qtdComCcm++;
        if (emp.ie) reg.qtdComIe++;
        const qNfse = nfsePorEmpresa.get(emp.id) || 0;
        if (qNfse > 0) reg.qtdComNfseCapturada++;
        reg.totalNfseCapturadas += qNfse;
    }
    return [...map.values()];
}

// ─── Saida ─────────────────────────────────────────────────────────────────
function fmt(reg) {
    const pctAdn = reg.qtdEmpresas ? Math.round(100 * reg.qtdAdnAtivo / reg.qtdEmpresas) : 0;
    return {
        UF: reg.uf,
        Municipio: reg.municipio,
        IBGE: reg.codMunIBGE,
        Empresas: reg.qtdEmpresas,
        ADN_Ativo: reg.qtdAdnAtivo,
        ADN_pct: pctAdn + '%',
        Com_CCM: reg.qtdComCcm,
        Com_IE: reg.qtdComIe,
        Empresas_c_NFSe: reg.qtdComNfseCapturada,
        Total_NFSe: reg.totalNfseCapturadas,
    };
}

function imprimirTabela(linhas, top) {
    const ordenadas = [...linhas].sort((a, b) => b.qtdEmpresas - a.qtdEmpresas).slice(0, top);
    console.log('\n📍 TOP ' + top + ' municipios da carteira (por qtd empresas):\n');
    console.table(ordenadas.map(fmt));
}

function escreverCsv(linhas, path) {
    const header = ['UF', 'Municipio', 'CodIBGE', 'qtdEmpresas', 'qtdAdnAtivo', 'pctAdnAtivo', 'qtdComCcm', 'qtdComIe', 'qtdComNfseCapturada', 'totalNfseCapturadas'];
    const ordenadas = [...linhas].sort((a, b) => b.qtdEmpresas - a.qtdEmpresas);
    const rows = [header.join(',')];
    for (const r of ordenadas) {
        const pct = r.qtdEmpresas ? Math.round(100 * r.qtdAdnAtivo / r.qtdEmpresas) : 0;
        rows.push([
            r.uf, '"' + r.municipio.replace(/"/g, '""') + '"', r.codMunIBGE,
            r.qtdEmpresas, r.qtdAdnAtivo, pct,
            r.qtdComCcm, r.qtdComIe, r.qtdComNfseCapturada, r.totalNfseCapturadas,
        ].join(','));
    }
    writeFileSync(path, rows.join('\n'), 'utf8');
    console.log(`\n✅ CSV escrito em ${path}`);
}

function imprimirResumo(empresas, linhas) {
    const totalAdn = empresas.filter(e => e.nfseNacionalDfeAtivo).length;
    const totalCcm = empresas.filter(e => e.ccm).length;
    console.log('\n📊 RESUMO GERAL');
    console.log('─'.repeat(60));
    console.log(`Total empresas:            ${empresas.length}`);
    console.log(`ADN ativo:                 ${totalAdn} (${Math.round(100 * totalAdn / empresas.length)}%)`);
    console.log(`Com CCM (SP capital):      ${totalCcm}`);
    console.log(`Municipios distintos:      ${linhas.length}`);
    const ufs = new Set(linhas.map(l => l.uf).filter(u => u !== '?'));
    console.log(`UFs distintas:             ${ufs.size} (${[...ufs].sort().join(', ')})`);
    const semMunicipio = empresas.filter(e => !e.municipio).length;
    if (semMunicipio > 0) {
        console.log(`⚠️  Sem municipio cadastrado: ${semMunicipio} empresa(s)`);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
    console.log('🔄 Carregando empresas...');
    const empresas = await carregarEmpresas();
    console.log(`   ${empresas.length} empresas`);

    console.log('🔄 Contando NFSe capturadas por empresa...');
    const nfsePorEmpresa = await contarNfsePorEmpresa();
    console.log(`   ${nfsePorEmpresa.size} empresas com pelo menos 1 NFSe`);

    const linhas = agrupar(empresas, nfsePorEmpresa);
    imprimirResumo(empresas, linhas);
    imprimirTabela(linhas, topN);

    if (csvPath) {
        escreverCsv(linhas, csvPath);
    } else {
        console.log('\n💡 dica: passe --csv municipios.csv pra exportar TODOS os municipios.\n');
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error('❌ Erro:', err);
    process.exit(1);
});

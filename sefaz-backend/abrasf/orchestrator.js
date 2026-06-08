// sefaz-backend/abrasf/orchestrator.js
// Orquestra captura ABRASF para empresas habilitadas.
//
// Loop por empresa:
//   1. Verifica codMunIBGE e config do municipio
//   2. Carrega cert A1 da empresa (cert-storage)
//   3. Chama cliente.consultarNfse() pra tomado E prestado
//   4. Parsea resposta
//   5. Importa NFSes no Firestore
//   6. Grava state (ultimaSync, qtdImportadas)
//
// Empresa eh elegivel SE:
//   - tem dadosFiscais.codMunIBGE em config-municipios
//   - tem cert A1 cadastrado
//   - abrasfAtivo === true (opt-in)

import admin from 'firebase-admin';
import { configMunicipio } from './config-municipios.js';
import { consultarNfse } from './cliente.js';
import { parseRespostaConsulta } from './parser-nfse.js';
import { importarNfsesAbrasf } from './importer.js';
import { loadCertEmpresa } from '../cert-storage.js';

const COL_STATE = 'abrasf_state';
const PAGINA_MAX = 10;   // proteção: para de paginar após 10 páginas (500 NFSe)

function getDb() {
    if (!admin.apps.length) admin.initializeApp();
    return admin.firestore();
}

/**
 * Captura NFSes de UMA empresa (tomado E prestado) em um periodo.
 *
 * @param opts.empresa { id, cnpj, codMunIBGE, inscricaoMunicipal }
 * @param opts.dataInicial ISO
 * @param opts.dataFinal ISO
 * @returns { ok, tomado: { importadas }, prestado: { importadas }, erro? }
 */
export async function capturarEmpresa(opts) {
    const { empresa, dataInicial, dataFinal } = opts;
    const config = configMunicipio(empresa.codMunIBGE);
    if (!config) {
        return { ok: false, erro: `municipio ${empresa.codMunIBGE} nao suportado` };
    }

    // Carrega cert
    const cert = await loadCertEmpresa(empresa.id);
    if (!cert) {
        return { ok: false, erro: 'empresa sem cert A1 cadastrado' };
    }

    const resultados = { ok: true, tomado: null, prestado: null };

    for (const tipo of ['tomado', 'prestado']) {
        try {
            let pagina = 1;
            const todasNfses = [];
            while (pagina <= PAGINA_MAX) {
                const resp = await consultarNfse({
                    codIBGE: empresa.codMunIBGE,
                    tipo,
                    cnpj: empresa.cnpj,
                    inscricaoMunicipal: empresa.inscricaoMunicipal,
                    dataInicial, dataFinal, pagina,
                    pfxBuffer: cert.pfxBuffer,
                    pfxPassword: cert.password,
                });
                if (resp.statusCode !== 200) {
                    throw new Error(`HTTP ${resp.statusCode}: ${resp.body.slice(0, 200)}`);
                }
                const parsed = parseRespostaConsulta(resp.body);
                if (!parsed.ok && parsed.mensagens.length > 0) {
                    // Erros de negocio (CNPJ nao habilitado, etc) - registra e para
                    throw new Error(parsed.mensagens.map(m => `${m.codigo}: ${m.mensagem}`).join(' | '));
                }
                todasNfses.push(...parsed.nfses);
                if (!parsed.temMaisPaginas) break;
                pagina++;
            }

            // Importa
            const importResult = await importarNfsesAbrasf(todasNfses, {
                empresaId: empresa.id,
                empresaCnpj: empresa.cnpj,
                tipo,
                codMunIBGE: empresa.codMunIBGE,
                codMunNome: config.nome,
            });
            resultados[tipo] = importResult;
        } catch (e) {
            resultados[tipo] = { erro: e.message };
            resultados.ok = false;
        }
    }

    // Grava state
    await getDb().collection(COL_STATE).doc(empresa.id).set({
        empresaId: empresa.id,
        empresaCnpj: empresa.cnpj,
        codMunIBGE: empresa.codMunIBGE,
        ultimaSync: admin.firestore.FieldValue.serverTimestamp(),
        ultimoPeriodo: { dataInicial, dataFinal },
        ultimoResultado: resultados,
    }, { merge: true });

    return resultados;
}

/**
 * Loop em todas empresas elegiveis (abrasfAtivo=true + codMunIBGE suportado).
 *
 * @param opts.dataInicial ISO
 * @param opts.dataFinal ISO
 * @returns { totalEmpresas, processadas, falhas, detalhes: [...] }
 */
export async function capturarTodas(opts) {
    const db = getDb();
    const colecoes = ['simples_empresas', 'lucro_empresas'];

    // Carrega todas empresas elegiveis
    const empresas = new Map();   // dedup por CNPJ
    for (const col of colecoes) {
        const snap = await db.collection(col)
            .where('abrasfAtivo', '==', true)
            .get();
        snap.forEach(d => {
            const e = d.data();
            if (e._merged_into) return;
            const cnpj = (e.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) return;
            const codMunIBGE = e.dadosFiscais?.codMunIBGE;
            if (!codMunIBGE || !configMunicipio(codMunIBGE)) return;
            if (empresas.has(cnpj)) return;
            empresas.set(cnpj, {
                id: d.id, cnpj, codMunIBGE,
                inscricaoMunicipal: e.dadosFiscais?.inscricaoMunicipal,
                nome: e.razaoSocial || e.nome,
            });
        });
    }

    const detalhes = [];
    let processadas = 0;
    let falhas = 0;

    for (const emp of empresas.values()) {
        try {
            const r = await capturarEmpresa({
                empresa: emp,
                dataInicial: opts.dataInicial,
                dataFinal: opts.dataFinal,
            });
            detalhes.push({ empresaId: emp.id, cnpj: emp.cnpj, ...r });
            if (r.ok) processadas++;
            else falhas++;
        } catch (e) {
            detalhes.push({ empresaId: emp.id, cnpj: emp.cnpj, ok: false, erro: e.message });
            falhas++;
        }
    }

    return {
        totalEmpresas: empresas.size,
        processadas, falhas,
        detalhes,
    };
}

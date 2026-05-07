/**
 * Orquestrador NFS-e prefeitura de São Paulo capital.
 *
 * Coordena:
 * 1. Listar empresas elegíveis (têm CCM SP + autorização do contador no portal SP)
 * 2. Pra cada empresa, chamar o cliente SOAP no período desejado
 * 3. Persistir cada NFS-e via importer (idempotente)
 * 4. Logar resultado em `nfsesp_capturas_log`
 *
 * Empresa elegível precisa ter no Firestore:
 *  - ccmSp: string (Inscrição Municipal SP capital)
 *  - nfseSpAutorizadoEm: timestamp (data em que o cliente autorizou
 *    SP Contábil como contador no portal nfe.prefeitura.sp.gov.br)
 *
 * Coleções consultadas: `simples_empresas` E `lucro_empresas` (ambas).
 * Tipo: `cron` ou `manual`. Throttle: 2s entre empresas (rate limit SP ~30/min).
 */

import { consultarNfseRecebidas } from './nfse-sp-client.js';
import { salvarNfseSpRecebida } from './nfse-sp-importer.js';

const CNPJ_SP_CONTABIL = process.env.NFSE_SP_REMETENTE_CNPJ || '44388152000189';
const THROTTLE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listarEmpresasElegiveis(db) {
    const colecoes = ['simples_empresas', 'lucro_empresas'];
    const resultado = [];

    for (const col of colecoes) {
        const snap = await db.collection(col).where('ccmSp', '!=', '').get();
        for (const doc of snap.docs) {
            const d = doc.data();
            const ccmSp = (d.ccmSp || '').toString().trim();
            const autorizado = d.nfseSpAutorizadoEm;
            if (!ccmSp || !autorizado) continue;

            resultado.push({
                colecao: col,
                id: doc.id,
                cnpj: (d.cnpj || '').replace(/\D/g, ''),
                nome: d.razaoSocial || d.nome || doc.id,
                ccmSp,
                nfseSpAutorizadoEm: autorizado,
            });
        }
    }
    return resultado;
}

function periodoPadrao() {
    const hoje = new Date();
    const anoAtual = hoje.getUTCFullYear();
    const mesAtual = hoje.getUTCMonth() + 1;
    const mesAnt = mesAtual === 1 ? 12 : mesAtual - 1;
    const anoAnt = mesAtual === 1 ? anoAtual - 1 : anoAtual;
    return { dtInicio: { ano: anoAnt, mes: mesAnt }, dtFim: { ano: anoAtual, mes: mesAtual } };
}

export async function consultarUma(db, empresa, opts = {}) {
    const t0 = Date.now();
    const periodo = opts.periodo || periodoPadrao();
    const importadoPor = opts.importadoPor || 'sistema-nfse-sp-cron';

    try {
        const { sucesso, erros, alertas, totalNFes, nfes, statusCode } = await consultarNfseRecebidas({
            cnpjRemetente: CNPJ_SP_CONTABIL,
            inscricaoMunicipalTomador: empresa.ccmSp,
            dtInicio: periodo.dtInicio,
            dtFim: periodo.dtFim,
        });

        if (!sucesso) {
            return {
                empresaId: empresa.id,
                empresaNome: empresa.nome,
                ccmSp: empresa.ccmSp,
                sucesso: false,
                statusCode,
                totalNFes: 0,
                criadas: 0,
                atualizadas: 0,
                erros,
                alertas,
                durationMs: Date.now() - t0,
            };
        }

        let criadas = 0;
        let atualizadas = 0;
        const errosImport = [];

        for (const nfeXml of nfes) {
            try {
                const r = await salvarNfseSpRecebida(db, nfeXml, {
                    empresaId: empresa.id,
                    empresaNome: empresa.nome,
                    cnpjTomadorEsperado: empresa.cnpj,
                    importadoPor,
                });
                if (r.criado) criadas += 1;
                if (r.atualizado) atualizadas += 1;
            } catch (e) {
                errosImport.push({ erro: e.message });
            }
        }

        return {
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            ccmSp: empresa.ccmSp,
            sucesso: true,
            statusCode,
            totalNFes,
            criadas,
            atualizadas,
            erros: errosImport,
            alertas,
            durationMs: Date.now() - t0,
        };
    } catch (e) {
        return {
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            ccmSp: empresa.ccmSp,
            sucesso: false,
            totalNFes: 0,
            criadas: 0,
            atualizadas: 0,
            erros: [{ codigo: 'EXCEPTION', descricao: e.message }],
            alertas: [],
            durationMs: Date.now() - t0,
        };
    }
}

export async function consultarTodasElegiveis(db, opts = {}) {
    const t0 = Date.now();
    const tipo = opts.tipo || 'cron';
    const dryRun = opts.dryRun === true;

    const empresas = await listarEmpresasElegiveis(db);
    const resultados = [];

    for (let i = 0; i < empresas.length; i += 1) {
        const empresa = empresas[i];
        if (dryRun) {
            resultados.push({
                empresaId: empresa.id,
                empresaNome: empresa.nome,
                ccmSp: empresa.ccmSp,
                sucesso: true,
                dryRun: true,
                totalNFes: 0,
                criadas: 0,
                atualizadas: 0,
                erros: [],
                alertas: [],
                durationMs: 0,
            });
            continue;
        }

        const r = await consultarUma(db, empresa, opts);
        resultados.push(r);

        if (i < empresas.length - 1) await sleep(THROTTLE_MS);
    }

    const totalNFes = resultados.reduce((s, r) => s + (r.totalNFes || 0), 0);
    const criadas = resultados.reduce((s, r) => s + (r.criadas || 0), 0);
    const atualizadas = resultados.reduce((s, r) => s + (r.atualizadas || 0), 0);
    const sucessos = resultados.filter((r) => r.sucesso).length;
    const falhas = resultados.length - sucessos;

    const log = {
        executadoEm: new Date().toISOString(),
        tipo,
        dryRun,
        totalEmpresas: empresas.length,
        sucessos,
        falhas,
        totalNFes,
        criadas,
        atualizadas,
        durationMs: Date.now() - t0,
        resultados,
    };

    if (!dryRun) {
        try {
            await db.collection('nfsesp_capturas_log').add(log);
        } catch (e) {
            console.warn('[nfse-sp-orchestrator] não foi possível gravar log:', e.message);
        }
    }

    return log;
}

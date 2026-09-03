// ============================================================================
// sefaz-backend/conferencia-chaves-routes.js  (ESM)
//
// CONFERÊNCIA POR CHAVES (CFI × SIEG):
//   POST /api/admin/sefaz/conferencia-chaves           — classifica presença
//   POST /api/admin/sefaz/conferencia-chaves-importar  — importa faltantes
//
// O colaborador cola o relatório da SIEG; o app diz QUAIS chaves faltam e
// importa só elas via consulta por chave (cert da própria empresa, pacing
// anti-656, aborta a raiz no primeiro 656 e devolve resultado parcial).
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { extrairChaves, classificarChaves } from './conferencia-chaves.js';
import { consultaNFePorChave } from './sefaz-client.js';
import { importarXmlSefaz } from './xml-importer.js';
import { loadCertEmpresa, loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import { carregarFlagsEmpresa, CNPJ_ESCRITORIO } from './empresa-flags.js';
import { acharEmpresaCadastrada } from './empresa-cadastro-lookup.js';
import { podeAcessarCnpj } from './carteira-auth.js';
import {
    selecionarParaReconferir, lerRespostaCancelamento, resumirReconferencia,
} from './reconferir-cancelamento.js';
import { gravarCancelamentoConfirmado, carimbarPerguntaSefaz } from './cancelamento-gravacao.js';
import { docCancelado, direcaoEfetivaDoc } from './xml-metadata-helper.js';

const router = express.Router();
const MAX_CHAVES_CONFERIR = 2000;
const MAX_CHAVES_IMPORTAR = 60;   // por chamada — consulta por chave é cara
const MAX_RECONFERIR = 60;        // idem: cada nota é uma chamada com o A1 do cliente
const PACING_MS = 1500;           // anti-656 (mesmo webservice DistDFe)

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Busca em lotes de 30 ('in' do Firestore) quais chaves já existem.
async function buscarPresentes(db, chaves) {
    const presentes = new Map();
    for (let i = 0; i < chaves.length; i += 30) {
        const fatia = chaves.slice(i, i + 30);
        const snap = await db.collection('documentos_fiscais')
            .where('chave', 'in', fatia)
            .select('chave', 'schema', 'tipoDoc', 'direcao', 'empresaCnpj')
            .get();
        snap.forEach((d) => {
            const x = d.data() || {};
            if (x.chave) presentes.set(x.chave, x);
        });
    }
    return presentes;
}

// Localiza a empresa (id + coleção) pelo CNPJ — pelo DONO ÚNICO.
// A varredura que morava aqui não olhava a LÁPIDE, então empresa excluída
// ainda respondia por chaves; a casca resolve as duas coisas de uma vez.
const acharEmpresaPorCnpj = (db, cnpj) => acharEmpresaCadastrada(db, cnpj);

router.post('/conferencia-chaves', requireAuth, async (req, res) => {
    try {
        const texto = req.body?.texto ?? '';
        const chavesInput = Array.isArray(req.body?.chaves) ? req.body.chaves.join('\n') : '';
        const chaves = extrairChaves(`${texto}\n${chavesInput}`).slice(0, MAX_CHAVES_CONFERIR);
        if (chaves.length === 0) {
            return res.status(400).json({ error: 'Nenhuma chave de 44 dígitos encontrada no texto colado.' });
        }
        const db = fa().firestore();
        const presentes = await buscarPresentes(db, chaves);
        const r = classificarChaves(chaves, presentes);
        return res.json({ ...r, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[conferencia-chaves]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

router.post('/conferencia-chaves-importar', requireAuth, async (req, res) => {
    try {
        const cnpjDest = String(req.body?.cnpjDestinatario || '').replace(/\D/g, '');
        if (cnpjDest.length !== 14) {
            return res.status(400).json({ error: 'cnpjDestinatario (14 dígitos) é obrigatório — a empresa dona das notas (destinatária).' });
        }
        // TRAVA DE CARTEIRA (auditoria de segurança, 10/08): esta rota carrega o
        // A1 da empresa-alvo e dispara consulta à SEFAZ em nome dela — sem o
        // check, um colaborador fora da carteira queimava a cota anti-656 da
        // raiz de outra empresa e escrevia documentos na base dela. Admin passa.
        const acessoDest = await podeAcessarCnpj(req.user, cnpjDest);
        if (!acessoDest.ok) return res.status(acessoDest.status).json({ error: acessoDest.error });
        const chaves = extrairChaves((req.body?.chaves || []).join('\n')).slice(0, MAX_CHAVES_IMPORTAR);
        if (chaves.length === 0) return res.status(400).json({ error: 'Nenhuma chave válida para importar.' });

        const db = fa().firestore();
        const emp = await acharEmpresaPorCnpj(db, cnpjDest);
        if (!emp) {
            return res.status(404).json({ error: `Empresa ${cnpjDest} não encontrada no cadastro (Simples/Lucro).` });
        }
        const { uf } = await carregarFlagsEmpresa(emp.empresaId, cnpjDest);
        if (!uf) return res.status(400).json({ error: 'UF não cadastrada para a empresa — preencha em Completar cadastro.' });

        // Cert da própria empresa (ou da mesma raiz) — consulta por chave é
        // do DESTINATÁRIO; cert do escritório não autoriza CNPJ de outra raiz.
        let cert = null;
        try { cert = await loadCertEmpresa(emp.empresaId); } catch { /* tenta raiz */ }
        if (!cert) {
            try { cert = await loadCertEmpresaPorCnpjBase(cnpjDest, emp.empresaId); } catch { /* sem cert */ }
        }
        if (!cert) {
            return res.status(400).json({ error: 'Empresa sem certificado A1 próprio/mesma raiz — a consulta por chave exige o cert do destinatário.' });
        }

        const resultados = [];
        let importados = 0, resumos = 0, erros = 0, abortou656 = false;
        for (const chave of chaves) {
            try {
                const r = await consultaNFePorChave({ chave, cnpjInteressado: cnpjDest, uf, certOverride: cert });
                if (r.rateLimited) {
                    abortou656 = true;
                    resultados.push({ chave, status: 'abortado-656' });
                    break; // 656 na raiz — parar aqui; o resto fica pra próxima rodada
                }
                let statusChave = 'nao-retornada';
                for (const x of r.xmls || []) {
                    if (!x.xml) continue;
                    const imp = await importarXmlSefaz({
                        empresaId: emp.empresaId, empresaCnpj: cnpjDest,
                        xml: x.xml, schema: x.schema, nsu: x.nsu,
                        capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'conferencia-chaves' },
                    });
                    if (imp.status === 'ok' || imp.status === 'atualizado') {
                        statusChave = 'importada';
                        importados++;
                        if (imp.tipoDoc === 'resNFe') {
                            resumos++;
                            statusChave = 'importada-resumo';
                            // Ciência em background: libera a completa no próximo ciclo.
                            setImmediate(async () => {
                                try {
                                    const { manifestarUma } = await import('./manifesto-orchestrator.js');
                                    await manifestarUma({
                                        chNFe: chave, cnpjDestinatario: cnpjDest, tipo: 'ciencia',
                                        empresaId: emp.empresaId, uf, skipRedownload: true,
                                        capturadoPor: { uid: req.user.uid, email: req.user.email },
                                    });
                                } catch (e) { console.warn('[conferencia-importar] ciência falhou:', e.message); }
                            });
                        }
                    } else if (imp.status === 'duplicado' && statusChave === 'nao-retornada') {
                        statusChave = 'ja-existia';
                    }
                }
                resultados.push({ chave, status: statusChave, cStat: r.cStat || null });
                if (statusChave === 'nao-retornada') erros++;
            } catch (e) {
                erros++;
                resultados.push({ chave, status: 'erro', motivo: String(e.message || '').slice(0, 200) });
            }
            await sleep(PACING_MS);
        }

        return res.json({
            ok: !abortou656,
            abortou656,
            processadas: resultados.length,
            importados, resumos, erros,
            restantes: chaves.length - resultados.length,
            resultados,
            aviso: abortou656
                ? 'SEFAZ pediu pausa (cStat 656) — o restante fica para a próxima rodada (aguarde ~1h).'
                : (resumos > 0 ? `${resumos} vieram como resumo — Ciência disparada; a completa chega no próximo ciclo.` : null),
        });
    } catch (e) {
        console.error('[conferencia-chaves-importar]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

// ============================================================================
// POST /api/admin/sefaz/reconferir-cancelamento
//
// "A nota foi cancelada?" — perguntado à SEFAZ, nota a nota.
//
// Caso Eunice / LANCHONETE JO BRAS (11/08): cancelada contando no faturamento.
// A régua de leitura do CFI está certa; o cancelamento é que nunca chegou —
// a SEFAZ não entrega ao emitente (Rej. 641), a saída vem pelo cofre de e-mail,
// e o cliente manda o XML autorizado, não o evento do dia seguinte.
//
// Aqui NÃO se deduz nada: pergunta-se. E quem responde é o documento que a
// SEFAZ devolve (`reconferir-cancelamento.js` lê; este arquivo só faz I/O).
//
// `simular: true` responde só o RECORTE (quantas seriam consultadas) sem gastar
// uma chamada — é o que o painel mostra antes de o colaborador confirmar.
// ============================================================================
router.post('/reconferir-cancelamento', requireAuth, async (req, res) => {
    try {
        const cnpjEmpresa = String(req.body?.cnpj || '').replace(/\D/g, '');
        const competencia = String(req.body?.competencia || '').trim();
        const simular = req.body?.simular === true;
        if (cnpjEmpresa.length !== 14) {
            return res.status(400).json({ error: 'cnpj (14 dígitos) é obrigatório — a empresa EMITENTE das notas.' });
        }
        if (!/^\d{4}-\d{2}$/.test(competencia)) {
            return res.status(400).json({ error: 'competencia é obrigatória no formato AAAA-MM.' });
        }
        // Mesma trava da importação por chave: esta rota carrega o A1 da
        // empresa e consulta a SEFAZ em nome dela.
        const acesso = await podeAcessarCnpj(req.user, cnpjEmpresa);
        if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error });

        const db = fa().firestore();
        const emp = await acharEmpresaPorCnpj(db, cnpjEmpresa);
        if (!emp) return res.status(404).json({ error: `Empresa ${cnpjEmpresa} não encontrada no cadastro.` });

        const snap = await db.collection('documentos_fiscais')
            .where('empresaId', '==', emp.empresaId)
            .where('competencia', '==', competencia)
            // eventos/cStat entram no select porque é neles que o cancelamento
            // pode estar — sem eles, docCancelado erra para MAIS consultas.
            // ⚠️ `reconferenciaSefazEm` PRECISA estar aqui: campo fora do select some
            // da leitura, e a fila voltaria a repetir as mesmas notas toda rodada.
            .select('chave', 'numero', 'direcao', 'tpNF', 'status', 'cStat', 'eventos', 'valorTotal',
                'reconferenciaSefazEm')
            .get();
        const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

        const selecao = selecionarParaReconferir(docs, {
            jaCancelado: docCancelado,
            direcaoEfetiva: direcaoEfetivaDoc,
            limite: MAX_RECONFERIR,
            // Quem nunca foi perguntada entra primeiro; quem já foi volta pela
            // mais antiga. Sem isto a rodada repetia as mesmas 60 (MV LIDER).
            conferidaEm: (d) => Number(d?.reconferenciaSefazEm) || 0,
        });

        if (simular) {
            return res.json({
                ok: true, simulado: true, cnpj: cnpjEmpresa, competencia,
                selecao: { ...selecao, aConsultar: selecao.aConsultar.length },
                // `simulado` viaja para o resumo NÃO falar no passado sobre uma
                // rodada que não aconteceu (caso MV LIDER, 18/08).
                resumo: resumirReconferencia({ selecao, resultados: [], simulado: true }),
            });
        }
        if (!selecao.aConsultar.length) {
            return res.json({
                ok: true, cnpj: cnpjEmpresa, competencia,
                selecao: { ...selecao, aConsultar: 0 }, resultados: [],
                resumo: resumirReconferencia({ selecao, resultados: [] }),
            });
        }

        const { uf } = await carregarFlagsEmpresa(emp.empresaId, cnpjEmpresa);
        if (!uf) return res.status(400).json({ error: 'UF não cadastrada para a empresa — preencha em Completar cadastro.' });

        // O cert é o da PRÓPRIA empresa (ou da raiz): a consulta por CHAVE
        // (DistDFe) entregando o CONTEÚDO do documento é feita em nome dela.
        let cert = null;
        try { cert = await loadCertEmpresa(emp.empresaId); } catch { /* tenta raiz */ }
        if (!cert) {
            try { cert = await loadCertEmpresaPorCnpjBase(cnpjEmpresa, emp.empresaId); } catch { /* sem cert */ }
        }

        // 🚨 SEM A1 PRÓPRIO/DA RAIZ (caso MV LIDER, cert é A3 — não assina em
        // nuvem): cai no certificado do ESCRITÓRIO, consultando COMO
        // escritório (cnpjInteressado = CNPJ_ESCRITORIO, não o da empresa) —
        // é o MESMO caminho que a tela "Consultar NFe por chave" já usa em
        // produção. Paulo provou em 18/08, nota a nota, que a SEFAZ responde
        // `cStat=653` (NF-e Cancelada, arquivo indisponível) mesmo sem o
        // escritório ser parte do documento: 653 é REJEIÇÃO, não CONTEÚDO, e
        // por isso não tem a mesma restrição de "interessado" que o docZip
        // completo tem. Não promete achar TUDO (nota válida que o escritório
        // não é parte continua vindo 137/indeterminado, honesto) — só deixa
        // de recusar de cara e sempre pergunta de algum jeito.
        const usaCertEscritorio = !cert;

        const resultados = [];
        let abortou656 = false;
        for (const alvo of selecao.aConsultar) {
            let leitura;
            try {
                const r = await consultaNFePorChave({
                    chave: alvo.chave,
                    cnpjInteressado: usaCertEscritorio ? CNPJ_ESCRITORIO : cnpjEmpresa,
                    uf, certOverride: usaCertEscritorio ? null : cert,
                });
                if (r.rateLimited) { abortou656 = true; break; }
                leitura = lerRespostaCancelamento(r);
            } catch (e) {
                leitura = lerRespostaCancelamento({ erro: e.message });
            }

            if (leitura.situacao === 'cancelada') {
                // Grava o EVENTO, não o status: assim `docCancelado` decide na
                // leitura como em todo o resto do app, e o backfill do cron não
                // encontra um status órfão sem prova ao lado. A escrita é a
                // MESMA do 🔎 (cancelamento-gravacao.js) — duas gravações foi o
                // que deixou o 🔎 mudo até 21/08.
                try {
                    await gravarCancelamentoConfirmado({
                        db, FieldValue: fa().firestore.FieldValue, docId: alvo.id,
                        evento: leitura.evento,
                        origem: usaCertEscritorio ? 'reconferencia-sefaz-cert-escritorio' : 'reconferencia-sefaz',
                        usuario: req.user.email || req.user.uid,
                    });
                } catch (e) {
                    leitura = { situacao: 'indeterminado', motivo: `A SEFAZ disse CANCELADA, mas a gravação falhou: ${e.message}` };
                }
            }
            // 🚨 CARIMBA TODA NOTA PERGUNTADA — não só a cancelada.
            // Antes, só a cancelada era gravada, então a seleção não tinha como
            // saber quem já havia sido perguntada e refazia a mesma fatia a cada
            // rodada, enquanto a tela prometia progresso (MV LIDER, 20/08).
            // Falha ao carimbar NÃO derruba a rodada: no pior caso a nota volta
            // na fila, que é o comportamento antigo — nunca perder o resultado.
            try {
                await carimbarPerguntaSefaz({ db, docId: alvo.id, situacao: leitura.situacao, cStat: leitura.cStat });
            } catch (e) {
                console.warn(`[reconferir-cancelamento] carimbo falhou em ${alvo.id}: ${e.message}`);
            }
            resultados.push({ ...alvo, ...leitura });
            await sleep(PACING_MS);
        }

        const resumo = resumirReconferencia({
            selecao, resultados, modo: usaCertEscritorio ? 'cert-escritorio' : 'distdfe',
            // O FATO viaja: sem ele a frase da rodada afirma ter perguntado o
            // que a SEFAZ não deixou perguntar.
            abortou656,
        });
        if (abortou656) {
            resumo.avisos.unshift('A SEFAZ pediu pausa (cStat 656) e a rodada parou aqui. O que não foi '
                + 'consultado continua como estava — aguarde ~1h e rode de novo.');
        }
        console.log(`[reconferir-cancelamento] ${cnpjEmpresa} ${competencia}: `
            + `${resumo.consultadas} consultadas, ${resumo.canceladas} canceladas, `
            + `${resumo.indeterminadas} indeterminadas (por ${req.user.email})`);

        return res.json({
            ok: true, cnpj: cnpjEmpresa, competencia,
            selecao: { ...selecao, aConsultar: selecao.aConsultar.length },
            resultados, resumo, abortou656,
        });
    } catch (e) {
        console.error('[reconferir-cancelamento]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

export default router;

// ============================================================================
// sefaz-backend/fim-de-mes-routes.js  (ESM)
// ----------------------------------------------------------------------------
//   GET  /api/admin/fim-de-mes/situacao?empresaId=&competencia=AAAA-MM
//   POST /api/admin/fim-de-mes/fechar     { empresaId, competencia }
//   POST /api/admin/fim-de-mes/reabrir    { empresaId, competencia, motivo }
//
// 🔒 O ATO que vira a régua de impostos, livros, ficha financeira e da
// importação do Contábil (CCI). A régua está em `fim-de-mes.js` (puro,
// testado); aqui é só I/O e as duas guardas de acesso.
//
// ═══ POR QUE A ESCRITA É SÓ AQUI ════════════════════════════════════════════
//
// A decisão do Paulo (26/08) é que **etapa aberta BLOQUEIA** — e essa
// pré-condição é conferida NESTA rota. Se o navegador pudesse gravar em
// `fechamentos_competencia`, o bloqueio inteiro seria contornável com um
// `setDoc`. Por isso as rules fecham a escrita (`allow write: if false`).
//
// ═══ UMA EMPRESA POR VEZ ════════════════════════════════════════════════════
//
// Decisão do Paulo, e é a família do *"ninguém emite em série"* (28/07): fim
// de mês em lote multiplicaria o erro por 200 antes de alguém ver. A rota
// aceita UM `empresaId` — não há caminho de lote, e isso é de propósito.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarEmpresaId } from './carteira-auth.js';
import { montarRotinasDaCompetencia } from './rotina-fiscal-routes.js';
// 🚨 O DONO DA APURAÇÃO — ele conhece as TRÊS fontes (ficha do Lucro,
// faturamentoManual e faturamentoMensalDetalhado do Simples). O carimbo lia
// só a ficha e bloqueava a carteira inteira do Simples.
import { acharApuracaoDaCompetencia } from './rotina-fiscal.js';
// 🚨 O DONO DO INSUMO — este bloco montava o objeto da empresa à mão e a tela
// dizia "pronto" enquanto o botão recusava (27/08). Ver o módulo.
import { empresaDaRotina, COLECOES_DA_ROTINA } from './rotina-empresa-insumo.js';
import { acharFichaCompetencia } from './ipi-varredura.js';
import { conferirFichaContraDocumentos } from './ficha-x-documentos.js';
import { normalizarCompetencia } from './competencia.js';
import {
    montarFimDeMes, montarCorte, podeDarFimDeMes,
    conferirReabertura, aplicarReabertura, descreverFechamento,
} from './fim-de-mes.js';

import { COLECAO_FECHAMENTOS as COLECAO, idDoFechamento, lerFechamentoDaCompetencia } from './fechamento-store.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp();
    return admin.firestore();
}

/**
 * As duas coleções de empresa — a ficha do Lucro é EMBUTIDA no documento.
 *
 * Devolve o doc CRU (o carimbo precisa da `fichaFinanceira` e do CNPJ para o
 * cursor) **e** o recorte que a Rotina consome, montado pelo DONO
 * (`empresaDaRotina`). Ver o comentário dele: montar esse recorte à mão aqui
 * foi o que fez a tela dizer "pronto" e o botão recusar.
 */
async function carregarEmpresa(db, empresaId) {
    for (const [col] of COLECOES_DA_ROTINA) {
        const snap = await db.collection(col).doc(empresaId).get();
        if (!snap.exists) continue;
        const dados = snap.data() || {};
        return {
            id: snap.id,
            colecao: col,
            ...dados,
            paraRotina: empresaDaRotina(snap.id, col, dados),
        };
    }
    return null;
}

/**
 * O acervo, para o carimbo do corte.
 *
 * O NSU é a PROVA (o que se mostra numa fiscalização), nunca o filtro — ele só
 * existe no trilho DistDFe, e cofre de e-mail, portal de SP, ADN e importação
 * manual não têm NSU nenhum.
 *
 * ⚠️ Falha na leitura do cursor NÃO derruba o fechamento e NÃO vira zero: o
 * carimbo sai com `ultNSU: null`, que é "não consegui provar", e é diferente
 * de "o cursor estava no começo".
 */
async function lerCursor(db, cnpj) {
    const digitos = String(cnpj || '').replace(/\D/g, '');
    if (!digitos) return null;
    try {
        const snap = await db.collection('sefaz_state').doc(digitos).get();
        return snap.exists ? (snap.data() || null) : null;
    } catch (e) {
        console.warn('[fim-de-mes] cursor indisponível:', e.message);
        return null;
    }
}

/** Monta o estado completo da competência — usado pelo GET e pelo POST. */
async function situacaoDaCompetencia(db, user, empresaId, competencia) {
    const comp = normalizarCompetencia(competencia);
    if (!comp) return { erro: 'Competência ilegível.' };
    if (!empresaId) return { erro: 'Informe a empresa.' };
    if (!(await podeAcessarEmpresaId(user, empresaId))) {
        return { erro: 'Esta empresa não está na sua carteira.', status: 403 };
    }

    const empresa = await carregarEmpresa(db, empresaId);
    if (!empresa) return { erro: 'Empresa não encontrada.', status: 404 };

    // O carimbo sai do dono da leitura — o id é régua única (a competência
    // circula em quatro formas, e `_07/2026` é outro id que `_2026-07`).
    const fechamento = await lerFechamentoDaCompetencia(db, empresaId, comp);

    // 🚨 A rotina sai do MESMO dono do painel — E COM O MESMO INSUMO.
    //
    // Até 27/08 este bloco montava o objeto da empresa **à mão**, e a mão
    // esquecia `ccmSp` e as três fontes de apuração: a tela dizia
    // "✓ Pronto para dar fim de mês" e o botão recusava com três etapas
    // abertas, na MESMA tela (print da REGINA CELIA PIRES). Usar o mesmo
    // `montarRotinasDaCompetencia` não bastava — o insumo é que divergia.
    if (!empresa.paraRotina) {
        return { erro: 'Cadastro da empresa incompleto (CNPJ ilegível, ou empresa excluída/fundida).', status: 400 };
    }
    const { rotinas } = await montarRotinasDaCompetencia(db, [empresa.paraRotina], comp);
    const rotina = rotinas[0] || null;

    return {
        empresa, competencia: comp, rotina, fechamento,
        precondicao: podeDarFimDeMes(rotina),
        descricao: descreverFechamento(fechamento),
    };
}

router.get('/situacao', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const r = await situacaoDaCompetencia(db, req.user,
            String(req.query.empresaId || ''), String(req.query.competencia || ''));
        if (r.erro) return res.status(r.status || 400).json({ ok: false, erro: r.erro });
        return res.json({
            ok: true,
            competencia: r.competencia,
            empresa: { id: r.empresa.id, nome: r.empresa.nome || null },
            etapas: r.rotina?.etapas || [],
            precondicao: r.precondicao,
            fechamento: r.fechamento,
            descricao: r.descricao,
        });
    } catch (e) {
        console.error('[fim-de-mes] situacao:', e);
        return res.status(500).json({ ok: false, erro: e.message });
    }
});

router.post('/fechar', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { empresaId, competencia } = req.body || {};
        const r = await situacaoDaCompetencia(db, req.user, String(empresaId || ''), String(competencia || ''));
        if (r.erro) return res.status(r.status || 400).json({ ok: false, erro: r.erro });

        const ficha = acharFichaCompetencia(r.empresa.fichaFinanceira, r.competencia);
        const cursor = await lerCursor(db, r.empresa.cnpj);

        // A contagem sai da PRÓPRIA etapa de captura da Rotina — recontar aqui
        // seria a segunda leitura do mesmo fato, e ela divergiria no dia em que
        // a etapa mudasse o que conta.
        const eCaptura = (r.rotina?.etapas || []).find((e) => e.id === 'captura') || null;
        const contagem = {
            entradas: Number(eCaptura?.entradas ?? 0),
            saidas: Number(eCaptura?.saidas ?? 0),
            total: Number(eCaptura?.total ?? 0),
        };

        // O LASTRO viaja no carimbo: sem ele o CCI recebe número fechado com
        // zero documento por trás (o caso EXPERTE, 15/08). Falha aqui NÃO
        // derruba o fechamento — ela só deixa o carimbo sem a ressalva, e o
        // núcleo grava `null`, que é "não conferi", nunca "está tudo certo".
        let lastro = null;
        const apuracao = acharApuracaoDaCompetencia(r.empresa.paraRotina, r.competencia);
        try {
            // ⚠️ O NÚMERO É O MESMO QUE A ETAPA 3 CRUZA: no Lucro o imposto da
            // ficha, no Simples a RECEITA lançada (lá o `totalImpostos` é null
            // porque o DAS não vive na ficha). Ler só a ficha deixava a maior
            // parte da carteira com o lastro apagado — e apagado se lê como
            // "conferido".
            const temImposto = apuracao?.totalImpostos != null
                && Number.isFinite(Number(apuracao.totalImpostos));
            lastro = conferirFichaContraDocumentos({
                valorApurado: temImposto ? apuracao.totalImpostos : (apuracao?.receita ?? Number(ficha?.totalImpostos ?? 0)),
                documentos: eCaptura ? contagem.total : null,
                rotulo: temImposto ? 'A apuração' : 'A receita lançada',
                receitaSemDocumento: 0,
            });
        } catch (e) {
            console.warn('[fim-de-mes] lastro indisponível:', e.message);
        }

        const agoraIso = new Date().toISOString();
        const montado = montarFimDeMes({
            empresaId: r.empresa.id,
            competencia: r.competencia,
            regime: r.empresa.colecao === 'simples_empresas' ? 'SIMPLES' : (r.empresa.regimePadrao || null),
            rotina: r.rotina,
            ficha,
            // A MESMA leitura que fechou a etapa 3 — perguntar de outro jeito
            // aqui foi o que fez a tela dizer "pronto" e o botão recusar.
            apuracao,
            corte: montarCorte({ agoraIso, state: cursor, documentos: contagem }),
            lastro,
            quem: { uid: req.user?.uid || null, email: req.user?.email || null, nome: null /* requireAuth não carrega nome; o e-mail identifica */ },
            agoraIso,
            anterior: r.fechamento,
        });

        // A recusa chega à tela com os BLOQUEIOS nomeados — 400, nunca 500:
        // "não pode fechar" é resposta, não falha do servidor.
        if (!montado.ok) {
            return res.status(400).json({ ok: false, erro: montado.motivo, bloqueios: montado.bloqueios });
        }

        // 🔒 TRANSAÇÃO: o carimbo foi LIDO lá em cima e a decisão saiu dele.
        // Se entre a leitura e a gravação alguém fechou ou reabriu (dois
        // cliques, duas abas), gravar por cima apagaria uma versão que o
        // Contábil pode já ter importado. A gravação relê e só escreve se o
        // documento ainda é o que a decisão viu (mesma versão, mesmo estado).
        const ref = db.collection(COLECAO).doc(idDoFechamento(r.empresa.id, r.competencia));
        const versaoLida = Number(r.fechamento?.versao || 0);
        const estadoLido = r.fechamento?.estado || null;
        try {
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                const atual = snap.exists ? (snap.data() || {}) : null;
                const versaoAtual = Number(atual?.versao || 0);
                const estadoAtual = atual?.estado || null;
                if (versaoAtual !== versaoLida || estadoAtual !== estadoLido) {
                    const e = new Error('A competência mudou enquanto você fechava (outra pessoa fechou ou reabriu). '
                        + 'Recarregue a tela e confira antes de fechar de novo.');
                    e.conflito = true;
                    throw e;
                }
                tx.set(ref, montado.fechamento, { merge: false });
            });
        } catch (e) {
            if (e?.conflito) return res.status(409).json({ ok: false, erro: e.message });
            throw e;
        }

        return res.json({ ok: true, fechamento: montado.fechamento, descricao: descreverFechamento(montado.fechamento) });
    } catch (e) {
        console.error('[fim-de-mes] fechar:', e);
        return res.status(500).json({ ok: false, erro: e.message });
    }
});

// 🚨 REABRIR É SÓ ADMIN (decisão do Paulo, 26/08) — o número já pode ter sido
// importado pela contabilidade, e reabrir não é "desfazer": é RETIFICAÇÃO.
// A guarda é dupla de propósito: o `req.user.role === 'admin'` aqui e a régua pura
// (🐛 03/09: estava `req.user.admin`, campo que o requireAuth NUNCA preenche —
// `ehAdmin` saía sempre false e NENHUM admin conseguia reabrir; o 403 mandava
// procurar um problema de permissão que não existia)
// `conferirReabertura`, que também exige o motivo escrito.
router.post('/reabrir', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { empresaId, competencia, motivo } = req.body || {};
        const r = await situacaoDaCompetencia(db, req.user, String(empresaId || ''), String(competencia || ''));
        if (r.erro) return res.status(r.status || 400).json({ ok: false, erro: r.erro });

        const conferido = conferirReabertura({
            fechamento: r.fechamento, motivo: String(motivo || ''), ehAdmin: req.user?.role === 'admin',
        });
        if (!conferido.pode) return res.status(403).json({ ok: false, erro: conferido.erro });

        const reaberto = aplicarReabertura({
            fechamento: r.fechamento, motivo: String(motivo),
            quem: { uid: req.user?.uid || null, email: req.user?.email || null, nome: req.user?.name || null },
            agoraIso: new Date().toISOString(),
        });
        await db.collection(COLECAO).doc(idDoFechamento(r.empresa.id, r.competencia))
            .set(reaberto, { merge: false });

        return res.json({ ok: true, fechamento: reaberto, descricao: descreverFechamento(reaberto) });
    } catch (e) {
        console.error('[fim-de-mes] reabrir:', e);
        return res.status(500).json({ ok: false, erro: e.message });
    }
});

export default router;

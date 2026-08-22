// ============================================================================
// sefaz-backend/sped-contrib-routes.js  (ESM)
// Endpoints: /sped-contrib/preview, /sped-contrib/gerar
//
// Layout alvo: EFD Contribuicoes (PIS/COFINS) Guia Pratico 1.35.
// ============================================================================

import express from 'express';
import { coletarDadosContribuicoes, montarBlocosContribuicoes } from './sped-contrib-orchestrator.js';
import {
    conferirContagemDeCampos, conferirPerfilConsolidado, avisosDaPrevalidacaoContrib,
} from './sped-contrib-campos.js';
import { auditarSaidaSped, resumoAuditoria } from './sped-auditoria-saida.js';
import { requireAdmin } from './require-admin.js';
import { competenciaParaGerarArquivo } from './competencia.js';

const router = express.Router();


/**
 * GET /preview?empresaId=X&competencia=YYYY-MM
 * Retorna estatisticas: notas, itens, participantes elegiveis pro periodo.
 */
router.get('/preview', requireAdmin, async (req, res) => {
    try {
        const { empresaId } = req.query;
        const comp = competenciaParaGerarArquivo(req.query.competencia);
        if (!comp.ok) return res.status(400).json({ error: comp.erro });
        const competencia = comp.competencia;
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });

        const dados = await coletarDadosContribuicoes({ empresaId, competencia });

        return res.json({
            empresaId,
            empresaNome: dados.empresa.nome,
            competencia,
            regimeApuracao: dados.regimeApuracao,
            totais: {
                notas: dados.notas.length,
                itens: dados.itens.length,
                participantes: dados.participantes.length,
                unidades: dados.unidades.length,
            },
            warnings: dados.warnings,
        });
    } catch (e) {
        return tratarErro(e, res);
    }
});

/**
 * POST /gerar
 * Body: { empresaId, competencia }
 * Retorna o .txt do SPED Contribuicoes montado, com Content-Disposition pra download.
 */
router.post('/gerar', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId } = req.body || {};
        const comp = competenciaParaGerarArquivo((req.body || {}).competencia);
        if (!comp.ok) return res.status(400).json({ error: comp.erro });
        const competencia = comp.competencia;
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });

        const dados = await coletarDadosContribuicoes({ empresaId, competencia });

        const txt = await montarBlocosContribuicoes({ dados });

        // AUDITORIA DO ARQUIVO QUE SAIU — a mesma trava do SPED Fiscal. A
        // regra diz "roda em TODO arquivo gerado", e até agora ela só rodava
        // num deles: escrever a regra e não ligar em todo lugar é a folga que
        // deixa o próximo defeito passar.
        const auditoria = auditarSaidaSped(txt.split('\r\n').filter(Boolean));
        for (const s of auditoria.suspeitas) dados.warnings.push(`[auditoria] ${s.detalhe}`);

        // CONTAGEM DE CAMPOS POR REGISTRO — a classe de defeito que já derrubou
        // o arquivo da MANTOAN DUAS vezes (1010 em 17/08, M210/M610 em 18/08).
        // A auditoria acima pergunta sobre o CONTEÚDO (coluna zerada, total que
        // não bate); esta pergunta é sobre a ESTRUTURA, e faltava.
        //
        // ⚠️ Ela só acusa registro com contagem PROVADA por recibo do PVA — e o
        // que não foi provado volta NOMEADO, porque silêncio aqui não é
        // aprovação. Tabela de contagens escrita de memória seria uma segunda
        // cópia do mesmo palpite que produziu o defeito.
        const linhasDoArquivo = txt.split('\r\n').filter(Boolean);
        const campos = conferirContagemDeCampos(linhasDoArquivo);
        for (const e of campos.erros) dados.warnings.push(`[leiaute] ${e.mensagem}`);

        // O PERFIL do arquivo: consolidado (F550) não admite documento. Recusa
        // REAL do PVA em 21/08 (AFFITTARE) — conferida sobre as LINHAS, o mesmo
        // texto que o validador lê, para a próxima empresa gastar UMA volta.
        for (const e of conferirPerfilConsolidado(linhasDoArquivo).erros) {
            dados.warnings.push(`[perfil] ${e.mensagem}`);
        }

        // As recusas que o PVA JÁ NOS DEU, conferidas sobre o arquivo — uma
        // volta em vez de N. Recusa aprendida e corrigida só no gerador fecha a
        // INSTÂNCIA; é aqui que ela fecha a CLASSE (COD_ITEM vazio, MANTOAN;
        // IND_ORIG_CRED da entrada, MANTOAN; M200/M600 × Σ F600, HS PROJETOS).
        for (const aviso of avisosDaPrevalidacaoContrib(linhasDoArquivo)) {
            dados.warnings.push(`[prevalidação] ${aviso}`);
        }

        // Encoding Windows-1252 (legado SPED)
        const buffer = Buffer.from(txt, 'latin1');

        // Nome do arquivo: SPED_CONTRIB_<cnpj>_<periodo>.txt
        const cnpj = (dados.empresa.cnpj || '').replace(/\D/g, '');
        const periodo = competencia.replace('-', '');
        const filename = `SPED_CONTRIB_${cnpj}_${periodo}.txt`;

        res.setHeader('Content-Type', 'text/plain; charset=windows-1252');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        if (dados.warnings.length) {
            res.setHeader('X-SPED-Warnings', encodeURIComponent(JSON.stringify(dados.warnings)));
        }
        res.setHeader('X-SPED-Stats', encodeURIComponent(JSON.stringify({
            notas: dados.notas.length,
            itens: dados.itens.length,
            participantes: dados.participantes.length,
            linhas: txt.split('\r\n').length - 1,
            regimeApuracao: dados.regimeApuracao,
        })));
        res.setHeader('X-SPED-Auditoria', encodeURIComponent(JSON.stringify({
            ok: auditoria.ok, resumo: resumoAuditoria(auditoria), suspeitas: auditoria.suspeitas,
            leiaute: {
                ok: campos.ok,
                erros: campos.erros,
                naoConferidos: campos.naoConferidos,
            },
        })));
        return res.send(buffer);
    } catch (e) {
        return tratarErro(e, res);
    }
});

function tratarErro(e, res) {
    if (e.code === 'DADOS_FISCAIS_INCOMPLETOS') {
        return res.status(400).json({
            error: 'DADOS_FISCAIS_INCOMPLETOS',
            message: e.message,
        });
    }
    if (e.code === 'EMPRESA_NAO_ENCONTRADA') {
        return res.status(404).json({
            error: 'EMPRESA_NAO_ENCONTRADA',
            message: e.message,
        });
    }
    console.error('[sped-contrib]', e);
    return res.status(500).json({ error: e.message });
}

export default router;

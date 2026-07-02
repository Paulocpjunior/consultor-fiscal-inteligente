/**
 * services/nfpAnaliseSerpro.ts
 *
 * Mapeia a resposta do SERPRO (situacao fiscal + divida ativa + certidoes +
 * obrigacoes + parcelamentos) numa atualizacao parcial de NfpAnaliseEmpresa.
 *
 * Antes vivia inline em components/NfpProCloud/index.tsx (handleAnaliseReal).
 * Como eh puro e nao toca em state/UI, faz sentido isolar pra ficar testavel
 * e nao inflar o componente.
 *
 * Helpers fora dependem do CERTIDOES_BASE e OBRIGACOES_BASE do dashboard --
 * passados como argumento pra evitar import cruzado component <-> service.
 */
import type {
    NfpAnaliseEmpresa, NfpCertidao, NfpObrigacao, NfpDebito, NfpParcelamento,
    NfpEsfera, NfpStatusDebito, NfpStatusCertidao, NfpStatusObrigacao,
} from '../types';

type BaseCertidao = {
    orgao: string;
    tipo: string;
    esfera: NfpEsfera;
    fonte: 'automatico' | 'manual';
};

type BaseObrigacao = {
    nome: string;
    sigla: string;
    esfera: NfpEsfera;
    periodicidade: 'mensal' | 'trimestral' | 'anual';
};

export interface MapearSerproInput {
    resp: any; // SERPRO response shape -- nfpProCloudService.analisarEmpresaCompleta
    baseAnalise: NfpAnaliseEmpresa;
    activeEmpresaId: string;
    analisadoPor: string;
    fonteAnalise: string;
    certidoesBase: BaseCertidao[];
    obrigacoesBase: BaseObrigacao[];
    /** Gerador de id (uid()) injetado pra nao misturar o helper do dashboard. */
    uid: () => string;
}

export interface MapearSerproOutput {
    /** Analise atualizada pronta pra setAnalise. */
    updated: NfpAnaliseEmpresa;
    /** true quando SERPRO retornou em modo DRY_RUN (mostra banner amarelo). */
    isMock: boolean;
}

function normKey(value: string | undefined | null): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();
}

function obrigacaoKey(o: Pick<NfpObrigacao | BaseObrigacao, 'esfera' | 'sigla' | 'nome'>): string {
    return `${o.esfera}|${normKey(o.sigla) || normKey(o.nome)}`;
}

function findObrigacaoAnterior(
    obrigacoes: NfpObrigacao[],
    base: BaseObrigacao,
    match?: any,
): NfpObrigacao | undefined {
    const baseSigla = normKey(base.sigla);
    const baseNome = normKey(base.nome);
    const matchSigla = normKey(match?.sigla);
    const matchNome = normKey(match?.nome);
    return obrigacoes.find(o => {
        const sigla = normKey(o.sigla);
        const nome = normKey(o.nome);
        if (o.esfera === base.esfera && sigla && sigla === baseSigla) return true;
        if (o.esfera === base.esfera && nome && nome === baseNome) return true;
        if (matchSigla && sigla === matchSigla) return true;
        if (matchNome && nome === matchNome) return true;
        return false;
    });
}

export function mapearRespostaSerpro(input: MapearSerproInput): MapearSerproOutput {
    const { resp, baseAnalise, activeEmpresaId, analisadoPor, fonteAnalise, certidoesBase, obrigacoesBase, uid } = input;

    // Populate debitos from situacaoFiscal + dividaAtiva
    const debitos: NfpDebito[] = [];
    if (resp.situacaoFiscal?.ok && resp.situacaoFiscal.debitos) {
        for (const d of resp.situacaoFiscal.debitos) {
            debitos.push({
                id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                orgao: 'Receita Federal', descricao: d.tributo || d.descricao || 'Débito Federal',
                valorOriginal: Number(d.valorOriginal || 0), dataVencimento: d.competencia || new Date().toISOString().slice(0, 10),
                status: (d.status === 'quitado' ? 'quitado' : 'aberto') as NfpStatusDebito,
            });
        }
    }
    if (resp.dividaAtiva?.ok && resp.dividaAtiva.inscricoes) {
        for (const i of resp.dividaAtiva.inscricoes) {
            debitos.push({
                id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                orgao: 'PGFN', descricao: `Dívida Ativa ${i.numero || ''}`.trim(),
                valorOriginal: Number(i.valorConsolidado || 0), dataVencimento: i.dataInscricao || new Date().toISOString().slice(0, 10),
                status: 'aberto' as NfpStatusDebito,
            });
        }
    }

    // Populate certidoes — map SERPRO response (esfera 'fgts'/'trabalhista')
    // para o CERTIDOES_BASE (esfera 'federal' para todas as CNDs federais).
    const certidoes: NfpCertidao[] = certidoesBase.map(c => {
        const match = resp.certidoes?.certidoes?.find((rc: any) => {
            const esf = String(rc.esfera || '').toLowerCase();
            if (c.esfera === 'federal' && c.tipo.includes('CND Federal') && esf === 'federal') return true;
            if (c.esfera === 'estadual' && esf === 'estadual') return true;
            if (c.tipo.includes('CNDT') && esf === 'trabalhista') return true;
            if (c.tipo.includes('FGTS') && esf === 'fgts') return true;
            return false;
        });
        return {
            id: uid(), empresaId: activeEmpresaId, esfera: c.esfera,
            orgao: match?.orgao || c.orgao, tipo: match?.tipo || c.tipo,
            status: (match?.status as NfpStatusCertidao) || 'nao_consultada',
            dataValidade: match?.validade || undefined,
            dataEmissao: match?.dataEmissao || undefined,
            numeroCertidao: match?.numero || undefined,
            motivoImpedimento: match?.motivo || undefined,
            pdfBase64: match?.pdfBase64 || undefined,
            fonte: (match?.fonte || undefined) as any,
            portalUrl: match?.portalUrl || undefined,
            dataConsulta: match ? new Date().toISOString().slice(0, 10) : undefined,
        };
    });

    // Populate obrigacoes
    const obrigacoes: NfpObrigacao[] = obrigacoesBase.map(o => {
        const match = resp.obrigacoes?.obrigacoes?.find((ro: any) =>
            (ro.sigla || '').toUpperCase() === o.sigla.toUpperCase()
        );
        const anterior = findObrigacaoAnterior(baseAnalise.obrigacoes || [], o, match);
        return {
            id: anterior?.id || uid(), empresaId: activeEmpresaId,
            nome: o.nome, sigla: o.sigla, esfera: o.esfera, periodicidade: o.periodicidade,
            status: (match?.status as NfpStatusObrigacao) || anterior?.status || 'nao_verificada',
            competencia: match?.competencia || anterior?.competencia || undefined,
            dataEntrega: match?.dataEntrega || anterior?.dataEntrega || undefined,
            prazoLegal: match?.prazoLegal || anterior?.prazoLegal || undefined,
            observacao: match?.observacao || anterior?.observacao || undefined,
        };
    });
    const obrigacoesKeys = new Set(obrigacoes.map(obrigacaoKey));
    for (const anterior of baseAnalise.obrigacoes || []) {
        const key = obrigacaoKey(anterior);
        if (obrigacoesKeys.has(key)) continue;
        obrigacoes.push({
            ...anterior,
            empresaId: activeEmpresaId,
        });
        obrigacoesKeys.add(key);
    }

    // Populate parcelamentos
    const parcelamentos: NfpParcelamento[] = [];
    if (resp.parcelamentos?.ok && resp.parcelamentos.parcelamentos) {
        for (const p of resp.parcelamentos.parcelamentos) {
            parcelamentos.push({
                id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                programa: p.programa || '', valorTotal: Number(p.valorTotal || 0),
                parcelas: Number(p.parcelas || 0), parcelasPagas: Number(p.parcelasPagas || 0),
                valorParcela: p.parcelas > 0 ? Math.round((p.valorTotal / p.parcelas) * 100) / 100 : 0,
                status: (p.status || 'ativo') as any, dataInicio: p.dataInicio || new Date().toISOString().slice(0, 10),
            });
        }
    }

    const updated: NfpAnaliseEmpresa = {
        ...baseAnalise,
        dataAnalise: new Date().toISOString(),
        analisadoPor,
        fonte: fonteAnalise as any,
        debitos: debitos.length > 0 ? debitos : baseAnalise.debitos,
        certidoes: resp.certidoes?.ok ? certidoes : baseAnalise.certidoes,
        obrigacoes: resp.obrigacoes?.ok ? obrigacoes : baseAnalise.obrigacoes,
        parcelamentos: parcelamentos.length > 0 ? parcelamentos : baseAnalise.parcelamentos,
    };

    const isMock = resp.situacaoFiscal?.fonte === 'mock' || resp.certidoes?.fonte === 'mock';
    if (isMock) {
        (updated as any)._serproMock = true;
    }

    return { updated, isMock };
}

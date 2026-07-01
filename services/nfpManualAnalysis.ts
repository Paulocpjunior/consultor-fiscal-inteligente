import type {
    NfpAcaoJudicial,
    NfpAnaliseEmpresa,
    NfpCertidao,
    NfpDebito,
    NfpEsfera,
    NfpGravidade,
    NfpObrigacao,
    NfpParcelamento,
    NfpPlanoAcao,
    NfpStatusCertidao,
    NfpStatusDebito,
    NfpStatusObrigacao,
    NfpTipoAcao,
} from '../types';

export interface NfpManualDebitoInput {
    esfera: NfpEsfera;
    orgao: string;
    descricao: string;
    valorOriginal: number;
    dataVencimento: string;
    status: NfpStatusDebito;
    observacao?: string;
}

export interface NfpManualCertidaoInput {
    esfera: NfpEsfera;
    orgao: string;
    tipo: string;
    status: NfpStatusCertidao;
    dataValidade?: string;
    motivoImpedimento?: string;
}

export interface NfpManualObrigacaoInput {
    esfera: NfpEsfera;
    nome: string;
    sigla: string;
    periodicidade: 'mensal' | 'trimestral' | 'anual' | 'eventual';
    competencia?: string;
    status: NfpStatusObrigacao;
    prazoLegal?: string;
    observacao?: string;
}

export interface NfpManualParcelamentoInput {
    esfera: NfpEsfera;
    programa: string;
    valorTotal: number;
    parcelas: number;
    parcelasPagas: number;
    valorParcela: number;
    status: NfpParcelamento['status'];
    dataInicio: string;
}

export interface NfpManualAcaoInput {
    tipo: NfpTipoAcao;
    descricao: string;
    status: NfpAcaoJudicial['status'];
    numero?: string;
    vara?: string;
    valorCausa?: number;
}

export interface CriarAnaliseManualInput {
    baseAnalise: NfpAnaliseEmpresa;
    activeEmpresaId: string;
    analisadoPor: string;
    debitos: NfpManualDebitoInput[];
    certidoes: NfpManualCertidaoInput[];
    obrigacoes: NfpManualObrigacaoInput[];
    parcelamentos: NfpManualParcelamentoInput[];
    acoes: NfpManualAcaoInput[];
    uid: () => string;
    hoje?: Date;
}

function addDaysISO(base: Date, days: number): string {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function isPastDate(dateISO: string | undefined, hoje: Date): boolean {
    if (!dateISO) return false;
    const date = new Date(`${dateISO}T00:00:00`);
    return Number.isFinite(date.getTime()) && date.getTime() < new Date(hoje.toISOString().slice(0, 10)).getTime();
}

function gravidadeDebito(d: NfpDebito, hoje: Date): NfpGravidade {
    if (d.status === 'aberto' && (isPastDate(d.dataVencimento, hoje) || d.valorOriginal >= 10000)) return 'alta';
    if (d.status === 'em_analise' || d.status === 'parcelado') return 'media';
    return 'baixa';
}

function gravidadeCertidao(status: NfpStatusCertidao): NfpGravidade {
    if (status === 'positiva') return 'alta';
    if (status === 'positiva_efeitos_negativa' || status === 'indisponivel') return 'media';
    return 'baixa';
}

function gravidadeObrigacao(status: NfpStatusObrigacao): NfpGravidade {
    if (status === 'atrasada') return 'alta';
    if (status === 'pendente') return 'media';
    return 'baixa';
}

function compactText(parts: Array<string | undefined | null>): string {
    return parts.map(p => (p || '').trim()).filter(Boolean).join(' - ');
}

export function criarAnaliseManual(input: CriarAnaliseManualInput): NfpAnaliseEmpresa {
    const hoje = input.hoje || new Date();

    const debitos: NfpDebito[] = input.debitos.map(d => ({
        id: input.uid(),
        empresaId: input.activeEmpresaId,
        esfera: d.esfera,
        orgao: d.orgao.trim(),
        descricao: d.descricao.trim() || 'Débito informado manualmente',
        valorOriginal: Number(d.valorOriginal || 0),
        dataVencimento: d.dataVencimento || hoje.toISOString().slice(0, 10),
        status: d.status,
        observacao: d.observacao?.trim() || undefined,
    }));

    const certidoes: NfpCertidao[] = input.certidoes.map(c => ({
        id: input.uid(),
        empresaId: input.activeEmpresaId,
        esfera: c.esfera,
        orgao: c.orgao.trim(),
        tipo: c.tipo.trim() || 'Certidão informada manualmente',
        status: c.status,
        dataConsulta: hoje.toISOString().slice(0, 10),
        dataValidade: c.dataValidade || undefined,
        motivoImpedimento: c.motivoImpedimento?.trim() || undefined,
        fonte: 'manual',
    }));

    const obrigacoes: NfpObrigacao[] = input.obrigacoes.map(o => ({
        id: input.uid(),
        empresaId: input.activeEmpresaId,
        esfera: o.esfera,
        nome: o.nome.trim() || o.sigla.trim() || 'Obrigação informada manualmente',
        sigla: o.sigla.trim() || o.nome.trim() || 'MANUAL',
        periodicidade: o.periodicidade,
        competencia: o.competencia?.trim() || undefined,
        status: o.status,
        prazoLegal: o.prazoLegal || undefined,
        observacao: o.observacao?.trim() || undefined,
    }));

    const parcelamentos: NfpParcelamento[] = input.parcelamentos.map(p => ({
        id: input.uid(),
        empresaId: input.activeEmpresaId,
        esfera: p.esfera,
        programa: p.programa.trim() || 'Parcelamento informado manualmente',
        valorTotal: Number(p.valorTotal || 0),
        parcelas: Number(p.parcelas || 0),
        parcelasPagas: Number(p.parcelasPagas || 0),
        valorParcela: Number(p.valorParcela || 0),
        status: p.status,
        dataInicio: p.dataInicio || hoje.toISOString().slice(0, 10),
    }));

    const acoes: NfpAcaoJudicial[] = input.acoes.map(a => ({
        id: input.uid(),
        empresaId: input.activeEmpresaId,
        tipo: a.tipo,
        descricao: a.descricao.trim() || 'Ação informada manualmente',
        status: a.status,
        numero: a.numero?.trim() || undefined,
        vara: a.vara?.trim() || undefined,
        valorCausa: Number(a.valorCausa || 0) || undefined,
    }));

    const planoAcao: NfpPlanoAcao[] = [];
    const addPlano = (descricao: string, gravidade: NfpGravidade, esfera: NfpEsfera, prazoDias: number, tipo?: NfpTipoAcao) => {
        planoAcao.push({
            id: input.uid(),
            empresaId: input.activeEmpresaId,
            descricao,
            gravidade,
            esfera,
            prazo: addDaysISO(hoje, prazoDias),
            status: 'pendente',
            tipo,
        });
    };

    for (const d of debitos) {
        if (d.status === 'quitado' || d.status === 'prescrito') continue;
        const gravidade = gravidadeDebito(d, hoje);
        const prazo = gravidade === 'alta' ? 3 : gravidade === 'media' ? 10 : 20;
        addPlano(
            compactText(['Regularizar débito', d.orgao, d.descricao, d.valorOriginal > 0 ? d.valorOriginal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : undefined]),
            gravidade,
            d.esfera,
            prazo,
        );
    }

    for (const c of certidoes) {
        if (c.status === 'negativa') continue;
        const gravidade = gravidadeCertidao(c.status);
        const prazo = gravidade === 'alta' ? 3 : gravidade === 'media' ? 7 : 15;
        addPlano(
            compactText(['Tratar certidão', c.orgao, c.tipo, c.motivoImpedimento]),
            gravidade,
            c.esfera,
            prazo,
        );
    }

    for (const o of obrigacoes) {
        if (o.status === 'entregue' || o.status === 'dispensada') continue;
        const gravidade = gravidadeObrigacao(o.status);
        const prazo = gravidade === 'alta' ? 2 : gravidade === 'media' ? 7 : 15;
        addPlano(
            compactText(['Regularizar obrigação', o.sigla, o.competencia, o.observacao]),
            gravidade,
            o.esfera,
            prazo,
        );
    }

    for (const p of parcelamentos) {
        if (p.status === 'quitado' || p.status === 'ativo') continue;
        addPlano(
            compactText(['Regularizar parcelamento', p.programa, p.status]),
            p.status === 'inadimplente' ? 'alta' : 'media',
            p.esfera,
            p.status === 'inadimplente' ? 3 : 10,
        );
    }

    for (const a of acoes) {
        if (a.status !== 'em_andamento') continue;
        const gravidade: NfpGravidade = a.tipo === 'tributaria' || Number(a.valorCausa || 0) >= 50000 ? 'media' : 'baixa';
        addPlano(
            compactText(['Acompanhar ação judicial', a.numero, a.descricao]),
            gravidade,
            'federal',
            gravidade === 'media' ? 15 : 30,
            a.tipo,
        );
    }

    return {
        ...input.baseAnalise,
        fonte: 'offline',
        dataAnalise: hoje.toISOString(),
        analisadoPor: input.analisadoPor,
        debitos,
        certidoes,
        obrigacoes,
        parcelamentos,
        acoes,
        planoAcao,
    };
}

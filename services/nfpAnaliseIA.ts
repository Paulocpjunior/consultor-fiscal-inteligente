/**
 * services/nfpAnaliseIA.ts
 *
 * Parecer de IA sobre a situação fiscal (NFP Pro Cloud / Consulta Situação
 * Fiscal). O prompt é montado a partir do MESMO objeto NfpAnaliseEmpresa
 * usado por todas as abas — portanto o parecer é idêntico em formato tanto
 * para o fluxo de inclusão manual (colaborador) quanto para a varredura
 * automática com certificado digital do cliente.
 *
 * A chamada vai pro proxy /api/fiscal/query (Gemini no backend), mesmo canal
 * usado pelo geminiService.
 */
import type { NfpAnaliseEmpresa, NfpAnaliseIA } from '../types';
import { auth } from './firebaseConfig';
import { fmtBRL } from './formatos';


const FONTE_LABEL: Record<NfpAnaliseEmpresa['fonte'], string> = {
    certificado_escritorio: 'varredura automática com certificado digital do escritório',
    certificado_cliente: 'varredura automática com certificado digital fornecido pelo cliente',
    offline: 'diagnóstico manual lançado pelo colaborador',
};

export interface GerarAnaliseIAOptions {
    regime?: string;
    atividade?: string;
    geradoPor?: string;
}

/** Monta o prompt do parecer (exportado para teste). */
export function montarPromptAnaliseIA(analise: NfpAnaliseEmpresa, opts: GerarAnaliseIAOptions = {}): string {
    const linhas: string[] = [];
    linhas.push('Você é um consultor tributário sênior. Elabore um parecer de situação fiscal em português do Brasil, voltado ao cliente (empresário, não contador), com base nos dados abaixo.');
    linhas.push('');
    linhas.push(`Empresa: ${analise.empresaNome || 'não informado'} — CNPJ ${analise.empresaCnpj || 'não informado'}`);
    if (opts.regime) linhas.push(`Regime tributário: ${opts.regime}`);
    if (opts.atividade) linhas.push(`Atividade: ${opts.atividade}`);
    linhas.push(`Origem dos dados: ${FONTE_LABEL[analise.fonte] || analise.fonte}`);
    linhas.push(`Data da análise: ${analise.dataAnalise?.slice(0, 10) || 'não informada'}`);

    const debitos = analise.debitos || [];
    linhas.push('');
    linhas.push(`DÉBITOS (${debitos.length}):`);
    if (!debitos.length) linhas.push('- nenhum débito apontado');
    for (const d of debitos) {
        linhas.push(`- [${d.esfera}] ${d.orgao}: ${d.descricao} — ${fmtBRL(d.valorAtualizado ?? d.valorOriginal)} — venc. ${d.dataVencimento} — status: ${d.status}${d.observacao ? ` — obs: ${d.observacao}` : ''}`);
    }

    const certidoes = (analise.certidoes || []).filter(c => c.status !== 'nao_consultada');
    linhas.push('');
    linhas.push(`CERTIDÕES (${certidoes.length} consultadas):`);
    if (!certidoes.length) linhas.push('- nenhuma certidão consultada');
    for (const c of certidoes) {
        linhas.push(`- [${c.esfera}] ${c.orgao} / ${c.tipo}: ${c.status}${c.motivoImpedimento ? ` — motivo: ${c.motivoImpedimento}` : ''}${c.dataValidade ? ` — validade: ${c.dataValidade}` : ''}`);
    }

    const obrigacoes = (analise.obrigacoes || []).filter(o => o.status !== 'nao_verificada');
    linhas.push('');
    linhas.push(`OBRIGAÇÕES ACESSÓRIAS (${obrigacoes.length} verificadas):`);
    if (!obrigacoes.length) linhas.push('- nenhuma obrigação verificada');
    for (const o of obrigacoes) {
        linhas.push(`- [${o.esfera}] ${o.sigla} (${o.periodicidade}): ${o.status}${o.competencia ? ` — competência ${o.competencia}` : ''}${o.observacao ? ` — obs: ${o.observacao}` : ''}`);
    }

    const parcelamentos = analise.parcelamentos || [];
    linhas.push('');
    linhas.push(`PARCELAMENTOS (${parcelamentos.length}):`);
    if (!parcelamentos.length) linhas.push('- nenhum parcelamento');
    for (const p of parcelamentos) {
        linhas.push(`- [${p.esfera}] ${p.programa}: ${fmtBRL(p.valorTotal)} em ${p.parcelas}x (${p.parcelasPagas} pagas) — status: ${p.status}`);
    }

    const acoes = analise.acoes || [];
    linhas.push('');
    linhas.push(`AÇÕES JUDICIAIS (${acoes.length}):`);
    if (!acoes.length) linhas.push('- nenhuma ação judicial');
    for (const a of acoes) {
        linhas.push(`- [${a.tipo}] ${a.descricao}${a.numero ? ` — processo ${a.numero}` : ''}${a.valorCausa ? ` — valor da causa ${fmtBRL(a.valorCausa)}` : ''} — status: ${a.status}`);
    }

    const trabalhistas = analise.apontamentosTrabalhistas || [];
    const tipoTrabLabel: Record<string, string> = {
        sem_registro: 'funcionário SEM REGISTRO',
        registro_fora_prazo: 'registro efetivado FORA DO PRAZO',
        outro: 'outra irregularidade',
    };
    const fonteTrabLabel: Record<string, string> = {
        folha: 'Folha de Pagamentos',
        esocial: 'eSocial',
        manual: 'apuração manual',
    };
    linhas.push('');
    linhas.push(`APONTAMENTOS TRABALHISTAS — FOLHA × E-SOCIAL (${trabalhistas.length}):`);
    if (!trabalhistas.length) linhas.push('- nenhum apontamento trabalhista');
    for (const t of trabalhistas) {
        const datas = [
            t.dataInicioTrabalho ? `início real dos trabalhos em ${t.dataInicioTrabalho}` : null,
            t.dataRegistro ? `registro em ${t.dataRegistro}` : (t.tipo === 'sem_registro' ? 'sem registro até a data da análise' : null),
        ].filter(Boolean).join(', ');
        linhas.push(`- [gravidade ${t.gravidade}] ${t.funcionario || 'funcionário não identificado'}: ${tipoTrabLabel[t.tipo] || t.tipo}${datas ? ` — ${datas}` : ''} — fonte: ${fonteTrabLabel[t.fonte] || t.fonte} — status: ${t.status}${t.observacao ? ` — obs: ${t.observacao}` : ''}`);
    }

    const plano = analise.planoAcao || [];
    linhas.push('');
    linhas.push(`PLANO DE AÇÃO PROPOSTO (${plano.length} itens):`);
    if (!plano.length) linhas.push('- nenhum item no plano de ação');
    for (const p of plano) {
        linhas.push(`- [gravidade ${p.gravidade}] ${p.descricao}${p.prazo ? ` — prazo ${p.prazo}` : ''} — status: ${p.status}`);
    }

    linhas.push('');
    linhas.push('Estruture o parecer em:');
    linhas.push('1. Resumo executivo (2-3 frases sobre a saúde fiscal geral);');
    linhas.push('2. Pontos críticos (riscos imediatos, ordenados por gravidade, com impacto prático — bloqueio de certidão, exclusão de regime, execução fiscal, e riscos trabalhistas como autuação por funcionário sem registro, multas do eSocial e passivo trabalhista, quando houver apontamentos);');
    linhas.push('3. Recomendações (conectadas ao plano de ação proposto, com prioridades e próximos passos);');
    linhas.push('4. Oportunidades (parcelamentos, transações tributárias, recuperação de créditos, quando aplicável).');
    linhas.push('Seja objetivo, use linguagem acessível e NÃO invente dados que não estejam listados acima.');

    return linhas.join('\n');
}

/**
 * Gera o parecer via proxy Gemini e devolve o bloco pronto pra persistir em
 * NfpAnaliseEmpresa.analiseIA.
 */
export async function gerarAnaliseIA(analise: NfpAnaliseEmpresa, opts: GerarAnaliseIAOptions = {}): Promise<NfpAnaliseIA> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await auth?.currentUser?.getIdToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/fiscal/query', {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: montarPromptAnaliseIA(analise, opts), temperature: 0.3 }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status} ao gerar análise de IA`);
    }
    const data = await res.json();
    const texto = (data.text || '').trim();
    if (!texto) throw new Error('A IA não retornou conteúdo. Tente novamente.');

    return {
        texto,
        geradoEm: new Date().toISOString(),
        geradoPor: opts.geradoPor || undefined,
        fonteDados: analise.fonte,
    };
}

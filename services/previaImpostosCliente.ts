/**
 * previaImpostosCliente — a PRÉVIA que vai ao cliente, antes de emitir a guia.
 *
 * ═══ O PEDIDO ═══════════════════════════════════════════════════════════════
 *
 * Paulo, 18/08: *"tem como criar um relatório ou algo similar à nossa ficha
 * financeira para que eu possa enviar ao cliente? Essa empresa me pede a prévia
 * dos impostos antes da emissão, até então enviava esse relatório do Excel"*.
 *
 * É o Excel de novo — e Excel não é ferramenta, é SINTOMA: onde a equipe abre
 * planilha existe lacuna do app (regra do escopo do mês, 11/08).
 *
 * ═══ POR QUE NÃO SERVE MANDAR A FICHA COMO ELA ESTÁ ═════════════════════════
 *
 * A MEMÓRIA DE APURAÇÃO sai por `window.print()` da própria tela, então o papel
 * carrega o rodapé do APP: build, commit, links internos, os cards de estudo
 * ("Regras do Lucro Presumido") e — o pior — *"As informações são geradas por IA
 * e devem ser usadas como referência"*.
 *
 * Numa prévia de imposto essa frase é falsa e cara ao mesmo tempo: os números
 * NÃO saem de IA (saem de `calcularLucro`), e dizer que saem convida o cliente a
 * desconfiar de um valor que ele vai pagar. Documento externo é outro produto.
 *
 * ═══ O QUE ELE NÃO FAZ ══════════════════════════════════════════════════════
 *
 * **Nenhuma conta própria.** Tudo vem de `calcularLucro` — a memória da base
 * (`memoriaBase`) e o `detalhamento`. Foi justamente a conta paralela "pra
 * exibição" que fez a ficha imprimir uma base que não gerava o imposto ao lado
 * (KROYA, 18/08). Relatório que recalcula é a segunda cópia de sempre.
 *
 * E ele **não promete guia**: prévia não é documento de arrecadação, e dizer
 * isso no papel evita que alguém pague por ele.
 */
import type { LucroResult, DetalheImposto } from '../types';
import type { IdentificacaoPdf } from './relatorioPdf';
import { saldosDaFicha, itensVisiveis, type SaldosDaFicha } from './saldoCredorFicha';

export interface PreviaImpostosParams {
    empresaNome: string;
    empresaCnpj?: string | null;
    /** 'AAAA-MM'. */
    competencia: string;
    resultado: LucroResult;
    ficha: {
        mesReferencia?: string | null;
        saldoCredorIcms?: number | null;
        saldoCredorIpi?: number | null;
        saldoCredorIcmsTransportar?: number | null;
        saldoCredorIpiTransportar?: number | null;
    };
    identificacao?: IdentificacaoPdf;
    /** Quem gerou — o papel vai ao cliente e precisa de responsável. */
    emitidoPor?: string | null;
    /** Data da emissão, injetada para o módulo continuar puro e testável. */
    emitidoEm?: Date;
}

export interface PreviaImpostosPdf {
    titulo: string;
    subtitulo: string;
    colunas: Array<{ titulo: string; largura: number; alinhamento?: 'esquerda' | 'direita' }>;
    linhas: string[][];
    totais: string[];
    observacoes: string[];
    identificacao?: IdentificacaoPdf;
    fileName: string;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** 'AAAA-MM' → 'MM/AAAA'. Competência ilegível volta como veio (nunca inventada). */
export function competenciaEscrita(c?: string | null): string {
    const m = /^(\d{4})-(\d{2})$/.exec(String(c || '').trim());
    return m ? `${m[2]}/${m[1]}` : String(c || '').trim();
}

/** Linha de seção: título na 1ª coluna, resto vazio — a casca já destaca. */
const secao = (t: string): string[] => [t.toUpperCase(), '', ''];

/**
 * As linhas da memória, na MESMA ordem da planilha que o Paulo manda hoje:
 * bruto → IPI → ICMS → ICMS ST → devolução → base.
 *
 * ⚠️ Dedução que não existe NÃO vira linha de R$ 0,00: linha zerada num papel de
 * cliente faz perguntar "por que tenho ICMS ST zero?" — e a resposta é que não
 * tem. O que é zero de verdade some; o que é desconhecido nunca chega aqui,
 * porque a memória vem do cálculo.
 */
function linhasDaMemoria(r: LucroResult): string[][] {
    const m = r.memoriaBase;
    if (!m) {
        // Sem memória não se INVENTA a base — a prévia diz o que não sabe.
        return [['Memória da base indisponível para esta ficha', '', 'Reabra a apuração e gere de novo']];
    }
    const l: string[][] = [];
    l.push(secao('Memória de cálculo da base'));
    l.push(['Faturamento bruto', brl(m.faturamentoBruto), '']);
    if (m.deducaoIpi > 0) l.push(['(−) IPI destacado', brl(m.deducaoIpi), 'Não integra a receita bruta (DL 1.598/77, art. 12, §4º)']);
    if (m.deducaoIcmsSt > 0) l.push(['(−) ICMS ST destacado', brl(m.deducaoIcmsSt), 'Não integra a receita bruta (DL 1.598/77, art. 12, §4º)']);
    if (m.deducaoDevolucoes > 0) l.push(['(−) Devoluções', brl(m.deducaoDevolucoes), '']);
    l.push(['Base de cálculo IRPJ/CSLL', brl(m.baseIrpjCsll), '']);
    if (m.deducaoIcmsVendas > 0) l.push(['(−) ICMS sobre vendas', brl(m.deducaoIcmsVendas), 'Exclusão da base (STF, RE 574.706)']);
    if (m.deducaoMonofasico > 0) l.push(['(−) Receita monofásica', brl(m.deducaoMonofasico), 'Tributação concentrada — fora da base de PIS/COFINS']);
    l.push(['Base de cálculo PIS/COFINS', brl(m.basePisCofins), '']);
    return l;
}

function linhasDosImpostos(r: LucroResult): string[][] {
    const l: string[][] = [secao('Impostos do período')];
    for (const d of (r.detalhamento || []) as DetalheImposto[]) {
        // Linha diferida (IRPJ/CSLL em mês que não fecha trimestre) sai com o
        // valor zero E a observação que EXPLICA — some seria pior: o cliente
        // perguntaria por que o IRPJ desapareceu do mês.
        l.push([d.imposto, brl(d.valor || 0), String(d.observacao || '')]);
    }
    return l;
}

function linhasDosSaldos(s: SaldosDaFicha): string[][] {
    const visiveis = itensVisiveis(s);
    if (!visiveis.length) return [];
    const l: string[][] = [secao('Saldos credores')];
    for (const i of visiveis) {
        if ((i.anterior || 0) > 0) {
            l.push([`Saldo credor de ${i.tributo} do mês anterior`, brl(i.anterior || 0), 'Compensado nesta competência']);
        }
        if (i.situacao === 'nao-informado') {
            // Nunca 0,00: ausência de informação não é ausência de crédito.
            l.push([`Saldo de ${i.tributo} a transportar`, '—', i.texto]);
        } else {
            l.push([
                `Saldo de ${i.tributo} a transportar${s.competenciaSeguinte ? ` para ${s.competenciaSeguinte}` : ''}`,
                brl(i.transportar || 0),
                i.situacao === 'zerado' ? 'Crédito consumido nesta competência' : '',
            ]);
        }
    }
    return l;
}

export function montarPreviaImpostos(p: PreviaImpostosParams): PreviaImpostosPdf {
    const saldos = saldosDaFicha({ ...p.ficha, mesReferencia: p.ficha.mesReferencia || p.competencia });
    const comp = competenciaEscrita(p.competencia);
    const cnpj = String(p.empresaCnpj || '').replace(/\D/g, '');
    const cnpjEscrito = cnpj.length === 14
        ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
        : '';

    const linhas = [
        ...linhasDaMemoria(p.resultado),
        ...linhasDosImpostos(p.resultado),
        ...linhasDosSaldos(saldos),
    ];

    const observacoes = [
        'PRÉVIA — os valores podem mudar até o fechamento da competência, por documento que ainda '
        + 'chegue ou por retificação.',
        'Este documento NÃO é guia de recolhimento: as guias são enviadas separadamente, com código '
        + 'de barras e vencimento.',
        `Regime: Lucro ${p.resultado.regime} · apuração ${p.resultado.periodo}.`,
    ];
    // A ressalva do saldo vai no CORPO do papel, não só na linha: é ela que
    // impede o cliente de ler o traço como "não tenho mais crédito".
    for (const i of saldos.itens) {
        if (i.situacao === 'nao-informado' && (i.anterior || 0) > 0) observacoes.push(i.texto);
    }
    const quando = p.emitidoEm || new Date();
    observacoes.push(
        `Emitido em ${quando.toLocaleDateString('pt-BR')}`
        + (p.emitidoPor ? ` por ${p.emitidoPor}` : '')
        + ' · SP Assessoria Contábil.',
    );

    return {
        titulo: 'Prévia de impostos',
        subtitulo: [`Competência ${comp}`, p.empresaNome, cnpjEscrito].filter(Boolean).join(' · '),
        colunas: [
            { titulo: 'Descrição', largura: 42 },
            { titulo: 'Valor', largura: 20, alinhamento: 'direita' },
            { titulo: 'Observação', largura: 38 },
        ],
        linhas,
        totais: ['TOTAL DE IMPOSTOS DO PERÍODO', brl(p.resultado.totalImpostos || 0), ''],
        observacoes,
        identificacao: p.identificacao,
        fileName: `previa-impostos-${cnpj || 'empresa'}-${String(p.competencia).replace('-', '')}.pdf`,
    };
}

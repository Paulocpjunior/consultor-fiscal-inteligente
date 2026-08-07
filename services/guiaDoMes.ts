/**
 * guiaDoMes.ts — o NORTE do colaborador durante o mês fiscal.
 *
 * Paulo, 07/08: a Carteira de Clientes "deve ser o guia, o norte do colaborador
 * durante o mês fiscal de acordo com as obrigações e vencimentos das empresas
 * que a ele respondem".
 *
 * A Rotina do mês já responde "onde este cliente está" — mas ela é uma tela de
 * carteira inteira, com cinco etapas por linha. O colaborador precisa da MESMA
 * verdade condensada: uma linha por cliente, com a cor certa, o prazo mais
 * apertado e a ÚNICA coisa que ele tem que fazer hoje.
 *
 * NENHUMA CONTA NOVA. Tudo aqui é derivado do payload da rotina
 * (`/api/admin/rotina-fiscal/painel`), que já é a fonte das cinco etapas, do
 * ISS e do prazo das obrigações. Painel com conta própria diverge sozinho e
 * ninguém percebe até um cliente pagar errado — é a lição do card 4, do
 * relatório e do ISS da carteira.
 *
 * A COR é a do farol da rotina, sem régua paralela:
 *   vermelho  alguma etapa PENDENTE, ou obrigação atrasada
 *   âmbar     etapa com ressalva (resumo sem completa, guia sem prova, ISS)
 *   verde     as cinco etapas fechadas
 *   cinza     sem dado nenhum — que NÃO é verde
 */
import type { RotinaEmpresa, EtapaRotina } from './rotinaFiscalService';
// @ts-expect-error — módulo .js puro (sem tipos)
import { URGENCIA_LABEL, URGENCIA_FAROL } from '../sefaz-backend/urgencia-vencimento.js';

export type CorGuia = 'vermelho' | 'ambar' | 'verde' | 'cinza';

export interface PrazoGuia {
    obrigacao: string;
    dias: number;
    urgencia: string;
    rotulo: string;
    cor: CorGuia;
}

export interface LinhaGuia {
    empresaId: string;
    nome: string;
    cnpj: string;
    regime: string | null;
    cor: CorGuia;
    /** Frase única: o que fazer agora. `null` = mês fechado. */
    proximoPasso: string | null;
    /** Onde se resolve (tela do app). */
    onde: string | null;
    progresso: string;
    /** Prazo mais apertado entre as obrigações ABERTAS. */
    prazo: PrazoGuia | null;
    atrasadas: number;
    /** Resumo de captura: "12 entradas · 4 saídas" ou o problema. */
    captura: string;
    /** Resumo das obrigações: "3/5 entregues". */
    obrigacoes: string;
    /** ISS de SP capital, quando houver pendência. `null` fora de SP capital. */
    iss: string | null;
    /** Etapas em ordem, para a trilha colorida. */
    etapas: { id: string; nome: string; status: string }[];
    /** Peso de ordenação — quanto menor, mais urgente. */
    peso: number;
}

export interface ResumoGuia {
    total: number;
    fechadas: number;
    vermelhas: number;
    ambares: number;
    atrasadas: number;
    /** Empresas com alguma obrigação vencendo em ≤7 dias. */
    naSemana: number;
    frase: string;
}

const PESO_COR: Record<CorGuia, number> = { vermelho: 0, ambar: 1, cinza: 2, verde: 3 };

const etapaDe = (r: RotinaEmpresa, id: string): EtapaRotina | undefined =>
    (r.etapas || []).find((e) => e.id === id);

/**
 * Cor de UMA empresa.
 *
 * Não é régua nova: usa o `farol` que a rotina já calcula. A única coisa que
 * ela agrava é a obrigação ATRASADA — porque atraso é a faixa em que o prazo
 * já foi perdido, e "âmbar" ali esconderia dinheiro com multa correndo.
 */
export function corDaEmpresa(r: RotinaEmpresa): CorGuia {
    if (!r?.etapas?.length) return 'cinza';
    const atrasadas = Number(etapaDe(r, 'obrigacoes')?.atrasadas || 0);
    if (atrasadas > 0) return 'vermelho';
    if (r.farol === 'pendente') return 'vermelho';
    if (r.farol === 'atencao') return 'ambar';
    return 'verde';
}

/** Uma empresa da rotina → uma linha do guia. */
export function montarLinhaGuia(r: RotinaEmpresa): LinhaGuia {
    const cor = corDaEmpresa(r);
    const captura = etapaDe(r, 'captura');
    const obrig = etapaDe(r, 'obrigacoes');

    const prazoBruto = obrig?.prazo || null;
    const prazo: PrazoGuia | null = prazoBruto?.urgencia
        ? {
            obrigacao: String(prazoBruto.obrigacao || '—'),
            dias: Number(prazoBruto.dias),
            urgencia: String(prazoBruto.urgencia),
            rotulo: URGENCIA_LABEL[prazoBruto.urgencia] || String(prazoBruto.urgencia),
            cor: (URGENCIA_FAROL[prazoBruto.urgencia] || 'cinza') as CorGuia,
        }
        : null;

    // A pendência de ISS é frase própria: são guias do MUNICÍPIO, que não
    // fecham no DAS nem no DARF, e some no meio das etapas se não aparecer.
    const pendenciasIss = r.iss?.pendencias || [];

    return {
        empresaId: r.empresa?.id || '',
        nome: r.empresa?.nome || '—',
        cnpj: r.empresa?.cnpj || '',
        regime: r.empresa?.regime || null,
        cor,
        proximoPasso: r.proximoPasso ? `${r.proximoPasso.nome}: ${r.proximoPasso.acao || r.proximoPasso.resumo}` : null,
        onde: r.proximoPasso?.onde || null,
        progresso: `${r.progresso?.concluidas ?? 0}/${r.progresso?.total ?? 5}`,
        prazo,
        atrasadas: Number(obrig?.atrasadas || 0),
        captura: captura?.resumo || 'Sem leitura de captura.',
        obrigacoes: obrig?.resumo || 'Sem obrigações lidas.',
        iss: pendenciasIss.length ? pendenciasIss.join(' · ') : null,
        etapas: (r.etapas || []).map((e) => ({ id: e.id, nome: e.nome, status: e.status })),
        peso: PESO_COR[cor],
    };
}

/**
 * O guia da carteira inteira, ordenado por quem precisa de atenção primeiro.
 *
 * Dentro da mesma cor, o desempate é o PRAZO — entre dois clientes vermelhos,
 * começa pelo que tem obrigação vencendo antes. Alfabético aqui seria uma
 * lista; o colaborador precisa de uma fila.
 */
export function montarGuiaDoMes(rotinas: RotinaEmpresa[] | undefined): { linhas: LinhaGuia[]; resumo: ResumoGuia } {
    const linhas = (rotinas || []).map(montarLinhaGuia);
    linhas.sort((a, b) => (a.peso - b.peso)
        || ((a.prazo?.dias ?? 9999) - (b.prazo?.dias ?? 9999))
        || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    return { linhas, resumo: resumirGuia(linhas) };
}

export function resumirGuia(linhas: LinhaGuia[]): ResumoGuia {
    const total = linhas.length;
    const fechadas = linhas.filter((l) => !l.proximoPasso).length;
    const vermelhas = linhas.filter((l) => l.cor === 'vermelho').length;
    const ambares = linhas.filter((l) => l.cor === 'ambar').length;
    const atrasadas = linhas.reduce((t, l) => t + l.atrasadas, 0);
    const naSemana = linhas.filter((l) => l.prazo && l.prazo.urgencia !== 'futura').length;

    // Carteira vazia não vira "tudo certo": é ausência de vínculo, e o
    // colaborador precisa saber disso em vez de ver uma tela verde vazia.
    const frase = total === 0
        ? 'Nenhuma empresa na sua carteira nesta competência — se isso está errado, peça ao admin para atribuir.'
        : `${fechadas} de ${total} cliente(s) com o mês fechado`
            + (atrasadas > 0 ? ` · ${atrasadas} obrigação(ões) ATRASADA(S)` : '')
            + (naSemana > 0 ? ` · ${naSemana} cliente(s) com vencimento nesta semana` : '')
            + '.';

    return { total, fechadas, vermelhas, ambares, atrasadas, naSemana, frase };
}

/** Linhas do guia → tabela do PDF (mesma casca de relatório das outras abas). */
export function guiaParaPdf(linhas: LinhaGuia[]): (string | number)[][] {
    return linhas.map((l) => [
        l.nome,
        l.regime === 'simples' ? 'Simples' : 'Lucro',
        l.cor === 'verde' ? 'FECHADO' : l.cor === 'vermelho' ? 'ATENÇÃO' : l.cor === 'ambar' ? 'RESSALVA' : 'SEM DADO',
        l.progresso,
        l.prazo ? `${l.prazo.obrigacao} — ${l.prazo.rotulo}` : (l.atrasadas ? `${l.atrasadas} atrasada(s)` : '—'),
        l.obrigacoes,
        l.captura,
        l.proximoPasso || 'Mês fechado',
    ]);
}

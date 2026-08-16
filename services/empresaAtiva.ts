/**
 * services/empresaAtiva.ts — A EMPRESA ATIVA DA SESSÃO.
 *
 * Paulo, 15/08, corrigindo o que eu tinha entendido errado:
 *
 *   *"o começo de tudo é com a SEQUÊNCIA: login colaborador → ATIVAR EMPRESA.
 *   Ativar empresa é o que determina o que a pessoa vai ou não fazer, é o que
 *   determina o que ela pode ou não fazer."*
 *
 * ═══ O QUE EU TINHA ENTENDIDO ERRADO ════════════════════════════════════════
 *
 * Eu li "não carregamos nada até ativar" como **carga preguiçosa de cada
 * painel** e implementei isso duas vezes (Simples e Lucro): cada tela com o seu
 * ⚡ Ativar, cada uma com o seu seletor. Ganhou velocidade e não entregou o que
 * importa — porque a frase não é sobre CARGA, é sobre **ESCOPO**.
 *
 * A empresa ativa não é um filtro de tela. É o estado da SESSÃO: depois do
 * login, o colaborador ativa UMA empresa, e é ela que define em que cliente ele
 * está trabalhando enquanto não trocar. Sem isso, cada módulo pergunta de novo
 * "qual empresa?" — e é aí que alguém apura o mês do cliente A na tela do B.
 *
 * ═══ AS TRÊS REGRAS QUE ESTE MÓDULO CARREGA ═════════════════════════════════
 *
 * 1. **Módulo que trabalha SOBRE um cliente exige empresa ativa.** Consulta de
 *    tabela (CFOP, NCM, código de serviço, Reforma, simulador) NÃO exige: elas
 *    não têm cliente, e trancá-las seria trava sem motivo — do tipo que a
 *    equipe aprende a contornar. A separação é EXPLÍCITA aqui, não espalhada.
 *
 * 2. **Trocar de empresa LIMPA o que estava carregado.** Dado de um cliente na
 *    tela de outro é o pior erro possível neste app, e ele é silencioso.
 *
 * 3. **Sair LIMPA a ativação.** A sequência começa no login: quem entra amanhã
 *    ativa de novo, de propósito. Recarregar a página (F5) NÃO desativa —
 *    punir o F5 não protege ninguém.
 */
import { SearchType } from '../types';

export interface EmpresaAtiva {
    id: string;
    nome: string;
    cnpj: string;
    fonte: 'simples' | 'lucro';
    codCliente?: string;
    uf?: string;
    /** Quem ativou e quando — a sessão é de uma pessoa, e isso aparece na tela. */
    ativadaPor?: string;
    ativadaEm?: number;
}

const CHAVE = 'cfi_empresa_ativa';

/**
 * Módulos que NÃO exigem empresa ativa: consulta de tabela e visões de
 * CARTEIRA (que são sobre o conjunto, não sobre um cliente).
 *
 * Lista EXPLÍCITA e curta — o padrão é EXIGIR. Card novo nasce exigindo, que é
 * o lado seguro: esquecer de incluir aqui trava um card (visível na hora);
 * esquecer o contrário deixa um módulo trabalhar sem cliente definido, que é
 * invisível até alguém lançar no lugar errado.
 */
export const DISPENSAM_EMPRESA_ATIVA: SearchType[] = [
    // Consultas de tabela — não têm cliente.
    SearchType.CFOP,
    SearchType.NCM,
    SearchType.SERVICO,
    SearchType.REFORMA_TRIBUTARIA,
    SearchType.SIMULADOR_IBS_CBS,
    // Visões da CARTEIRA — respondem sobre o conjunto de clientes.
    SearchType.ROTINA_FISCAL,
    SearchType.CARTEIRA,
    SearchType.SP_CONNECT,   // inbox do WhatsApp — as conversas são da carteira toda
    SearchType.DASHBOARD_CEO,
    SearchType.SAUDE_GERAL,
    SearchType.OBRIGACOES_FISCAIS,
];

/** Este módulo precisa de uma empresa ativa para fazer sentido? */
export function exigeEmpresaAtiva(tipo: SearchType): boolean {
    return !DISPENSAM_EMPRESA_ATIVA.includes(tipo);
}

/** Chave por usuário: a ativação é da PESSOA, não do navegador. */
function chaveDe(uid: string): string {
    return `${CHAVE}:${uid}`;
}

export function lerEmpresaAtiva(uid: string | null | undefined): EmpresaAtiva | null {
    if (!uid) return null;
    try {
        const bruto = localStorage.getItem(chaveDe(uid));
        if (!bruto) return null;
        const e = JSON.parse(bruto) as EmpresaAtiva;
        // Registro torto no armazenamento não pode travar o app nem, pior,
        // fazer um módulo trabalhar com empresa sem id.
        return e && e.id && e.nome ? e : null;
    } catch { return null; }
}

export function gravarEmpresaAtiva(uid: string, e: EmpresaAtiva): void {
    try { localStorage.setItem(chaveDe(uid), JSON.stringify(e)); } catch { /* modo anônimo */ }
}

export function limparEmpresaAtiva(uid: string | null | undefined): void {
    if (!uid) return;
    try { localStorage.removeItem(chaveDe(uid)); } catch { /* idem */ }
}

/** Rótulo curto para o cabeçalho: é ele que diz em quem a pessoa está mexendo. */
export function rotuloEmpresaAtiva(e: EmpresaAtiva | null): string {
    if (!e) return 'Nenhuma empresa ativa';
    const cod = e.codCliente ? `${e.codCliente} · ` : '';
    return `${cod}${e.nome}`;
}

export function fmtCnpjAtiva(cnpj: string | undefined): string {
    const d = String(cnpj || '').replace(/\D/g, '');
    if (d.length !== 14) return d || '—';
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

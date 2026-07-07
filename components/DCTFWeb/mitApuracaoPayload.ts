/**
 * components/DCTFWeb/mitApuracaoPayload.ts (PURO — testável em jest)
 *
 * Análise do payload da apuração MIT retornado pelo SERPRO
 * (CONSAPURACAO316) para decidir se o encerramento (ENCAPURACAO314) pode
 * ser transmitido — e, quando não pode, explicar o PORQUÊ em português.
 *
 * Caso real (55070577000161 · 06/2026, 07/07/2026): apuração criada no
 * e-CAC ainda em edição volta com `Debitos` presente porém VAZIO. O guard
 * antigo checava só a existência da chave, o clique ia ao SERPRO e voltava
 * 400 [EntradaIncorreta-MIT-MSG_0003] "Debitos: deve ser informado ao
 * menos um débito" — críptico para o usuário. Agora o botão é bloqueado
 * antes, com a orientação do que fazer no e-CAC.
 */

export function pickDadosApuracaoMit(input: any): any | null {
    if (!input || typeof input !== 'object') return null;
    if (input.PeriodoApuracao) return input;
    const direct = input.dadosApuracaoMit ?? input.dadosApuracaoMIT ?? input.DadosApuracaoMit ?? input.DadosApuracaoMIT;
    if (Array.isArray(direct)) return direct[0] || null;
    if (direct && typeof direct === 'object') return direct;
    const nested = input.apuracaoMit ?? input.apuracao ?? input.dados;
    return nested && nested !== input ? pickDadosApuracaoMit(nested) : null;
}

/**
 * Conta débitos reais no bloco `Debitos` do MIT. Shape oficial:
 * { Irpj: { ListaDebitos: [...] }, Csll: {...}, ... } — grupos com listas.
 * Aceita também array direto (shapes defensivos, como no normalizador).
 */
export function contarDebitosMit(debitos: any): number {
    if (!debitos) return 0;
    if (Array.isArray(debitos)) return debitos.filter((d) => d && typeof d === 'object').length;
    if (typeof debitos !== 'object') return 0;
    let total = 0;
    for (const valor of Object.values(debitos)) {
        if (Array.isArray(valor)) total += valor.filter((d) => d && typeof d === 'object').length;
        else if (valor && typeof valor === 'object') total += contarDebitosMit(valor);
    }
    return total;
}

export interface AnaliseEncerramentoMit {
    /** true = payload apto a ser transmitido no ENCAPURACAO314 */
    completa: boolean;
    /** Explicação em português quando `completa === false` */
    motivo: string | null;
    /** Quantos débitos reais o payload contém */
    totalDebitos: number;
}

export function analisarApuracaoMitParaEncerramento(input: any): AnaliseEncerramentoMit {
    const payload = pickDadosApuracaoMit(input);
    if (!payload) {
        return {
            completa: false,
            totalDebitos: 0,
            motivo: null, // sem payload o chamador já tem mensagem própria ("nenhuma apuração encontrada")
        };
    }
    const dadosIniciais = payload.DadosIniciais || payload.dadosIniciais;
    if (!dadosIniciais) {
        return {
            completa: false,
            totalDebitos: 0,
            motivo: 'A apuração MIT foi encontrada, mas o SERPRO não retornou os DadosIniciais completos para retransmissão.',
        };
    }
    const semMovimento = dadosIniciais.SemMovimento ?? dadosIniciais.semMovimento;
    if (semMovimento === true || semMovimento === 'true') {
        return { completa: true, totalDebitos: 0, motivo: null };
    }
    const totalDebitos = contarDebitosMit(payload.Debitos || payload.debitos);
    if (totalDebitos === 0) {
        return {
            completa: false,
            totalDebitos: 0,
            motivo: 'A apuração MIT desta competência existe mas está SEM débitos lançados (em edição). '
                + 'Lance os débitos (IRPJ/CSLL/PIS/COFINS) no MIT do e-CAC — ou marque "Sem Movimento" se for o caso — '
                + 'e clique em "Atualizar MIT" para encerrar por aqui.',
        };
    }
    return { completa: true, totalDebitos, motivo: null };
}

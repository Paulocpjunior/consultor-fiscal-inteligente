/**
 * nfsePdfValores.ts — os valores lidos do PDF fazem sentido entre si? (PURO)
 *
 * 🚨 O CASO (08/09, LEGACY 0360, NFS-e 41943): o leitor devolveu **Valor dos
 * serviços 0,00 · Base de cálculo 1,74 · ISS 1,74 · Desconto incondicional
 * 60,00 · Desconto condicional 60,00 · Valor líquido 60,00** — e o modal
 * ofereceu "Confirmar e salvar (R$ 60,00)". Os números não se sustentam
 * (base menor que o próprio ISS; desconto igual ao líquido; serviço zero numa
 * nota que tem líquido), mas nada acendia, e a nota entrou no livro valendo
 * ZERO de serviço.
 *
 * 📌 O leitor por rótulo erra em leiaute que ele não conhece — isso é fato de
 * parser e se calibra com o PDF na mão. O que NÃO pode é o erro passar CALADO
 * pela tela de conferência: ela existe justamente para a pessoa olhar o papel.
 * Por isso aqui só se BLOQUEIA o que não se escritura de jeito nenhum (serviço
 * zero com líquido positivo — família do `VL_ITEM` zero, 20/08) e se DIZ o
 * resto. Zero digitado de propósito continua sendo resposta quando o líquido
 * também é zero.
 */

export interface ConferenciaValoresPdf {
    /** Não dá para salvar assim — o motivo diz o que digitar do papel. */
    bloquear: boolean;
    motivo: string | null;
    /** Sinais de leitura torta que a pessoa confere antes de confirmar. */
    avisos: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

export function conferirValoresDaNfsePdf(v: {
    valorServicos?: unknown;
    baseCalculo?: unknown;
    valorIss?: unknown;
    valorDescIncondicional?: unknown;
    valorDescCondicional?: unknown;
    valorLiquido?: unknown;
}): ConferenciaValoresPdf {
    const servicos = r2(num(v.valorServicos));
    const base = r2(num(v.baseCalculo));
    const iss = r2(num(v.valorIss));
    const descI = r2(num(v.valorDescIncondicional));
    const descC = r2(num(v.valorDescCondicional));
    const liquido = r2(num(v.valorLiquido));
    const avisos: string[] = [];

    if (servicos <= 0 && liquido > 0) {
        return {
            bloquear: true,
            motivo: `O valor dos SERVIÇOS está 0,00 e o líquido é ${liquido.toFixed(2)} — o leitor não achou o campo `
                + 'neste leiaute de PDF. Nota de serviço sem valor de serviço não se escritura (entraria no livro, '
                + 'no SPED e no R-4020 valendo zero): digite o "Valor do serviço" que está no papel e confira '
                + 'base, ISS e descontos.',
            avisos,
        };
    }
    if (servicos > 0 && base > servicos) {
        avisos.push(`Base de cálculo (${base.toFixed(2)}) maior que o valor dos serviços (${servicos.toFixed(2)}) — confira os dois no papel.`);
    }
    if (base > 0 && iss > base) {
        avisos.push(`ISS (${iss.toFixed(2)}) maior que a base (${base.toFixed(2)}) — o leitor pode ter trocado as colunas.`);
    }
    if (servicos > 0 && (descI >= servicos || descC >= servicos)) {
        avisos.push('Desconto igual ou maior que o valor dos serviços — quase sempre é coluna lida no lugar errado.');
    }
    if (servicos > 0 && liquido > 0 && liquido > servicos + 0.01) {
        avisos.push(`Líquido (${liquido.toFixed(2)}) maior que o valor dos serviços (${servicos.toFixed(2)}).`);
    }
    return { bloquear: false, motivo: null, avisos };
}

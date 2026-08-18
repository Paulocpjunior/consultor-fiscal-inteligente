// ============================================================================
// sefaz-backend/cfop-catalogo.js  (PURO — testável)
// ----------------------------------------------------------------------------
// A DESCRIÇÃO OFICIAL DO CFOP — e, principalmente, DIZER quando ela não está
// cadastrada em vez de deixar o número sozinho na tela.
//
// ═══ POR QUE EXISTE (Paulo, 17/08) ══════════════════════════════════════════
//
// *"A nossa base de consulta está desatualizada, mas veja uma incongruência: o
// próprio CFI publica o link do CONFAZ com todos os CFOPs atualizados, inclusive
// o 1556, que se trata de compra de material para uso/consumo."*
//
// Ele estava certo: o app CITAVA a tabela oficial como fonte e tinha **duas**
// descrições gravadas (1924 e 5106), dentro do geminiService. Número sem
// descrição na tela é o que faz alguém aceitar `1101` numa nota da Kalunga.
//
// ═══ O CASO QUE MOSTRA POR QUE A DESCRIÇÃO IMPORTA ══════════════════════════
//
// Ainda dele, no mesmo dia: *"uma indústria compra da Kalunga material de
// escritório. A indústria não usa essa nota de entrada para industrialização
// nem comercialização — ela usa para material de escritório, uso ou consumo,
// ou compra de ativo (computadores, notebooks)."*
//
// Ou seja: **o RAMO é o default, não a verdade da nota.** A régua automática
// escreve `1101` para toda compra de indústria; naquela nota o certo é `1556`
// (uso/consumo) ou `1551` (ativo imobilizado). O XML NÃO carrega esse destino —
// a Kalunga emite `5102` porque para ELA é revenda —, então o app não tem como
// saber, e a correção é o campo por NF. O que a tela pode fazer é mostrar a
// DESCRIÇÃO do que ela escreveu, para o erro ficar óbvio antes de virar livro.
//
// ═══ REGRA DE CADASTRO ══════════════════════════════════════════════════════
//
// 🚨 **Entrada nova só entra COPIADA da tabela oficial**, nunca escrita de
// memória — descrição errada na tela é pior que descrição nenhuma, porque ela
// faz a pessoa escolher com confiança o CFOP errado. É a mesma regra dos
// códigos de receita do FUNRURAL ("entra com o recibo do lado") e do id da
// qualificação do PGDAS ("veio do formulário, não de dedução").
//
// A tabela oficial é bloqueada pela rede deste ambiente (mesma trava da doc do
// SERPRO e do manual da Receita), então o preenchimento vem por colagem humana.
// ============================================================================

/** A fonte — vai junto da descrição em toda tela que a mostrar. */
export const FONTE_CFOP = {
    titulo: 'CONFAZ — Tabela CFOP vigente (Ajuste SINIEF)',
    url: 'https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/copy_of_cfop_cvsn_70_nova',
};

/**
 * Descrições CONFERIDAS contra a tabela oficial.
 *
 * ⚠️ Está propositalmente PEQUENO. O que falta se preenche colando a tabela do
 * CONFAZ — não escrevendo de cabeça. `descricaoCfop` devolve null para o que
 * não está aqui, e a tela DIZ isso com o link ao lado.
 */
export const CFOP_DESCRICOES = {
    '1924': 'Entrada para industrialização por conta e ordem do adquirente da mercadoria, quando esta não transitar pelo estabelecimento do adquirente.',
    '5106': 'Venda de mercadoria adquirida ou recebida de terceiros, que não deva por ele transitar. Classificam-se neste código as vendas de mercadorias adquiridas ou recebidas de terceiros para industrialização ou comercialização, armazenadas em depósito fechado, armazém geral ou outro, que não tenham sido objeto de qualquer processo industrial no estabelecimento sem que haja retorno ao estabelecimento depositante. Também se aplica às vendas de mercadorias importadas cuja saída ocorra do recinto alfandegado ou repartição alfandegária onde se processou o desembaraço aduaneiro, com destino ao comprador, sem transitar pelo estabelecimento do importador.',
};

const so = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * A descrição oficial do CFOP, ou **null** quando não está cadastrada.
 *
 * Null é de propósito: quem chama precisa distinguir "não temos a descrição"
 * de "a descrição é esta". Devolver uma frase genérica como se fosse descrição
 * faria a tela parecer completa quando ela não está.
 */
export function descricaoCfop(codigo) {
    const c = so(codigo);
    if (c.length !== 4) return null;
    return CFOP_DESCRICOES[c] || null;
}

/** Quantos códigos o catálogo conhece — é o número que denuncia a lacuna. */
export function tamanhoDoCatalogo() {
    return Object.keys(CFOP_DESCRICOES).length;
}

/**
 * A frase para a tela: a descrição quando existe, e a lacuna NOMEADA quando não.
 * Nunca inventa — e nunca finge que o catálogo está completo.
 */
export function textoDoCfop(codigo) {
    const c = so(codigo);
    if (c.length !== 4) return { temDescricao: false, texto: 'CFOP inválido — são 4 dígitos.', fonte: null };
    const d = descricaoCfop(c);
    if (d) return { temDescricao: true, texto: d, fonte: FONTE_CFOP };
    return {
        temDescricao: false,
        texto: `Descrição do ${c} ainda não cadastrada no CFI — confira na tabela oficial antes de usar.`,
        fonte: FONTE_CFOP,
    };
}

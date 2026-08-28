// ============================================================================
// sefaz-backend/lucro-empresas-resumo.js  (ESM, puro)
// ----------------------------------------------------------------------------
// A LISTA DE EMPRESAS DO LUCRO SEM A FICHA FINANCEIRA.
//
// Paulo, 14/08, definindo o comportamento do app: *"Ativar Empresa é o primeiro
// passo do colaborador, é isso que define o que ele pode ou não fazer e em qual
// empresa; além disso NÃO CARREGAMOS NENHUMA INFORMAÇÃO DO BANCO DE DADOS até
// que o colaborador ative a empresa — ganhamos tempo e agilidade"*.
//
// ═══ POR QUE ESTA ROTA PRECISA EXISTIR ══════════════════════════════════════
//
// No Simples bastou parar de ler `simples_notas`: o movimento morava em OUTRA
// coleção, e cortar a leitura resolveu. Aqui não dá para fazer o mesmo, porque
// a `fichaFinanceira[]` é **EMBUTIDA no documento da empresa** — um array com
// um registro de ~46 campos POR MÊS. Abrir o painel do Lucro baixava, de todas
// as empresas de uma vez, todos os meses já lançados.
//
// E o SDK do Firestore no navegador **não projeta campos**: `getDocs` traz o
// documento inteiro, sempre. Não existe jeito de pedir "só o cadastro" do lado
// do cliente — por isso a lista leve tem que sair do BACKEND, onde o Admin SDK
// tem `.select()`.
//
// ═══ O QUE ESTE MÓDULO NÃO FAZ ══════════════════════════════════════════════
//
// Não filtra empresa com cadastro torto. Sumir do seletor faz o colaborador
// concluir que a empresa não existe (regra de 07/08, `empresaOption`); cadastro
// incompleto é alerta na tela de cadastro, não invisibilidade.
//
// Lápide, sim: `_deleted` e `_merged_into` continuam fora — é o caso WALDESA
// (24/07), em que empresa excluída ressuscitava.
// ============================================================================

import { regimeDaEmpresa, rotuloRegime } from './regime-tributario.js';

/** Campos do CADASTRO — o que a lista precisa para a pessoa escolher. */
export const CAMPOS_RESUMO = [
    'nome',
    'razaoSocial',
    'cnpj',
    'uf',
    'regimePadrao',
    'codCliente',
    'dadosFiscais',
    'capturarSefaz',
    '_deleted',
    '_merged_into',
    // ⚠️ A ficha VEM, mas só para virar CONTAGEM — ela não sai daqui.
    //
    // Não é desperdício nem descuido: o selo de duplicata da lista diz
    // **"0 fichas — excluir este"** × **"N ficha(s) — manter"**, e é com ele
    // que alguém decide QUAL CADASTRO APAGAR. Um `0` que na verdade significa
    // "não carreguei" mandaria excluir justamente o cadastro bom — e exclusão
    // de empresa com ficha financeira não tem volta fácil.
    //
    // O peso que este trabalho tira é o do NAVEGADOR: o backend lê o array
    // aqui dentro (rede interna, e a cobrança do Firestore é por DOCUMENTO
    // lido, não por byte) e manda um número. Quem estava lento era a tela.
    'fichaFinanceira',
];

const texto = (v) => (v === null || v === undefined ? '' : String(v));
const soDigitos = (v) => texto(v).replace(/\D/g, '');

/**
 * Empresa está escondida do app? Lápide de exclusão ou de fusão.
 *
 * As duas somem da lista, mas por motivos diferentes — e é por isso que a
 * contagem separa: lista que encolhe sem dizer por quê faz alguém procurar
 * cadastro que foi excluído de propósito.
 */
export function lapideDaEmpresa(d) {
    if (!d) return null;
    if (d._deleted) return 'excluida';
    if (d._merged_into) return 'fundida';
    return null;
}

/**
 * Monta a lista LEVE a partir dos documentos crus.
 *
 * `codCliente` mora em dois lugares no cadastro (topo legado e `dadosFiscais`)
 * — a mesma armadilha que o `empresaOption` resolveu no frontend. Ler só um
 * faz metade da carteira aparecer sem código, e o colaborador busca por código.
 *
 * @param {Array<{id: string, data: object}>} docs
 */
export function montarResumoLucro(docs = []) {
    const empresas = [];
    let excluidas = 0;
    let fundidas = 0;

    for (const doc of docs) {
        if (!doc) continue;
        const d = doc.data || {};
        const lapide = lapideDaEmpresa(d);
        if (lapide === 'excluida') { excluidas += 1; continue; }
        if (lapide === 'fundida') { fundidas += 1; continue; }

        empresas.push({
            id: doc.id,
            nome: texto(d.nome || d.razaoSocial) || null,
            cnpj: soDigitos(d.cnpj) || null,
            uf: texto(d.uf).toUpperCase() || null,
            regimePadrao: d.regimePadrao || null,
            // 🚨 A COLUNA ESCREVIA "Presumido" SOBRE UMA COMUNIDADE IMUNE
            // (28/08, Paulo, print da COMUNIDADE EVANGELICA DE PASSOS): a lista
            // fazia `regimePadrao || 'Presumido'` — quando o campo antigo está
            // vazio, a TELA AFIRMAVA um regime que ninguém escolheu. E ele
            // tinha marcado IMUNE no modal, que grava `regimeTributario`: a
            // armadilha das duas formas, com a tela lendo a forma velha.
            //
            // Quem responde é o DONO, com a precedência da casa (cadastro >
            // regimePadrao > coleção). `regimePadrao` continua saindo porque
            // outros leitores o usam — o que muda é QUEM a tela mostra.
            regime: (() => {
                const r = regimeDaEmpresa({ ...d, colecao: 'lucro_empresas' });
                return {
                    codigo: r.regime,
                    rotulo: rotuloRegime(r.regime),
                    origem: r.origem,
                    apuracaoDefinida: r.apuracaoDefinida,
                };
            })(),
            codCliente: texto(d.codCliente ?? d.dadosFiscais?.codCliente) || null,
            // Só a CONTAGEM. É ela que o selo de duplicata usa para dizer qual
            // cadastro manter — o array em si fica no servidor.
            fichas: Array.isArray(d.fichaFinanceira) ? d.fichaFinanceira.length : 0,
            capturarSefaz: d.capturarSefaz !== false,
        });
    }

    empresas.sort((a, b) => texto(a.nome).localeCompare(texto(b.nome), 'pt-BR'));

    return {
        empresas,
        total: empresas.length,
        // Some da CONTA, não da TELA: a lista não mostra lápide, mas DIZ quantas
        // ficaram de fora. Total que encolhe sozinho faz desconfiar do número.
        ocultas: { excluidas, fundidas },
        // O contrato explícito: quem consome sabe que NÃO recebeu a ficha, e
        // por isso não pode gravar de volta a partir daqui.
        semFichaFinanceira: true,
    };
}

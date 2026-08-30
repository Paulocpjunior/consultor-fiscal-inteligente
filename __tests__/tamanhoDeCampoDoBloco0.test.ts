// ============================================================================
// 🚨 NENHUM CAMPO DO BLOCO 0 PASSA DO TAMANHO DO LEIAUTE
//
// 29/08, fechando o último registro descoberto do cruzamento (o 0005). O Guia
// 3.2.3 não dá NENHUMA "Validação:" ao 0005 — só tamanhos e obrigatoriedade —,
// e foi lendo a TABELA que apareceu o defeito:
//
// 🔴 o **FANTASIA** era cortado em **100** e o leiaute dá **060**. Medido com
// uma razão social real de 91 caracteres: o campo saía com 91 num campo de 60,
// que é a recusa *"Tamanho do campo inválido"* — a família do `COD_ENQ 318,68`
// da PWR (20/08).
//
// 📌 E A TRAVA DE CONTAGEM NÃO VÊ ISSO. `conferirContagemDeCampos` (18/08)
// conta CAMPOS, e aqui a contagem está certa: o que estoura é o TAMANHO de um
// deles. É a mesma cegueira que deixou o M210 da MANTOAN passar com as casas
// trocadas — contagem certa, conteúdo errado.
//
// 📌 A TRAVA É SOBRE A SAÍDA, não sobre o código: ela gera o bloco com valores
// LONGOS em todo campo de texto e mede o que sai. Varredura de `sanitizeString(
// x, N)` no fonte provaria que a constante está certa; esta prova que o
// ARQUIVO está — e é o arquivo que o PVA lê (a lição do C100 com modelo 55 e
// chave 65, que passou meses porque a conferência auditava a intenção).
//
// ⚠️ Os tamanhos vêm COPIADOS da tabela do Guia, registro a registro — nunca
// deduzidos do vizinho. O 0000 dá **100** ao NOME e o 0005 dá **060** ao
// FANTASIA: são campos diferentes, em registros diferentes, e foi justamente
// carregar um para o outro que produziu o defeito.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBloco0 } from '../sefaz-backend/sped-fiscal-bloco0.js';
import { conferirTamanhoDeCamposFiscal } from '../sefaz-backend/sped-fiscal-campos.js';

/**
 * ⚠️ **A TABELA À MÃO SAIU DAQUI (30/08), e o motivo é que ela tinha ERROS.**
 *
 * Quando a coluna *Tam* do Guia passou a ser extraída, a prova cruzada contra
 * a leitura à mão deu **49 de 52** — e os TRÊS que divergiam eram da minha
 * leitura, confirmados campo a campo na fonte:
 *
 *   · `0150.02 COD_PART`     — eu li 100, o Guia dá **060**
 *   · `0200.05 COD_ANT_ITEM` — eu li 6,   o Guia dá **060**
 *   · `0200.11 COD_LST`      — eu li 6,   o Guia dá **005**
 *
 * Os dois primeiros deixariam passar (ou acusariam) campo CERTO; o terceiro
 * deixaria passar um COD_LST que o PVA recusa. Tabela copiada à mão é a
 * segunda cópia que esta casa mais paga — quem responde agora é o Guia.
 */
/** Texto longo o bastante para estourar qualquer campo do bloco 0. */
const LONGO = 'A'.repeat(140);
const LONGO_NUM = '9'.repeat(30);

const dadosLongos = () => ({
    empresa: {
        cnpj: '11111111000191',
        nome: LONGO,
        nomeFantasia: LONGO,
        dadosFiscais: {
            uf: 'SP', inscricaoEstadual: LONGO_NUM, codMunIBGE: LONGO_NUM,
            codSuframa: LONGO_NUM, cep: LONGO_NUM, logradouro: LONGO, numero: LONGO,
            complemento: LONGO, bairro: LONGO, telefone: LONGO_NUM, email: LONGO,
            contadorNome: LONGO, contadorCpf: '39053344705', contadorCrc: LONGO,
        },
    },
    competenciaInicio: '2026-07',
    competenciaFim: '2026-07',
    participantes: [{
        codPart: LONGO_NUM, nome: LONGO, cnpj: '22222222000191', codMunIBGE: LONGO_NUM,
        logradouro: LONGO, numero: LONGO, complemento: LONGO, bairro: LONGO,
        inscricaoEstadual: LONGO_NUM,
    }],
    unidades: [{ unidade: LONGO, descricao: LONGO }],
    itens: [{
        codItem: LONGO, descricao: LONGO, codBarra: LONGO_NUM, ncm: LONGO_NUM,
        codLst: LONGO, cest: LONGO_NUM, unidade: LONGO,
    }],
    ciap: {
        bens: [{
            codigo: LONGO, descricao: LONGO, tipo: 'bem',
            codigoBemPrincipal: LONGO, contaContabil: LONGO,
        }],
    },
    warnings: [] as string[],
});

describe('🚨 nenhum campo do bloco 0 passa do tamanho do leiaute', () => {
    const linhas: string[] = buildBloco0(dadosLongos()).map((l: string) => l.replace(/\r?\n$/, ''));

    it('a geração produziu os registros que a tabela cobre', () => {
        // Guarda contra o silêncio falso: sem linhas o teste passaria verde
        // sem medir nada.
        for (const reg of ['0000', '0005', '0100', '0150', '0190', '0200', '0300']) {
            expect({ reg, tem: linhas.some((l) => l.startsWith(`|${reg}|`)) })
                .toEqual({ reg, tem: true });
        }
    });

    it('todo campo cabe no tamanho que o Guia dá', () => {
        const r = conferirTamanhoDeCamposFiscal(linhas);
        if (!r.ok) {
            throw new Error(
                '\n\n🚧 CAMPO MAIOR QUE O LEIAUTE\n\n'
                + r.erros.map((e: { mensagem: string }) => `  · ${e.mensagem}`).join('\n')
                + '\n\nA trava de CONTAGEM não vê isto — ela conta CAMPOS, e aqui a contagem está\n'
                + 'certa: o que estoura é o TAMANHO.\n\n'
                + 'Caso real: o FANTASIA do 0005 cortava em 100 e o leiaute dá 060 — o 0000 é que\n'
                + 'tem NOME de 100. Campos diferentes, registros diferentes.\n',
            );
        }
    });

    // 🚨 O caso que abriu a classe, travado pelo número.
    it('o FANTASIA do 0005 cabe em 60 — e o NOME do 0000 continua com 100', () => {
        const f0005 = linhas.find((l) => l.startsWith('|0005|'))!.split('|');
        const f0000 = linhas.find((l) => l.startsWith('|0000|'))!.split('|');
        expect(f0005[2].length).toBe(60);
        expect(f0000[6].length).toBe(100);
    });
});

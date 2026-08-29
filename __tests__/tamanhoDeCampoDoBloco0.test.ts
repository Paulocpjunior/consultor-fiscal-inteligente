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

/**
 * Tamanho máximo por campo, do Guia Prático 3.2.3.
 * Chave: `REG.POSIÇÃO` (a posição do leiaute, com o REG sendo 01).
 * Campo de tamanho livre ("-" na tabela) fica de fora.
 */
const TAMANHO_DO_GUIA: Record<string, number> = {
    // 0000 — Abertura
    // 🐛 A 1ª versão desta tabela pulou o **UF** (campo 09) e deslocou IE,
    // COD_MUN e SUFRAMA em uma casa — a MESMA armadilha que o teste existe
    // para pegar, agora na minha própria leitura. Quem respondeu foi rodar o
    // gerador e contar a linha que sai.
    '0000.06': 100,  // NOME
    '0000.09': 2,    // UF
    '0000.10': 14,   // IE
    '0000.11': 7,    // COD_MUN
    '0000.13': 9,    // SUFRAMA
    // 0005 — Dados complementares  ⚠️ FANTASIA é 060, NÃO os 100 do 0000
    '0005.02': 60,   // FANTASIA
    '0005.03': 8,    // CEP
    '0005.04': 60,   // END
    '0005.05': 10,   // NUM
    '0005.06': 60,   // COMPL
    '0005.07': 60,   // BAIRRO
    '0005.08': 11,   // FONE
    '0005.09': 11,   // FAX
    // 0100 — Contabilista
    '0100.02': 100,  // NOME
    '0100.03': 11,   // CPF
    '0100.04': 15,   // CRC
    '0100.05': 14,   // CNPJ
    '0100.06': 8,    // CEP
    '0100.07': 60,   // END
    '0100.08': 10,   // NUM
    '0100.09': 60,   // COMPL
    '0100.10': 60,   // BAIRRO
    '0100.11': 11,   // FONE
    '0100.12': 11,   // FAX
    '0100.14': 7,    // COD_MUN
    // 0150 — Participantes
    '0150.02': 100,  // COD_PART
    '0150.03': 100,  // NOME
    '0150.04': 5,    // COD_PAIS
    '0150.05': 14,   // CNPJ
    '0150.06': 11,   // CPF
    '0150.07': 14,   // IE
    '0150.08': 7,    // COD_MUN
    '0150.09': 9,    // SUFRAMA
    '0150.10': 60,   // END
    '0150.11': 10,   // NUM
    '0150.12': 60,   // COMPL
    '0150.13': 60,   // BAIRRO
    // 0190 — Unidades
    '0190.02': 6,    // UNID
    // 0200 — Itens
    // 🐛 E aqui a mesma coisa: faltavam o **UNID_INV** (06) e o **ALIQ_ICMS**
    // (12), o que jogava TIPO_ITEM, COD_NCM e EX_IPI para a casa do vizinho.
    '0200.02': 60,   // COD_ITEM
    '0200.05': 6,    // COD_ANT_ITEM
    '0200.06': 6,    // UNID_INV
    '0200.07': 2,    // TIPO_ITEM
    '0200.08': 8,    // COD_NCM
    '0200.09': 3,    // EX_IPI
    '0200.10': 2,    // COD_GEN
    '0200.11': 6,    // COD_LST
    '0200.13': 7,    // CEST
    // 0300 — Bens do CIAP
    '0300.02': 60,   // COD_IND_BEM
    '0300.03': 1,    // IDENT_MERC
    '0300.05': 60,   // COD_PRNC
    '0300.06': 60,   // COD_CTA
    '0300.07': 3,    // NR_PARC
};

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
        const estouros: string[] = [];
        for (const linha of linhas) {
            const c = linha.split('|');
            const reg = c[1];
            c.forEach((valor, i) => {
                // c[0] é '' (o pipe inicial) e c[1] é o REG (campo 01).
                if (i < 2) return;
                const max = TAMANHO_DO_GUIA[`${reg}.${String(i).padStart(2, '0')}`];
                if (!max) return;
                if (valor.length > max) {
                    estouros.push(`${reg} campo ${String(i).padStart(2, '0')}: `
                        + `${valor.length} caracteres onde o leiaute dá ${max}`);
                }
            });
        }
        if (estouros.length) {
            throw new Error(
                '\n\n🚧 CAMPO MAIOR QUE O LEIAUTE\n\n'
                + estouros.map((x) => `  · ${x}`).join('\n')
                + '\n\nO PVA recusa com "Tamanho do campo inválido". A trava de CONTAGEM não vê isto —\n'
                + 'ela conta CAMPOS, e aqui a contagem está certa: o que estoura é o TAMANHO.\n\n'
                + 'Caso real: o FANTASIA do 0005 cortava em 100 e o leiaute dá 060 — o 0000 é que\n'
                + 'tem NOME de 100. Campos diferentes, registros diferentes: o tamanho se copia da\n'
                + 'tabela do PRÓPRIO registro, nunca do vizinho.\n',
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

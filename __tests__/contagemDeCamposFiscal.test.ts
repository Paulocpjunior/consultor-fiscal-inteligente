// ============================================================================
// 🚨 A CONTAGEM DE CAMPOS DO EFD ICMS/IPI — a trava que existia só na OUTRA
// família.
//
// `conferirContagemDeCampos` roda em todo arquivo do EFD-**Contribuições**
// desde 18/08. Esta família — a que a PWR fechou em 20/08, com 45 registros de
// conteúdo — **não tinha nenhuma**: é a "meia trava" do COD_MUN do 0150
// (22/08), que protege o cliente de um arquivo e deixa o do outro descoberto.
//
// A classe que ela pega já custou recibo TRÊS vezes: o **1010** com 9 campos
// onde tem 7 (MANTOAN, 17/08), o **C100/C170** com 24/23 onde têm 29/37 (PWR,
// 20/08 — **157 recusas de importação de uma vez**) e o **0500** com o leiaute
// do arquivo VIZINHO (CF BANK, 24/08, achado pelo Paulo contando as barras).
//
// ═══ O TESTE QUE VALE É A PROVA CRUZADA ═════════════════════════════════════
//
// A tabela vem de uma extração mecânica de .docx, e o modo de falha dela é o
// PIOR possível: **subestimar a contagem E parecer completa**. Aconteceu três
// vezes só ao construir isto —
//
//   · **0100**: o `14` saiu numa linha sem `|`, a leitura parou no 13 e a
//     sequência 01..13 ficou CONTÍGUA ⇒ marcada como conferida. A trava
//     acusaria o 0100 de TODA empresa.
//   · **G001**: o `02`/`IND_MOV` vieram separados por uma linha só com `|`,
//     e o registro saiu com 1 campo.
//   · **0500**: o campo 05 chama-se **NÍVEL**, com acento, e o regex do nome
//     não o aceitava.
//
// Nos três, quem respondeu foi **rodar o gerador e contar a linha** — nunca a
// leitura do Guia sozinha. Por isso o teste que manda aqui é o que compara a
// tabela com o que os geradores REAIS emitem: tabela subestimada quebra a
// build em vez de virar alarme falso em produção.
// ============================================================================
import {
    CAMPOS_POR_REGISTRO_FISCAL,
    REGISTROS_SEM_CONTAGEM_FISCAL,
    conferirContagemDeCamposFiscal,
} from '../sefaz-backend/sped-fiscal-campos.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBloco0 } from '../sefaz-backend/sped-fiscal-bloco0.js';
import { montarLinhasBlocoG } from '../sefaz-backend/sped-bloco-g.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBloco9 } from '../sefaz-backend/sped-fiscal-bloco9.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

const dadosBloco0 = () => ({
    empresa: {
        cnpj: '11111111000191',
        nome: 'EMPRESA TESTE LTDA',
        dadosFiscais: {
            uf: 'SP', inscricaoEstadual: '123456789012', codMunIBGE: '3550308',
            cep: '01001000', logradouro: 'RUA X', numero: '1', bairro: 'CENTRO',
        },
    },
    contador: {
        nome: 'CONTADOR', cpf: '39053344705', crc: '1SP123456', cep: '01001000',
        logradouro: 'R', numero: '2', bairro: 'B', telefone: '1130000000',
        email: 'a@b.c', codMunIBGE: '3550308',
    },
    competenciaInicio: '2026-07',
    competenciaFim: '2026-07',
    participantes: [{ codPart: 'P1', nome: 'FORNECEDOR', cnpj: '22222222000191', codMunIBGE: '3550308' }],
    unidades: [{ unidade: 'UN', descricao: 'UNIDADE' }],
    itens: [{ codItem: 'I1', descricao: 'ITEM', unidade: 'UN' }],
    ciap: {
        bens: [{
            codigo: 'BEM1', descricao: 'MAQUINA', tipo: 'bem',
            contaContabil: '1231001', contaContabilNome: 'MAQUINAS', contaContabilNivel: '5',
        }],
    },
    difalCodObservacao: 'OBS1',
    difalTemC195: true,
    warnings: [] as string[],
});

/** Um arquivo montado pelos geradores REAIS, não escrito à mão. */
const arquivoReal = (): string[] => {
    const corpo: string[] = [
        ...buildBloco0(dadosBloco0()),
        // ⚠️ A forma vem do `.d.ts` do próprio módulo — foi ele que pegou a
        // minha fixture inventada (`{ periodos: [] }`), assim que o
        // `@ts-expect-error` supérfluo saiu do import.
        ...montarLinhasBlocoG({
            apuracao: {
                bens: [], saldoInicial: 0, somaParcelas: 0, saidasTributadas: 0,
                saidasTotais: 0, indice: 0, creditoApropriado: 0, outrosCreditos: 0,
                avisos: [],
            },
            dtIni: '01072026',
            dtFin: '31072026',
        }),
    ].map((l: string) => String(l).replace(/\r?\n$/, ''));
    return [...corpo, ...buildBloco9(corpo).map((l: string) => String(l).replace(/\r?\n$/, ''))];
};

describe('🚨 a tabela do Guia bate com o que os geradores REAIS emitem', () => {
    const linhas = arquivoReal();

    it('a geração produziu linhas para conferir', () => {
        // Guarda contra o silêncio falso: sem linhas o teste passaria verde
        // sem medir nada — o defeito que esta casa persegue desde 22/08.
        expect(linhas.length).toBeGreaterThan(10);
    });

    // 🚨 ESTE É O TESTE QUE IMPEDE A TABELA SUBESTIMADA DE SUBIR.
    it('nenhum registro emitido diverge do leiaute', () => {
        const r = conferirContagemDeCamposFiscal(linhas);
        if (!r.ok) {
            throw new Error(
                '\n\n🚧 CONTAGEM DE CAMPOS DIVERGENTE\n\n'
                + r.erros.map((e: { mensagem: string }) => `  · ${e.mensagem}`).join('\n')
                + '\n\nTRIE ANTES DE CORRIGIR — três vezes ao construir esta trava quem estava\n'
                + 'errado era a TABELA, não o gerador (0100 parando no 13, G001 com 1 campo,\n'
                + '0500 com o "NÍVEL" acentuado). Rode o gerador e conte a linha.\n',
            );
        }
    });

    // 📌 Silêncio não é aprovação: registro fora da tabela sai NOMEADO. Foi o
    // silêncio da trava do Contribuições — que só cobria os onze provados por
    // recibo — que deixou o 0500 sair com o leiaute do arquivo vizinho.
    it('e o que ela não cobre sai DITO, nunca calado', () => {
        const r = conferirContagemDeCamposFiscal(linhas);
        expect(Array.isArray(r.naoConferidos)).toBe(true);
        for (const reg of r.naoConferidos) {
            expect(REGISTROS_SEM_CONTAGEM_FISCAL).toContain(reg);
        }
    });

    it('os registros que o gerador do bloco 0 emite estão TODOS na tabela', () => {
        const doBloco0 = buildBloco0(dadosBloco0())
            .map((l: string) => l.split('|')[1]);
        for (const reg of doBloco0) {
            expect({ reg, naTabela: Boolean(CAMPOS_POR_REGISTRO_FISCAL[reg]) })
                .toEqual({ reg, naTabela: true });
        }
    });
});

// ⚠️ Os números abaixo saem da leitura do Guia 3.2.3 **e** da linha que o
// gerador emite — os dois lados concordando. Travá-los aqui é o que impede um
// "conserto" na tabela de passar despercebido.
describe('📖 as contagens que já custaram recibo estão travadas', () => {
    const casos: Array<[string, number, string]> = [
        ['0100', 14, 'o 14 (COD_MUN) saía numa linha sem `|` e a leitura parava no 13'],
        ['0500', 7, 'o leiaute é por FAMÍLIA: 7 aqui, 9 no EFD-Contribuições'],
        ['0300', 7, 'registro novo de 29/08 — entra na trava no MESMO PR (régua de 24/08)'],
        ['0460', 3, 'idem'],
        ['C100', 29, 'saía com 24 — 157 recusas de importação na PWR'],
        ['G001', 2, 'REG + IND_MOV; a leitura dava 1'],
    ];
    for (const [reg, campos, porque] of casos) {
        it(`${reg} tem ${campos} campos — ${porque}`, () => {
            expect(CAMPOS_POR_REGISTRO_FISCAL[reg]?.campos).toBe(campos);
        });
    }
});

describe('🚦 a R42 acusa o registro fora do leiaute', () => {
    it('C100 com campos a menos vira recusa prevista', () => {
        const r = prevalidarSpedFiscal(['|C100|0|1|P1|55|00|1|123|']);
        const e = r.erros.find((x: { regra: string }) => x.regra === 'contagem-de-campos');
        expect(e).toBeTruthy();
        expect(String(e!.mensagem)).toMatch(/o leiaute tem 29 campos/);
        expect(String(e!.acao)).toMatch(/defeito de GERAÇÃO/);
    });

    it('e fica MUDA sobre o arquivo do gerador real', () => {
        const r = prevalidarSpedFiscal(arquivoReal());
        expect(r.erros.filter((x: { regra: string }) => x.regra === 'contagem-de-campos')).toEqual([]);
    });
});

// 📌 A LISTA DO QUE ELA NÃO CONFERIU TEM DE CHEGAR A ALGUÉM.
//
// `naoConferidos` existir e ninguém ler é a classe do `coberturaIncompleta`
// (quatro dias produzindo flag que nenhum leitor consumia) e do E510 "pronto"
// que ninguém gerava: **trava escrita não é trava ligada**. O header do
// EFD-Contribuições já leva esta lista desde 25/08; o do EFD ICMS/IPI não
// levava — e foi justamente o silêncio da trava do outro arquivo que deixou o
// 0500 sair com o leiaute do vizinho por meses.
describe('📌 o `naoConferidos` chega na resposta da geração', () => {
    const fonte = require('fs').readFileSync('sefaz-backend/sped-fiscal-routes.js', 'utf8');

    it('a rota importa a conferência e devolve a lista no header', () => {
        expect(fonte).toMatch(/from '\.\/sped-fiscal-campos\.js'/);
        const header = fonte.slice(fonte.indexOf("X-SPED-Prevalidacao"));
        expect(header.slice(0, 900)).toMatch(/naoConferidos/);
    });

    // 🚨 E O HEADER SOZINHO NÃO BASTA — a tela lê `X-SPED-Warnings` e
    // `X-SPED-Auditoria`, e **não lê** o `X-SPED-Prevalidacao`. Deixar a lista
    // só no header seria repetir, um nível acima, a classe que ela existe para
    // fechar. Ela entra nos WARNINGS, que é o caminho que chega.
    it('e entra nos WARNINGS, que é o que a tela lê', () => {
        expect(fonte).toMatch(/warnings\.push\([\s\S]{0,400}NÃO conferiu/);
        // ⚠️ Uma conferência só: duas chamadas divergiriam entre o aviso e o
        // header no primeiro registro novo.
        expect(fonte.match(/conferirContagemDeCamposFiscal\(linhasDoArquivo\)/g) || [])
            .toHaveLength(1);
    });

    it('⚠️ e ela NASCE MUDA — arquivo coberto não ganha linha nova', () => {
        expect(conferirContagemDeCamposFiscal(arquivoReal()).naoConferidos).toEqual([]);
    });
});

describe('⚠️ o que a trava NÃO faz', () => {
    it('registro fora da tabela não vira erro — vira NOMEADO', () => {
        const r = conferirContagemDeCamposFiscal(['|ZZZZ|1|2|3|']);
        expect(r.ok).toBe(true);
        expect(r.naoConferidos).toEqual(['ZZZZ']);
    });

    it('linha malformada não explode nem acusa contagem (tem dono próprio)', () => {
        expect(conferirContagemDeCamposFiscal(['C100|0|1|']).ok).toBe(true);
        expect(conferirContagemDeCamposFiscal(null as unknown as string[]).ok).toBe(true);
        expect(conferirContagemDeCamposFiscal([]).ok).toBe(true);
    });

    // 🚨 Ela conta CAMPOS. O FANTASIA do 0005 saindo com 91 caracteres num
    // campo de 60 (29/08) tem a contagem CERTA — quem pega aquilo é a trava de
    // TAMANHO. As duas são necessárias e nenhuma substitui a outra.
    it('é CEGA para o tamanho do campo — e isso é declarado', () => {
        // 🐛 A 1ª versão desta linha tinha 9 campos e o 0005 tem 10 — a trava
        // acusou, CERTA, e quem estava errado era a fixture. Sexta vez no
        // mesmo dia: posição e contagem se leem CONTANDO, nunca de olho.
        const gordo = `|0005|${'A'.repeat(200)}|1|2|3|4|5|6|7|8|`;
        expect(conferirContagemDeCamposFiscal([gordo]).ok).toBe(true);
    });
});

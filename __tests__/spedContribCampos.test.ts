/**
 * spedContribCampos — a contagem de campos por registro, provada contra o
 * arquivo REAL que o PVA recusou.
 *
 * MANTOAN 13344638000191 · 07/2026 · recibo do PVA de 18/08:
 *
 *   Linha 88 · M210 · Número de Campos · Esperado 16 · Conteúdo 8
 *   Linha 88 · M210 · VL_BC_CONT · "Registro/Campo não informado ou inválido" · 0,6500
 *   Linha 90 · M610 · Número de Campos · Esperado 16 · Conteúdo 8
 *   Linha 90 · M610 · VL_BC_CONT · 3,0000
 *
 * A segunda recusa explica a primeira: faltando campos no meio, a ALÍQUOTA cai
 * na casa da BASE DE CÁLCULO — o arquivo declarava base de R$ 0,65 gerando
 * contribuição de R$ 285,28. Os VALORES estavam certos; a FORMA é que não.
 */
// @ts-ignore — módulo JS do backend, sem tipos
import {
    conferirContagemDeCampos, camposDaLinha, CAMPOS_POR_REGISTRO, avisosDeContagemDeCampos,
    conferirPerfilConsolidado, indRegCumDoArquivoGerado,
// @ts-ignore
} from '../sefaz-backend/sped-contrib-campos.js';
import { buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';

/** As duas linhas exatamente como saíram do arquivo que o PVA recusou. */
const LINHA_M210_RECUSADA = '|M210|01|43890,00|0,6500|||285,28||';
const LINHA_M610_RECUSADA = '|M610|01|43890,00|3,0000|||1316,70||';

describe('camposDaLinha conta como o PVA conta', () => {
    it('conta o REG e não conta as pontas vazias do pipe', () => {
        // O PVA disse "Conteúdo do Campo 8" para esta linha.
        expect(camposDaLinha(LINHA_M210_RECUSADA)).toHaveLength(8);
        expect(camposDaLinha(LINHA_M210_RECUSADA)[0]).toBe('M210');
    });

    it('linha que não é do SPED não vira contagem', () => {
        expect(camposDaLinha('')).toEqual([]);
        expect(camposDaLinha('M210|01')).toEqual([]);
        expect(camposDaLinha(null as any)).toEqual([]);
    });
});

describe('a trava pega o arquivo real que o PVA recusou', () => {
    const r = conferirContagemDeCampos([LINHA_M210_RECUSADA, LINHA_M610_RECUSADA]);

    it('acusa os DOIS registros com o número que o PVA esperava', () => {
        expect(r.ok).toBe(false);
        expect(r.erros).toHaveLength(2);
        const m210 = r.erros.find((e: any) => e.registro === 'M210');
        expect(m210.esperado).toBe(16);
        expect(m210.recebido).toBe(8);
    });

    it('a mensagem DIZ o campo que ficou na casa errada, não só a contagem', () => {
        const m210 = r.erros.find((e: any) => e.registro === 'M210');
        expect(m210.mensagem).toContain('VL_BC_CONT');
        expect(m210.mensagem).toContain('0,6500');
        const m610 = r.erros.find((e: any) => e.registro === 'M610');
        expect(m610.mensagem).toContain('3,0000');
    });

    // As fontes legítimas desta tabela são TRÊS: a recusa do PVA, o arquivo
    // ACEITO e — desde 25/08 — o próprio **Guia Prático 1.35**, que o Paulo
    // mandou em Word e que passou a cobrir os registros que recibo nenhum
    // tinha alcançado. O que nunca vale é memória.
    it('cada contagem carrega a FONTE — nenhuma foi escrita de memória', () => {
        for (const reg of Object.keys(CAMPOS_POR_REGISTRO)) {
            expect(String((CAMPOS_POR_REGISTRO as any)[reg].fonte)).toMatch(/PVA|ACEITO|Guia Prático/);
        }
    });

    it('registro sem contagem provada NÃO é acusado — mas volta NOMEADO', () => {
        // ⚠️ O exemplo era o C100, e ele DEIXOU de servir em 20/08: o recibo do
        // PVA da PWR deu a contagem dele (29), então ele saiu da lista dos não
        // provados. Trocar a FIXTURE é o certo — trocar a régua para manter o
        // teste verde seria desligar a trava que acabou de pegar um defeito.
        // ⚠️ E a fixture MUDOU DE NOVO em 25/08, pela mesma razão: com o Guia
        // no repo o 0150 passou a ser conferido (13 campos). Quem continua
        // descoberto é o 0100 — o número de um campo dele se perdeu na
        // conversão do .docx, então a contagem seria um chute.
        const s = conferirContagemDeCampos(['|0100|X|Y|', '|M210|01|1|2|3|4|5|6|7|8|9|10|11|12|13|14|']);
        expect(s.erros).toHaveLength(0);      // o M210 acima tem os 16
        expect(s.naoConferidos).toContain('0100');
        // Silêncio não é aprovação: quem lê precisa saber o que ficou de fora.
        expect(s.naoConferidos).not.toContain('M210');
    });

    it('não explode com entrada torta — conferência não pode derrubar a geração', () => {
        expect(() => conferirContagemDeCampos(null as any)).not.toThrow();
        expect(conferirContagemDeCampos(undefined as any).ok).toBe(true);
    });
});

describe('o gerador corrigido produz o leiaute que o PVA aceita', () => {
    // MANTOAN é PRESUMIDO ⇒ cumulativo: PIS 0,65% e COFINS 3% sobre 43.890,00.
    // A nota entra na forma ACHATADA da NFS-e do portal (`valorTotal`, sem
    // `itens`) — a forma real do arquivo da MANTOAN, e a que já tinha zerado o
    // M200/M600 uma vez. Base 43.890,00, que é a do arquivo real; assim os
    // centavos batem com o que o PVA leu (285,28 · 1.316,70).
    const dados: any = {
        empresa: { cnpj: '13344638000191', nome: 'CLINICA MEDICA MANTOAN' },
        competencia: '2026-07',
        regimeApuracao: '2',
        notas: [{ numero: '1000', direcao: 'saida', tipo: 'nfse', valorTotal: 43890.00 }],
        itens: [],
        participantes: [],
        warnings: [],
    };

    it('M210 e M610 saem com 16 campos e passam na própria trava', () => {
        const linhas: string[] = buildBlocoM(dados);
        const m210 = linhas.find(l => l.startsWith('|M210|'));
        const m610 = linhas.find(l => l.startsWith('|M610|'));
        if (!m210 || !m610) {
            // Se a montagem do bloco M mudar de forma de entrada, este teste
            // precisa acompanhar — falhar aqui é melhor que passar vazio.
            throw new Error('buildBlocoM não produziu M210/M610 com este formato de dados');
        }
        expect(camposDaLinha(m210)).toHaveLength(16);
        expect(camposDaLinha(m610)).toHaveLength(16);
        expect(conferirContagemDeCampos(linhas).ok).toBe(true);
    });

    it('🚨 a BASE volta para a casa dela — o campo 4 deixa de ser a alíquota', () => {
        const linhas: string[] = buildBlocoM(dados);
        const m210 = camposDaLinha(linhas.find(l => l.startsWith('|M210|'))!);
        expect(m210[3]).toBe('43890,00');   // VL_BC_CONT
        expect(m210[7]).toBe('0,6500');     // ALIQ_PIS, agora na posição 8
        expect(m210[10]).toBe('285,28');    // VL_CONT_APUR
        expect(m210[15]).toBe('285,28');    // VL_CONT_PER

        const m610 = camposDaLinha(linhas.find(l => l.startsWith('|M610|'))!);
        expect(m610[3]).toBe('43890,00');
        expect(m610[7]).toBe('3,0000');
        expect(m610[15]).toBe('1316,70');
    });

    it('campo de ajuste/diferimento sai VAZIO, nunca 0,00 inventado', () => {
        const m210 = camposDaLinha(buildBlocoM(dados).find((l: string) => l.startsWith('|M210|'))!);
        // 5,6 = ajustes de BC · 12,13 = ajustes de contribuição · 14,15 = diferimento
        for (const i of [4, 5, 8, 9, 11, 12, 13, 14]) expect(m210[i]).toBe('');
    });

    it('avisosDeContagemDeCampos entrega frase pronta para os warnings', () => {
        const avisos = avisosDeContagemDeCampos([LINHA_M210_RECUSADA]);
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toContain('M210');
        expect(avisos[0]).toContain('PVA recusa');
    });
});

// ═══ O PERFIL DO ARQUIVO — a recusa da AFFITTARE, conferida ANTES do PVA ════
//
// 21/08: o arquivo consolidado (F550 ⇒ IND_REG_CUM 2) saiu com o A010/A100 da
// NFS-e TOMADA e o PVA recusou: "O registro não deve ser informado para esse
// perfil e/ou tipo de operação". As linhas abaixo são as do arquivo real.
describe('🚨 perfil CONSOLIDADO não leva documento (PVA da AFFITTARE, 21/08)', () => {
    const consolidado = [
        '|0000|006|0|||01072026|31072026|AFFITTARE IMOVEIS ADMINISTRACAO LTDA|17213641000127|SP|3550308||00|1|',
        '|0110|2||1|2|',
        '|A010|17213641000127|',
        '|A100|0|1|55402564000142|00|||5584||30072026|30072026|1391,58|0||1391,58|9,05|1391,58|41,75||||',
        '|F550|21811,34|01|0,00|21811,34|0,65|141,77|01|0,00|21811,34|3,00|654,34|||||',
    ];

    it('acusa o A010 e o A100 com a recusa literal como fonte', () => {
        const { erros } = conferirPerfilConsolidado(consolidado);
        expect(erros.map((e: any) => e.registro).sort()).toEqual(['A010', 'A100']);
        expect(erros[0].fonte).toMatch(/não deve ser informado para esse perfil/);
        expect(erros.find((e: any) => e.registro === 'A100')!.mensagem).toMatch(/CONSOLIDADO/);
    });

    it('o arquivo LIMPO (bloco A vazio) passa — é o desenho do aceito de 05/2026', () => {
        const limpo = consolidado.filter((l) => !l.startsWith('|A010|') && !l.startsWith('|A100|'));
        expect(conferirPerfilConsolidado(limpo).erros).toEqual([]);
    });

    it('⚠️ arquivo DETALHADO (IND_REG_CUM 9) NÃO é acusado — o PVA aceitou a MANTOAN', () => {
        const detalhado = consolidado.map((l) => (l.startsWith('|0110|') ? '|0110|2||1|9|' : l));
        expect(conferirPerfilConsolidado(detalhado).erros).toEqual([]);
    });

    it('sem 0110 no arquivo, nada se afirma sobre o perfil', () => {
        const semPerfil = consolidado.filter((l) => !l.startsWith('|0110|'));
        expect(conferirPerfilConsolidado(semPerfil).erros).toEqual([]);
        expect(indRegCumDoArquivoGerado(semPerfil)).toBe('');
    });

    it('a rota confere o ARQUIVO gerado, não a intenção do gerador', () => {
        const fs = require('fs');
        const path = require('path');
        const rota = fs.readFileSync(
            path.resolve(__dirname, '../sefaz-backend/sped-contrib-routes.js'), 'utf8',
        );
        expect(rota).toMatch(/conferirPerfilConsolidado\(linhasDoArquivo\)/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AS RECUSAS QUE FORAM APRENDIDAS E NUNCA VIRARAM REGRA (21/08)
//
// O EFD ICMS/IPI tem 15 regras de prevalidação, cada uma nascida de uma recusa
// REAL. Do lado do EFD-Contribuições havia duas, e três recusas de 2026 tinham
// sido corrigidas **só no gerador**: consertar o gerador fecha a INSTÂNCIA, a
// regra fecha a CLASSE — sem ela a próxima empresa gasta uma volta de PVA
// descobrindo o mesmo.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 prevalidação do EFD-Contribuições — as três que faltavam', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const {
        conferirCodItemDosItens, conferirIndOrigCredDasEntradas,
        conferirRetencaoDoBlocoM, avisosDaPrevalidacaoContrib,
    } = require('../sefaz-backend/sped-contrib-campos.js');

    describe('COD_ITEM vazio (MANTOAN, 36 recusas)', () => {
        it('acusa o A170 sem código e cita a fonte', () => {
            const r = conferirCodItemDosItens([
                '|A170|1||PRESTACAO DE SERVICOS|1450,00|\r\n',
            ]);
            expect(r.erros).toHaveLength(1);
            expect(r.erros[0].fonte).toContain('MANTOAN');
            expect(r.erros[0].mensagem).toContain('SERV-GENERICO');
        });

        it('A170 e C170 COM código passam', () => {
            expect(conferirCodItemDosItens([
                '|A170|1|SERV-GENERICO|PRESTACAO|1450,00|\r\n',
                '|C170|1|84814|TELHA|500|UN|4765,00|\r\n',
            ]).erros).toHaveLength(0);
        });
    });

    describe('IND_ORIG_CRED da ENTRADA (MANTOAN, 3 recusas)', () => {
        const a100 = (indOper: string) => `|A100|${indOper}|1|05059447000150|00|1|123||\r\n`;
        // A170: REG|NUM_ITEM|COD_ITEM|DESCR|VL_ITEM|VL_DESC|NAT_BC_CRED|IND_ORIG_CRED|CST…
        const a170 = (indOrig: string) => `|A170|1|SERV|X|100,00||01|${indOrig}|70|\r\n`;

        it('entrada sem o campo é acusada — quem manda é a DIREÇÃO, não o CST', () => {
            const r = conferirIndOrigCredDasEntradas([a100('0'), a170('')]);
            expect(r.erros).toHaveLength(1);
            expect(r.erros[0].mensagem).toContain('ENTRADA');
        });

        it('entrada COM o campo passa', () => {
            expect(conferirIndOrigCredDasEntradas([a100('0'), a170('0')]).erros).toHaveLength(0);
        });

        it('SAÍDA sem o campo passa — ele só existe do lado de quem compra', () => {
            expect(conferirIndOrigCredDasEntradas([a100('1'), a170('')]).erros).toHaveLength(0);
        });

        it('o contexto FECHA no fim do bloco — não atravessa para outro documento', () => {
            expect(conferirIndOrigCredDasEntradas([
                a100('0'), a170('0'), '|A990|3|\r\n', a170(''),
            ]).erros).toHaveLength(0);
        });
    });

    describe('M200/M600 × Σ F600 (HS PROJETOS)', () => {
        // Os números REAIS do arquivo aceito da HS: Σ F600 = PIS 114,40 e
        // COFINS 528,00, iguais ao VL_RET_CUM do M200/M600 do mesmo arquivo.
        const f600 = (pis: string, cofins: string) =>
            `|F600|03|02052026|5200|189,8|5952|1|47252373000113|${pis}|${cofins}|0|\r\n`;
        const m = (reg: string, retCum: string) =>
            `|${reg}|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|${retCum}|0,00|0,00|0,00|\r\n`;

        it('fechando, fica em silêncio', () => {
            const r = conferirRetencaoDoBlocoM([
                f600('114,40', '528,00'), m('M200', '114,40'), m('M600', '528,00'),
            ]);
            expect(r.erros).toHaveLength(0);
        });

        it('bloco F vazio com retenção no M é acusado — e o aviso diz onde olhar', () => {
            const r = conferirRetencaoDoBlocoM([m('M200', '114,40')]);
            expect(r.erros).toHaveLength(1);
            expect(r.erros[0].mensagem).toContain('SEM nenhum F600');
            expect(r.erros[0].mensagem).toContain('o defeito costuma estar no F600');
        });

        it('divergência de centavos acusa, com os DOIS números', () => {
            const r = conferirRetencaoDoBlocoM([f600('100,00', '528,00'), m('M200', '114,40')]);
            expect(r.erros[0].mensagem).toContain('114.40');
            expect(r.erros[0].mensagem).toContain('100.00');
        });
    });

    it('o muro de aviso é CONTADO, não repetido linha a linha', () => {
        const avisos = avisosDaPrevalidacaoContrib([
            '|A170|1||X|10,00|\r\n', '|A170|2||Y|10,00|\r\n', '|A170|3||Z|10,00|\r\n',
        ]);
        expect(avisos).toHaveLength(2);
        expect(avisos[1]).toContain('mais 2 ocorrência(s)');
    });

    it('e a rota da geração CHAMA a prevalidação — regra sem leitor não protege ninguém', () => {
        const fs = require('fs');
        const path = require('path');
        const rota = fs.readFileSync(path.resolve(__dirname, '../sefaz-backend/sped-contrib-routes.js'), 'utf8');
        expect(rota).toContain('avisosDaPrevalidacaoContrib(linhasDoArquivo)');
    });
});

// ============================================================================
// 🚨 O 0500 DO EFD-CONTRIBUIÇÕES NÃO É O DO EFD ICMS/IPI
//
// Paulo, 24/08, comparando o nosso arquivo do CF BANK com o assinado da própria
// empresa: *"nossa diferença está aí, que uma está com 4 barrinhas e a outra
// com 3"*. O gerador emitia NOVE campos onde o leiaute tem OITO — eu tinha
// copiado o 0500 do EFD **ICMS/IPI**, que carrega um `COD_CCUS` a mais.
//
// É a MESMA classe do 1010 de 17/08: mesmo NÚMERO de registro, arquivo
// diferente, leiaute diferente. E a trava de contagem existia desde 18/08 —
// ela ficou MUDA porque o 0500 não estava em `CAMPOS_POR_REGISTRO`.
// ============================================================================

describe('🚨 a contagem só protege o registro que está NELA', () => {
    /** A linha do EFD-Contribuições ACEITO do CF BANK (06/2026), byte a byte. */
    const LINHA_0500_ASSINADA = '|0500|01012026|04|A|5|30106030012|RENDIMENTOS FINANCEIROS|||';
    /** O que o gerador emitia: o 0500 do EFD ICMS/IPI, com o COD_CCUS a mais. */
    const LINHA_0500_ICMS_IPI = '|0500|01012026|04|A|5|30106030012|RENDIMENTOS FINANCEIROS||||';

    // ⚠️ 9 e 10 CONTANDO O REG (8 e 9 campos depois dele) — é assim que o PVA
    // conta, e foi por não conferir isso que a minha primeira contagem entrou
    // errada na tabela. Quem conta é a função, nunca o meu dedo.
    it('o assinado tem 8 campos após o REG e passa; o do arquivo vizinho tem 9 e é ACUSADO', () => {
        expect(camposDaLinha(LINHA_0500_ASSINADA)).toHaveLength(9);
        expect(conferirContagemDeCampos([LINHA_0500_ASSINADA]).ok).toBe(true);

        const r = conferirContagemDeCampos([LINHA_0500_ICMS_IPI]);
        expect(r.ok).toBe(false);
        expect(r.erros[0].esperado).toBe(9);
        expect(r.erros[0].recebido).toBe(10);
    });

    it('o F100 entrou junto — ele é o registro que APONTA para o 0500', () => {
        // As duas formas provadas: com conta (CF BANK) e sem conta (PEC, aceito).
        const cfBank = '|F100|1|||30062026|21647,53|02|21647,53|0,65|140,71|02|'
            + '21647,53|4|865,9|||30106030012|||';
        const pec = '|F100|1|||01052026|188836,42|01|188836,42|0,65|1227,44|01|'
            + '188836,42|3|5665,09||||||';
        expect(camposDaLinha(cfBank)).toHaveLength(19);
        expect(camposDaLinha(pec)).toHaveLength(19);
        expect(conferirContagemDeCampos([cfBank, pec]).ok).toBe(true);
    });

    // 📌 O que este teste realmente trava: registro NOVO que ninguém pôs na
    // tabela não é acusado — ele volta em `naoConferidos`, e silêncio ali não é
    // aprovação. Foi exatamente isso que deixou o 0500 sair com 9 campos.
    it('registro fora da tabela sai NOMEADO em vez de passar por conferido', () => {
        const s = conferirContagemDeCampos(['|0500|a|b|c|', '|9XYZ|1|2|']);
        expect(s.erros[0].registro).toBe('0500');   // este está na tabela: acusa
        expect(s.naoConferidos).toContain('9XYZ');  // este não: volta nomeado
    });
});

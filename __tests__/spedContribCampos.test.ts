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
// @ts-ignore
} from '../sefaz-backend/sped-contrib-campos.js';
// @ts-ignore
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

    // As DUAS fontes legítimas desta tabela são a recusa do PVA e o arquivo
    // ACEITO — "arquivo aceito > leiaute deduzido" é a régua da casa, e foi um
    // aceito que fixou o M205/M605. O que nunca vale é memória.
    it('cada contagem carrega a FONTE — nenhuma foi escrita de memória', () => {
        for (const reg of Object.keys(CAMPOS_POR_REGISTRO)) {
            expect(String((CAMPOS_POR_REGISTRO as any)[reg].fonte)).toMatch(/PVA|ACEITO/);
        }
    });

    it('registro sem contagem provada NÃO é acusado — mas volta NOMEADO', () => {
        // ⚠️ O exemplo era o C100, e ele DEIXOU de servir em 20/08: o recibo do
        // PVA da PWR deu a contagem dele (29), então ele saiu da lista dos não
        // provados. Trocar a FIXTURE é o certo — trocar a régua para manter o
        // teste verde seria desligar a trava que acabou de pegar um defeito.
        const s = conferirContagemDeCampos(['|0150|X|Y|', '|M210|01|1|2|3|4|5|6|7|8|9|10|11|12|13|14|']);
        expect(s.erros).toHaveLength(0);      // o M210 acima tem os 16
        expect(s.naoConferidos).toContain('0150');
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

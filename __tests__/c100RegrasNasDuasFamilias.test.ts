// ============================================================================
// 🚨 DUAS RECUSAS JÁ PAGAS VALIAM NAS DUAS FAMÍLIAS — e rodavam numa só
//
// O cabeçalho do C100 é o MESMO nos dois arquivos (conferido campo a campo
// contra os dois geradores):
//
//     |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|
//      DT_DOC|DT_E_S|VL_DOC|…
//
// Só o que vem DEPOIS do VL_DOC diverge. Ou seja, a recusa *"o modelo da chave
// não confere com o modelo do documento"* (PS VIDROS 0896, 19/08, **35
// ocorrências**) e o limite de DT_DOC do Guia 3.2.3 valem, palavra por
// palavra, no EFD-Contribuições — e lá não rodavam.
//
// É a "meia trava" do COD_MUN do 0150 (22/08), um bloco adiante: a regra entra
// numa família só, e a próxima empresa gasta a mesma volta de PVA com outro
// CNPJ.
//
// ⚠️ E A POSIÇÃO DO DT_FIN É PARÂMETRO, NUNCA DEDUÇÃO: o 0000 do
// EFD-Contribuições traz `IND_SIT_ESP` e `NUM_REC_ANTERIOR` antes das datas,
// então o DT_FIN é o campo **7** — no EFD ICMS/IPI é o **5**.
//
// 🐛 E ESTE TESTE PEGOU UM ERRO MEU DE CONTAGEM ANTES DE SUBIR: eu tinha
// escrito 6. O campo 6 do EFD-Contribuições é o **DT_INI**, que também é uma
// data VÁLIDA — a regra não emudeceria, ela passaria a acusar **toda** nota
// emitida depois do dia 1º. Alarme falso em todo arquivo é o jeito mais rápido
// de a equipe desligar a prevalidação.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { avisosDaPrevalidacaoContrib } from '../sefaz-backend/sped-contrib-campos.js';
// @ts-expect-error — módulo backend .js sem .d.ts (só o teste o importa daqui)
import { POS_DT_FIN_ICMS_IPI, POS_DT_FIN_CONTRIBUICOES } from '../sefaz-backend/sped-c100-regras-comuns.js';

const RAIZ = join(__dirname, '..');
const l = (campos: string[]) => `|${campos.join('|')}|\r\n`;

/** Chave de 44 dígitos com o modelo nas posições 21-22. */
const chaveCom = (modelo: string) => '3'.repeat(20) + modelo + '4'.repeat(22);

// 0000 do EFD ICMS/IPI: DT_INI é o 4 e DT_FIN o 5.
const zero0000Fiscal = l(['0000', '020', '0', '01072026', '31072026', 'X LTDA', '31947349000169', '', 'SP', '123', '3550308', '', '', 'A', '1']);
// 0000 do EFD-Contribuições: IND_SIT_ESP e NUM_REC_ANTERIOR antes das datas.
// |0000|COD_VER|TIPO_ESCRIT|IND_SIT_ESP|NUM_REC_ANTERIOR|DT_INI|DT_FIN|NOME|…
const zero0000Contrib = l(['0000', '006', '0', '', '', '01072026', '31072026', 'X LTDA', '31947349000169', 'SP', '3550308', '', '00', '1']);

const c100 = (modeloDeclarado: string, modeloDaChave: string, dtDoc: string) =>
    l(['C100', '0', '1', 'P1', modeloDeclarado, '00', '001', '3485', chaveCom(modeloDaChave), dtDoc, dtDoc, '1000,00']);

describe('🚨 as posições do DT_FIN são as de cada leiaute', () => {
    it('5 no EFD ICMS/IPI, 7 no EFD-Contribuições', () => {
        expect(POS_DT_FIN_ICMS_IPI).toBe(5);
        expect(POS_DT_FIN_CONTRIBUICOES).toBe(7);
    });

    // A prova de que a posição do Contribuições é a certa: no 0000 dele o
    // campo 5 é o NUM_REC_ANTERIOR (vazio), o 6 é o DT_INI e o 7 é o DT_FIN.
    it('e o 0000 de cada família confirma', () => {
        expect(zero0000Fiscal.split('|')[5]).toBe('31072026');
        expect(zero0000Contrib.split('|')[7]).toBe('31072026');
        // E o campo 6 é o DT_INI — a data que faria a regra acusar tudo.
        expect(zero0000Contrib.split('|')[6]).toBe('01072026');
    });
});

describe('🚨 COD_MOD × chave — agora nas duas', () => {
    it('EFD ICMS/IPI acusa (era onde já rodava)', () => {
        const r = prevalidarSpedFiscal([zero0000Fiscal, c100('55', '65', '10072026')]);
        const e = r.erros.find((x: any) => x.regra === 'cod-mod-x-chave');
        expect(e).toBeDefined();
        expect(e!.esperado).toBe('65');
    });

    it('EFD-Contribuições acusa — era aqui que faltava', () => {
        const avisos = avisosDaPrevalidacaoContrib([zero0000Contrib, c100('55', '65', '10072026')]);
        expect(avisos.join(' ')).toMatch(/modelo 55 e a chave de acesso diz 65/);
    });

    it('e nenhuma das duas grita quando o modelo bate', () => {
        expect(prevalidarSpedFiscal([zero0000Fiscal, c100('55', '55', '10072026')])
            .erros.some((x: any) => x.regra === 'cod-mod-x-chave')).toBe(false);
        expect(avisosDaPrevalidacaoContrib([zero0000Contrib, c100('55', '55', '10072026')])
            .join(' ')).not.toMatch(/chave de acesso diz/);
    });
});

describe('🚨 DT_DOC depois do fim do período — agora nas duas', () => {
    it('EFD-Contribuições acusa a nota que caiu no mês seguinte', () => {
        const avisos = avisosDaPrevalidacaoContrib([zero0000Contrib, c100('55', '55', '01082026')]);
        expect(avisos.join(' ')).toMatch(/depois do fim do período/);
    });

    it('dentro do período, silêncio', () => {
        expect(avisosDaPrevalidacaoContrib([zero0000Contrib, c100('55', '55', '31072026')])
            .join(' ')).not.toMatch(/depois do fim do período/);
    });

    // ⚠️ EXTEMPORÂNEA É LEGÍTIMA — o Guia não exige DT_DOC ≥ DT_INI no C100.
    it('e documento de mês anterior NÃO é acusado', () => {
        expect(avisosDaPrevalidacaoContrib([zero0000Contrib, c100('55', '55', '15062026')])
            .join(' ')).not.toMatch(/depois do fim do período/);
    });

    // 🔴 A prova de que a posição importa: no 0000 do Contribuições o campo do
    // ICMS/IPI (5) é o NUM_REC_ANTERIOR, VAZIO — ali a regra emudeceria; e o 6
    // é o DT_INI, uma data válida que faria ela acusar TODA nota depois do
    // dia 1º. Por isso a posição é parâmetro, e cada família traz a sua.
    it('a posição do vizinho quebraria a regra nos dois sentidos', () => {
        expect(zero0000Contrib.split('|')[POS_DT_FIN_ICMS_IPI]).toBe('');
        const comPosicaoErrada = avisosDaPrevalidacaoContrib(
            [zero0000Contrib, c100('55', '55', '15072026')],
        );
        // Com a posição CERTA (7), uma nota do dia 15 dentro do período passa.
        expect(comPosicaoErrada.join(' ')).not.toMatch(/depois do fim do período/);
    });
});

describe('🚨 a implementação é UMA', () => {
    it('a prevalidação do ICMS/IPI não reimplementa as duas regras', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/sped-prevalidacao.js'), 'utf8');
        expect(src).toContain('conferirCodModContraChave');
        expect(src).toContain('conferirDtDocNoPeriodo');
        // A aritmética das datas não pode voltar a existir aqui.
        expect(src).not.toContain('const comoNumero =');
    });

    it('e a do Contribuições chama as mesmas', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/sped-contrib-campos.js'), 'utf8');
        expect(src).toContain('conferirCodModContraChave');
        expect(src).toContain('POS_DT_FIN_CONTRIBUICOES');
    });
});

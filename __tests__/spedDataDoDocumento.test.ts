// ============================================================================
// 🚨 A NOTA EMITIDA ÀS 22h SAÍA NO SPED COM A DATA DO DIA SEGUINTE
//
// O `dhEmi` da NF-e chega com o fuso do EMITENTE:
// `2026-07-31T22:30:00-03:00`. O formatador fazia `new Date(...)` e lia
// `getUTCDate()` — e às 22h30 de Brasília, em UTC, já é o dia seguinte.
//
// O backend roda no Cloud Run, cujo fuso é UTC. Então o defeito era ATIVO, e
// de duas gravidades:
//
//   · nota emitida depois das 21h saía com a data do dia SEGUINTE — errado, e
//     ninguém confere data a olho;
//   · na VIRADA DO MÊS ela saía com a data de OUTRA competência, e aí o PVA
//     recusa (Guia 3.2.3, C100 campo 10: DT_DOC ≤ DT_FIN do 0000).
//
// A data que o documento fiscal DECLARA é a do texto — `2026-07-31`. Converter
// para outro fuso é reescrever o que a nota diz.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import * as fmt from '../sefaz-backend/sped-fiscal-format.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

describe('🚨 a data do documento é a do EMITENTE, não a de UTC', () => {
    it('nota das 22h30 fica no MESMO dia', () => {
        expect(fmt.formatDate('2026-07-10T22:30:00-03:00')).toBe('10072026');
    });

    // 🔴 O caso caro: a virada do mês joga a nota para outra competência.
    it('nota das 22h30 do dia 31 NÃO vira dia 1º do mês seguinte', () => {
        expect(fmt.formatDate('2026-07-31T22:30:00-03:00')).toBe('31072026');
    });

    it('a nota da manhã continua igual — a correção não mexe no caso comum', () => {
        expect(fmt.formatDate('2026-07-10T10:00:00-03:00')).toBe('10072026');
    });

    it('data sem hora e data brasileira também respondem', () => {
        expect(fmt.formatDate('2026-07-05')).toBe('05072026');
        expect(fmt.formatDate('05/07/2026')).toBe('05072026');
    });

    // Campo fiscal não recebe chute: sem data legível, sai VAZIO.
    it('o que não é data legível sai VAZIO, nunca "hoje"', () => {
        expect(fmt.formatDate('')).toBe('');
        expect(fmt.formatDate('ontem')).toBe('');
        expect(fmt.formatDate(null)).toBe('');
    });

    // Firestore Timestamp era descartado em silêncio — e data vazia no C100 é
    // recusa do PVA.
    it('Timestamp do Firestore não some em silêncio', () => {
        const ts = { toDate: () => new Date('2026-07-05T12:00:00Z') };
        expect(fmt.formatDate(ts)).toBe('05072026');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A REDE: o erro é de DATA, e ninguém confere data a olho. A regra é do Guia,
// não deduzida — e só o limite SUPERIOR, porque documento EXTEMPORÂNEO (de mês
// anterior, escriturado agora) é legítimo e acusá-lo seria alarme falso.
// ═══════════════════════════════════════════════════════════════════════════
const linha = (campos: string[]) => `|${campos.join('|')}|\r\n`;

const arquivo = (dtDoc: string) => [
    linha(['0000', '020', '0', '01072026', '31072026', 'X LTDA', '31947349000169', '', 'SP', '123', '3550308', '', '', 'A', '1']),
    linha(['C100', '0', '1', 'P1', '55', '00', '001', '3485', '3'.repeat(44), dtDoc, dtDoc, '1000,00']),
];

describe('🚨 R16 — DT_DOC depois do fim do período', () => {
    it('acusa a nota que caiu no mês seguinte', () => {
        const r = prevalidarSpedFiscal(arquivo('01082026'));
        const e = r.erros.find((x: any) => x.regra === 'dt-doc-fora-do-periodo');
        expect(e).toBeDefined();
        expect(e!.esperado).toBe('≤ 31072026');
        expect(e!.fonte).toContain('Guia Prático');
    });

    it('não acusa a nota dentro do período', () => {
        const r = prevalidarSpedFiscal(arquivo('31072026'));
        expect(r.erros.some((x: any) => x.regra === 'dt-doc-fora-do-periodo')).toBe(false);
    });

    // ⚠️ EXTEMPORÂNEA É LEGÍTIMA: o Guia não exige DT_DOC ≥ DT_INI no C100.
    // Acusá-la faria a trava gritar sobre escrituração correta.
    it('e NÃO acusa documento extemporâneo, de mês anterior', () => {
        const r = prevalidarSpedFiscal(arquivo('15062026'));
        expect(r.erros.some((x: any) => x.regra === 'dt-doc-fora-do-periodo')).toBe(false);
    });

    it('sem 0000 legível a regra fica MUDA, em vez de acusar no escuro', () => {
        const r = prevalidarSpedFiscal([linha(['C100', '0', '1', 'P1', '55', '00', '001', '3485', '3'.repeat(44), '01082026', '01082026', '1000,00'])]);
        expect(r.erros.some((x: any) => x.regra === 'dt-doc-fora-do-periodo')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O `.FML` TINHA O MESMO DEFEITO — e discordar do SPED é o que custa caro
//
// O Exportar SAGE formatava a data a partir de um `Date`, com `getFullYear`/
// `getMonth`/`getDate` — ou seja, no fuso de QUEM ESTÁ RODANDO. Ali o defeito
// é mais discreto (o .FML sai do navegador do colaborador, em BRT), mas basta
// a nota vir de outro fuso — Manaus, -04:00, emitida às 23h30 — para o dia
// andar. E aí o **SPED declara 31/07 e o `.FML` 01/08 para a MESMA nota**.
//
// A trava é sobre a RESPOSTA, não sobre o código: os dois formatadores moram
// em mundos diferentes (o do SPED é backend `.js` sem `.d.ts`, e criar um só
// para partilhar cinco linhas traria de volta a armadilha do `.d.ts` à mão,
// 20/08). O que a casa precisa é que eles digam o MESMO DIA — e é isso que
// esta comparação prova, entrada por entrada.
// ═══════════════════════════════════════════════════════════════════════════
import { dataDeclaradaAAAAMMDD, participanteDoDoc } from '../services/iobSageExportService';

describe('🚨 SPED e .FML declaram o MESMO dia', () => {
    const casos = [
        '2026-07-31T22:30:00-03:00',   // o caso caro: vira o mês em UTC
        '2026-07-10T22:30:00-03:00',
        '2026-07-10T23:30:00-04:00',   // Manaus — o fuso que o BRT também erra
        '2026-07-10T10:00:00-03:00',
        '2026-07-05',
        '05/07/2026',
    ];

    it.each(casos)('%s', (bruto) => {
        const ddmmaaaa = fmt.formatDate(bruto);           // SPED: DDMMAAAA
        const aaaammdd = dataDeclaradaAAAAMMDD(bruto);    // .FML: AAAAMMDD
        expect(aaaammdd).toHaveLength(8);
        // Mesma data, formatos espelhados.
        expect(aaaammdd.slice(6, 8) + aaaammdd.slice(4, 6) + aaaammdd.slice(0, 4)).toBe(ddmmaaaa);
    });

    it('o ilegível sai VAZIO nos dois — data não se chuta', () => {
        for (const lixo of ['', 'ontem', null as any]) {
            expect(fmt.formatDate(lixo)).toBe('');
            expect(dataDeclaradaAAAAMMDD(lixo)).toBe('');
        }
    });
});

describe('🚨 nota sem data legível fica de FORA do .FML, nomeada', () => {
    const nota = (dhEmi: any) => ({
        id: 'x', numero: '3485', serie: '1', tipo: 'NFe', modelo: '55',
        chave: '35260731947349000169550010000034853106861510',
        dhEmi, direcao: 'entrada', status: 'autorizado',
        cnpjEmit: '12345678000199', xNomeEmit: 'FORNECEDOR LTDA', ufEmit: 'SP',
        emitente: { cnpjCpf: '12345678000199', nome: 'FORNECEDOR LTDA', uf: 'SP' },
        totais: { vNF: 1000 },
        itens: [{ cfop: '1102', vProd: 1000 }],
    }) as any;

    // A régua da casa: ausência bloqueia e é DITA. O `|| new Date()` anterior
    // escriturava a nota no dia da GERAÇÃO — na virada do mês, outra
    // competência, e o E-Fiscal aceita sem dizer nada.
    it('o participante continua legível (a nota é montável, o que falta é a data)', () => {
        expect(participanteDoDoc(nota('2026-07-10T10:00:00-03:00'))?.cnpjCpf).toBe('12345678000199');
    });

    it('e o gerador RECUSA a nota sem data, com a ação na frase', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { exportarParaIobSage } = require('../services/iobSageExportService');
        const r = exportarParaIobSage({ documentos: [nota(null)], numeroEmpresaEfiscal: 1 });
        const f = r.falhas.find((x: any) => /data de emissão/i.test(x.motivo));
        expect(f).toBeDefined();
        expect(f.motivo).toMatch(/HOJE/);
        expect(f.motivo).toMatch(/♻️|Reimporte/);
    });

    it('com data legível ela entra normalmente', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { exportarParaIobSage } = require('../services/iobSageExportService');
        const r = exportarParaIobSage({ documentos: [nota('2026-07-10T10:00:00-03:00')], numeroEmpresaEfiscal: 1 });
        expect(r.falhas.some((x: any) => /data de emissão/i.test(x.motivo))).toBe(false);
        expect(r.conteudo).toContain('20260710');
    });
});

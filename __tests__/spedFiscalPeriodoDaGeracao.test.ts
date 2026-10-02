import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
    conferirPeriodoDaGeracao, recortarNotasPeloPeriodo, dataDoDocumentoNoLivro,
} from '../sefaz-backend/sped-fiscal-periodo.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBlocoE } from '../sefaz-backend/sped-fiscal-blocoE.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBlocoH } from '../sefaz-backend/sped-fiscal-blocoH.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

/**
 * Paulo, 02/10, com o "Período da Geração De/Até" do IOB SAGE: "preciso
 * entregar o SPED de encerramento das filiais da Vinatex, tem que criar esse
 * campo também, igual no EFD".
 *
 * Guia Prático, 0000 do EFD ICMS/IPI: DT_INI = 1º dia do mês, exceto no início
 * de atividades; DT_FIN = último dia, exceto em encerramento, fusão, cisão e
 * incorporação. A trava cobra os FATOS: as datas que saem, o que fica fora do
 * arquivo e a recusa fora das exceções.
 */
const ok = (r: ReturnType<typeof conferirPeriodoDaGeracao>) => {
    if (!r.ok) throw new Error(r.erro);
    return r.valor;
};

describe('conferirPeriodoDaGeracao — a porta', () => {
    it('sem nada: arquivo mensal normal', () => {
        expect(ok(conferirPeriodoDaGeracao({ competencia: '2026-09' }))).toBeNull();
    });

    it('encerramento em 15/09: DT_INI 01092026 e DT_FIN 15092026', () => {
        const v = ok(conferirPeriodoDaGeracao({ competencia: '2026-09', dataInicio: '2026-09-01', dataFim: '2026-09-15', situacao: 'encerramento' }))!;
        expect(v.dtIni).toBe('01092026');
        expect(v.dtFin).toBe('15092026');
        expect(v.parcial).toBe(true);
    });

    it('terminar antes do fim do mês SEM situação é recusa que diz o porquê', () => {
        const r = conferirPeriodoDaGeracao({ competencia: '2026-09', dataInicio: '2026-09-01', dataFim: '2026-09-15' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.erro).toMatch(/ENCERRAMENTO/);
    });

    it('encerramento não move o DT_INI', () => {
        const r = conferirPeriodoDaGeracao({ competencia: '2026-09', dataInicio: '2026-09-05', dataFim: '2026-09-15', situacao: 'encerramento' });
        expect(r.ok).toBe(false);
    });

    it('início de atividades move o DT_INI, e só ele', () => {
        expect(ok(conferirPeriodoDaGeracao({ competencia: '2026-09', dataInicio: '2026-09-10', situacao: 'abertura' }))!.dtIni).toBe('10092026');
        expect(conferirPeriodoDaGeracao({ competencia: '2026-09', dataInicio: '2026-09-10', dataFim: '2026-09-20', situacao: 'abertura' }).ok).toBe(false);
    });

    it('cisão, fusão e incorporação movem o DT_FIN como o encerramento', () => {
        for (const situacao of ['cisao', 'fusao', 'incorporacao']) {
            expect(ok(conferirPeriodoDaGeracao({ competencia: '2026-09', dataFim: '2026-09-20', situacao }))!.dtFin).toBe('20092026');
        }
    });

    it('período fora da competência, invertido ou ilegível é recusado', () => {
        expect(conferirPeriodoDaGeracao({ competencia: '2026-09', dataFim: '2026-10-02', situacao: 'encerramento' }).ok).toBe(false);
        expect(conferirPeriodoDaGeracao({ competencia: '2026-09', dataInicio: '2026-09-20', dataFim: '2026-09-10', situacao: 'abertura' }).ok).toBe(false);
        expect(conferirPeriodoDaGeracao({ competencia: '2026-09', dataFim: '31/09/2026', situacao: 'encerramento' }).ok).toBe(false);
        expect(conferirPeriodoDaGeracao({ competencia: '2026-09', dataFim: '2026-09-15', situacao: 'baixa' }).ok).toBe(false);
    });

    it('encerramento no último dia do mês é legítimo e não é parcial', () => {
        const v = ok(conferirPeriodoDaGeracao({ competencia: '2028-02', situacao: 'encerramento' }))!;
        expect(v.dtFin).toBe('29022028');
        expect(v.parcial).toBe(false);
    });
});

describe('recortarNotasPeloPeriodo — o que fica fora é dito', () => {
    const periodo = { isoIni: '2026-09-01', isoFim: '2026-09-15' };

    it('usa a MESMA data do DT_E_S: entrada declarada, senão saída/entrada, senão emissão', () => {
        expect(dataDoDocumentoNoLivro({ dataEntrada: '2026-09-20', dhEmi: '2026-09-10T10:00:00-03:00' })).toBe('2026-09-20');
        expect(dataDoDocumentoNoLivro({ dhSaiEnt: '2026-09-16T08:00:00-03:00', dhEmi: '2026-09-15T10:00:00-03:00' })).toBe('2026-09-16');
        // A data é a do TEXTO da nota: 23h30 em BRT não vira o dia seguinte.
        expect(dataDoDocumentoNoLivro({ dhEmi: '2026-09-15T23:30:00-03:00' })).toBe('2026-09-15');
    });

    it('nota depois do evento sai do arquivo e entra no aviso com o número', () => {
        const r = recortarNotasPeloPeriodo([
            { numero: '10', dhEmi: '2026-09-10T10:00:00-03:00' },
            { numero: '11', dhEmi: '2026-09-15T23:30:00-03:00' },
            { numero: '12', dataEntrada: '2026-09-20', dhEmi: '2026-09-12T10:00:00-03:00' },
        ], periodo);
        expect(r.docs.map((n: any) => n.numero)).toEqual(['10', '11']);
        expect(r.fora).toHaveLength(1);
        expect(r.avisos.join(' ')).toMatch(/nº 12 \(20\/09\/2026\)/);
    });

    it('sem data legível fica no arquivo, e o aviso diz', () => {
        const r = recortarNotasPeloPeriodo([{ numero: '99' }], periodo);
        expect(r.docs).toHaveLength(1);
        expect(r.semData).toBe(1);
        expect(r.avisos.join(' ')).toMatch(/sem data legível/);
    });

    it('sem período: nada muda', () => {
        const notas = [{ numero: '1', dhEmi: '2026-09-30' }];
        expect(recortarNotasPeloPeriodo(notas, null).docs).toBe(notas);
    });
});

describe('os registros com período seguem o 0000', () => {
    const periodoArquivo = { dtIni: '01092026', dtFin: '15092026' };

    it('E100 sai com o período do encerramento', () => {
        const linhas: string[] = buildBlocoE({
            empresa: { cnpj: '11111111000191', dadosFiscais: { uf: 'SP' } },
            competenciaInicio: '2026-09', competenciaFim: '2026-09',
            notas: [], itens: [], warnings: [], periodoArquivo,
        });
        expect(linhas.find((l) => l.startsWith('|E100|'))).toMatch(/^\|E100\|01092026\|15092026\|/);
    });

    it('sem período conferido, o mês inteiro como sempre', () => {
        const linhas: string[] = buildBlocoE({
            empresa: { cnpj: '11111111000191', dadosFiscais: { uf: 'SP' } },
            competenciaInicio: '2026-09', competenciaFim: '2026-09', notas: [], itens: [], warnings: [],
        });
        expect(linhas.find((l) => l.startsWith('|E100|'))).toMatch(/^\|E100\|01092026\|30092026\|/);
    });

    it('Bloco H do encerramento: inventário exigido, com a data do evento', () => {
        const linhas: string[] = buildBlocoH({
            empresa: { cnpj: '11111111000191', dadosFiscais: { uf: 'SP' } },
            competenciaInicio: '2026-09', competenciaFim: '2026-09',
            inventarioNoEvento: '2026-09-15', inventarioMotInv: '03',
            itens: [{ codItem: 'TEC1', unidade: 'M', qtdInventario: 120, vlUnitInventario: 8.5, indPropInventario: '0', tipo: '00' }],
            warnings: [],
        });
        expect(linhas.find((l) => l.startsWith('|H005|'))).toMatch(/^\|H005\|15092026\|1020,00\|03\|/);
    });

    it('Bloco H do encerramento sem contagem: vazio, nunca zerado', () => {
        const warnings: string[] = [];
        const linhas: string[] = buildBlocoH({
            empresa: { cnpj: '11111111000191', dadosFiscais: { uf: 'SP' } },
            competenciaInicio: '2026-09', competenciaFim: '2026-09',
            inventarioNoEvento: '2026-09-15',
            itens: [{ codItem: 'TEC1', unidade: 'M', tipo: '00' }],
            warnings,
        });
        expect(linhas.some((l) => l.startsWith('|H005|'))).toBe(false);
        expect(warnings.join(' ')).toMatch(/INVENTÁRIO NÃO INFORMADO/);
    });
});

describe('pré-validação R20 com a exceção declarada', () => {
    const linha0000 = '|0000|020|0|01092026|15092026|VINATEX|32602701000278||SP|123456789110|3550308|||A|1|';
    const r20 = (ctx: any) => prevalidarSpedFiscal([linha0000], ctx).erros.filter((e: any) => e.regra === 'periodo-nao-e-mes-inteiro');

    it('DT_FIN no meio do mês sem exceção declarada é acusado', () => {
        expect(r20({})).toHaveLength(1);
    });

    it('com o encerramento declarado na geração, não é acusado', () => {
        expect(r20({ periodoFimDoEvento: true })).toHaveLength(0);
    });

    it('declarar início de atividades não libera o DT_FIN', () => {
        expect(r20({ periodoInicioDoEvento: true })).toHaveLength(1);
    });
});

describe('varredura: nenhum registro do EFD ICMS/IPI monta período próprio', () => {
    const dir = join(__dirname, '..', 'sefaz-backend');
    const fontes = readdirSync(dir)
        .filter((f) => /^sped-(fiscal|bloco)-.*\.js$/.test(f) && f !== 'sped-fiscal-format.js')
        .map((f) => ({ f, src: readFileSync(join(dir, f), 'utf8') }));

    it('DT_INI/DT_FIN só pelo dono (fmt.dtIniDoArquivo / dtFinDoArquivo)', () => {
        expect(fontes.length).toBeGreaterThan(5);
        for (const { f, src } of fontes) {
            expect({ f, cru: /formatCompetencia(Inicio|Fim)\(/.test(src) }).toEqual({ f, cru: false });
        }
    });

    it('a coleta recorta as notas pelo período e a rota confere a porta', () => {
        const orq = readFileSync(join(dir, 'sped-fiscal-orchestrator.js'), 'utf8');
        expect(orq).toMatch(/recortarNotasPeloPeriodo\(/);
        const rotas = readFileSync(join(dir, 'sped-fiscal-routes.js'), 'utf8');
        expect(rotas).toMatch(/conferirPeriodoDaGeracao\(/);
    });
});

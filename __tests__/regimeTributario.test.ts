/**
 * regimeTributario — imune, isenta e terceiro setor no cadastro do CFI.
 *
 * Paulo, 18/08, com o print do cadastro do CCI: *"criamos no CCI que as
 * informações de cadastro sejam compartilhadas do CFI… ocorre que temos empresas
 * Optantes pelo Simples Nacional, Lucro Presumido, Lucro Real, isentas, imunes —
 * devemos nos atentar às empresas que são isentas/imunes e terceiro setor"*.
 *
 * No print, a **COMUNIDADE EVANGÉLICA SARA NOSSA TERRA** — uma igreja — aparecia
 * como *"Regime tributário — cadastro do CFI: Lucro Presumido"*.
 *
 * 🚨 O rótulo é o sintoma; a causa é que o CFI DEDUZIA o regime da COLEÇÃO em
 * que a empresa foi cadastrada, e não existia lugar para "imune". A consequência
 * cara não é o rótulo: é a entidade herdar a lista e as apurações do Presumido —
 * PIS/COFINS sobre FATURAMENTO em quem, em regra, recolhe PIS sobre a FOLHA
 * (Lei 9.532/97 art. 13).
 */
// @ts-ignore — módulo JS do backend
import {
    regimeDaEmpresa, normalizarRegime, rotuloRegime, semFinsLucrativos,
    validarRegimeParaGravacao, REGIMES, REGIMES_VALIDOS,
// @ts-ignore
} from '../sefaz-backend/regime-tributario.js';
// @ts-ignore
import { resolverRegime } from '../sefaz-backend/catalogo-obrigacoes.js';
// @ts-ignore
import { normalizarEmpresaCadastro } from '../sefaz-backend/cadastro-central.js';

describe('o vocabulário cobre o que o Paulo nomeou', () => {
    it('os cinco regimes existem', () => {
        expect(REGIMES_VALIDOS.sort()).toEqual(
            ['IMUNE', 'ISENTA', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'SIMPLES'],
        );
    });

    it('imune e isenta declaram que a apuração NÃO está definida', () => {
        expect(REGIMES.IMUNE.apuracao).toBe(false);
        expect(REGIMES.ISENTA.apuracao).toBe(false);
        // E cada uma carrega a ressalva escrita — silêncio aqui vira herança.
        expect(REGIMES.IMUNE.ressalva).toMatch(/NÃO está definida/);
        expect(REGIMES.ISENTA.ressalva).toMatch(/NÃO está definida/);
    });

    it('normaliza o que o cadastro antigo escrevia, sem chutar o resto', () => {
        expect(normalizarRegime('presumido')).toBe('LUCRO_PRESUMIDO');
        expect(normalizarRegime('Lucro Real')).toBe('LUCRO_REAL');
        expect(normalizarRegime('IMUNE')).toBe('IMUNE');
        expect(normalizarRegime('isento')).toBe('ISENTA');
        expect(normalizarRegime('MEI')).toBeNull();
        expect(normalizarRegime('')).toBeNull();
        expect(normalizarRegime(null)).toBeNull();
    });

    it('rótulo de regime desconhecido não vira frase bonita', () => {
        expect(rotuloRegime('IMUNE')).toBe('Imune');
        expect(rotuloRegime('INDEFINIDO')).toBe('Indefinido');
        expect(rotuloRegime('XPTO')).toBe('XPTO');
    });
});

describe('precedência: o campo vence a coleção', () => {
    it('🚨 a igreja do print deixa de ser Lucro Presumido', () => {
        const igreja = {
            cnpj: '10639829000192',
            razaoSocial: 'COMUNIDADE EVANGELICA SARA NOSSA TERRA DA ILHA DO GOVERNADOR',
            colecao: 'lucro_empresas',
            regimePadrao: 'presumido',
            regimeTributario: 'IMUNE',
        };
        const v = regimeDaEmpresa(igreja);
        expect(v.regime).toBe('IMUNE');
        expect(v.origem).toBe('cadastro');
        expect(v.apuracaoDefinida).toBe(false);
    });

    it('sem o campo, a coleção ainda responde — e a ORIGEM diz que foi deduzido', () => {
        expect(regimeDaEmpresa({ colecao: 'simples_empresas' })).toMatchObject({
            regime: 'SIMPLES', origem: 'colecao',
        });
        expect(regimeDaEmpresa({ colecao: 'lucro_empresas', regimePadrao: 'real' })).toMatchObject({
            regime: 'LUCRO_REAL', origem: 'regimePadrao',
        });
    });

    it('o campo também é lido de dadosFiscais', () => {
        expect(regimeDaEmpresa({ colecao: 'lucro_empresas', dadosFiscais: { regimeTributario: 'isenta' } }))
            .toMatchObject({ regime: 'ISENTA', origem: 'cadastro' });
    });

    it('Lucro sem regimePadrão continua INDEFINIDO e dizendo por quê', () => {
        const v = regimeDaEmpresa({ colecao: 'lucro_empresas' });
        expect(v.regime).toBe('INDEFINIDO');
        expect(v.motivo).toMatch(/Regime padrão/);
    });
});

describe('🚨 imune e isenta NÃO herdam a lista do Presumido', () => {
    it('resolverRegime devolve INDEFINIDO, com o regime declarado NOMEADO', () => {
        const r = resolverRegime({ colecao: 'lucro_empresas', regimePadrao: 'presumido', regimeTributario: 'IMUNE' });
        // INDEFINIDO aqui não é "não sabemos o que ela é" — é "não sabemos o que
        // ela DEVE". O que ela é vai junto, escrito.
        expect(r.regime).toBe('INDEFINIDO');
        expect(r.regimeDeclarado).toBe('IMUNE');
        expect(r.motivo).toMatch(/Imune/);
        expect(r.motivo).toMatch(/NÃO aplica a lista do Lucro Presumido/);
    });

    it('e o mesmo para a isenta', () => {
        const r = resolverRegime({ colecao: 'lucro_empresas', regimeTributario: 'ISENTA' });
        expect(r.regime).toBe('INDEFINIDO');
        expect(r.regimeDeclarado).toBe('ISENTA');
    });

    it('quem TEM apuração definida segue igual — nada regride', () => {
        expect(resolverRegime({ colecao: 'simples_empresas' })).toMatchObject({ regime: 'SIMPLES' });
        expect(resolverRegime({ colecao: 'lucro_empresas', regimePadrao: 'presumido' }))
            .toMatchObject({ regime: 'LUCRO_PRESUMIDO' });
        expect(resolverRegime({ colecao: 'lucro_empresas', regimePadrao: 'real' }))
            .toMatchObject({ regime: 'LUCRO_REAL' });
    });
});

describe('terceiro setor é EIXO SEPARADO, não item da lista', () => {
    it('não se deduz do regime nos dois sentidos', () => {
        // Imune que não é entidade sem fins lucrativos existe (livro, jornal).
        expect(semFinsLucrativos({ regimeTributario: 'IMUNE' })).toBe(false);
        // E associação tributada pelo Presumido existe.
        expect(semFinsLucrativos({ regimeTributario: 'LUCRO_PRESUMIDO', semFinsLucrativos: true })).toBe(true);
    });

    it('vale marcado em dadosFiscais também', () => {
        expect(semFinsLucrativos({ dadosFiscais: { semFinsLucrativos: true } })).toBe(true);
        expect(semFinsLucrativos({})).toBe(false);
    });
});

describe('gravação recusa o que não conhece — nunca descarta em silêncio', () => {
    it('valor fora do vocabulário volta com a lista do que vale', () => {
        const r = validarRegimeParaGravacao('MEI');
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/Simples Nacional/);
        expect(r.motivo).toMatch(/Imune/);
    });

    it('vazio é resposta válida (ainda não classificada)', () => {
        expect(validarRegimeParaGravacao('')).toEqual({ ok: true, regime: null });
        expect(validarRegimeParaGravacao(null)).toEqual({ ok: true, regime: null });
    });

    it('sinônimo do cadastro antigo passa, normalizado', () => {
        expect(validarRegimeParaGravacao('presumido')).toEqual({ ok: true, regime: 'LUCRO_PRESUMIDO' });
    });
});

describe('o túnel entrega o regime de verdade aos apps irmãos', () => {
    const igreja = normalizarEmpresaCadastro({
        id: 'x1',
        cnpj: '10.639.829/0001-92',
        razaoSocial: 'COMUNIDADE EVANGELICA SARA NOSSA TERRA DA ILHA DO GOVERNADOR',
        regimeTributario: 'IMUNE',
        semFinsLucrativos: true,
        dadosFiscais: {},
    }, 'lucro');

    it('o CCI passa a receber IMUNE, não "Lucro Presumido"', () => {
        expect(igreja.regimeTributario).toBe('IMUNE');
        expect(igreja.regimeTributarioRotulo).toBe('Imune');
        expect(igreja.semFinsLucrativos).toBe(true);
    });

    it('e recebe a RESSALVA junto — silêncio não é "nada a fazer"', () => {
        expect(igreja.regimeApuracaoDefinida).toBe(false);
        expect(igreja.regimeRessalva).toMatch(/obrigação acessória/);
    });

    it('a ORIGEM viaja: o irmão distingue o que foi DITO do que foi DEDUZIDO', () => {
        expect(igreja.regimeOrigem).toBe('cadastro');
        const semCampo = normalizarEmpresaCadastro({ cnpj: '11222333000181', nome: 'X' }, 'lucro');
        expect(semCampo.regimeOrigem).toBe('colecao');
        expect(semCampo.regimeTributario).toBe('INDEFINIDO');
    });

    it('⚠️ o campo `regime` NÃO muda de significado — os irmãos já o consomem', () => {
        // Trocar o sentido de um campo em uso é a quebra que não dá erro.
        expect(igreja.regime).toBe('lucro');
        expect(normalizarEmpresaCadastro({ cnpj: '11222333000181', nome: 'X' }, 'simples').regime).toBe('simples');
    });
});

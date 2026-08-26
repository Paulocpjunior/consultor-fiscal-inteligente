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
import { resolverRegime, CATALOGO, obrigacoesAplicaveis } from '../sefaz-backend/catalogo-obrigacoes.js';
// @ts-ignore
import { normalizarEmpresaCadastro } from '../sefaz-backend/cadastro-central.js';

describe('o vocabulário cobre o que o Paulo nomeou', () => {
    it('os cinco regimes existem', () => {
        expect(REGIMES_VALIDOS.sort()).toEqual(
            ['IMUNE', 'ISENTA', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'SIMPLES'],
        );
    });

    // ⚠️ TESTE TROCADO EM 18/08, e a troca é o registro da decisão. A 1ª versão
    // exigia `apuracao: false` — o comportamento certo ENQUANTO ninguém tinha
    // decidido a lista. Paulo respondeu as três perguntas e a lista passou a
    // existir; exigir o contrário agora seria travar o app na dúvida antiga.
    it('imune e isenta têm lista própria, e a ressalva diz QUAL é', () => {
        expect(REGIMES.IMUNE.apuracao).toBe(true);
        expect(REGIMES.ISENTA.apuracao).toBe(true);
        for (const r of [REGIMES.IMUNE, REGIMES.ISENTA]) {
            expect(r.ressalva).toMatch(/não dispensa obrigação acessória|dispensa de obrigação acessória/);
            expect(r.ressalva).toMatch(/apenas em dezembro/);
        }
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
        // A lista dela EXISTE desde 18/08 — mas a ressalva continua viajando,
        // porque é ela que diz o que a entidade deve e o que não deve.
        expect(v.apuracaoDefinida).toBe(true);
        expect(v.motivo).toMatch(/dezembro/);
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
    it('o regime é o DELAS, não INDEFINIDO nem Presumido', () => {
        expect(resolverRegime({ colecao: 'lucro_empresas', regimePadrao: 'presumido', regimeTributario: 'IMUNE' }))
            .toMatchObject({ regime: 'IMUNE' });
        expect(resolverRegime({ colecao: 'lucro_empresas', regimeTributario: 'ISENTA' }))
            .toMatchObject({ regime: 'ISENTA' });
    });

    it('🚨 e a lista NÃO tem PIS/COFINS mensal nem EFD ICMS/IPI', () => {
        const obrigacoes = CATALOGO.IMUNE.map((o: any) => o.obrigacao);
        // Era isto que a herança do Presumido punha numa igreja.
        expect(obrigacoes).not.toContain('PIS_COFINS');
        expect(obrigacoes).not.toContain('SPED');
        expect(CATALOGO.ISENTA).toBe(CATALOGO.IMUNE);
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

    it('e recebe a RESSALVA junto — com a lista, não só com o aviso', () => {
        expect(igreja.regimeApuracaoDefinida).toBe(true);
        expect(igreja.regimeRessalva).toMatch(/obrigação acessória/);
        // A ressalva agora DIZ as obrigações, que é o que o CCI precisa.
        expect(igreja.regimeRessalva).toMatch(/DCTFWeb só com evento/);
        expect(igreja.regimeRessalva).toMatch(/apenas em dezembro/);
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

// ═══════════════════════════════════════════════════════════════════════════
// AS TRÊS RESPOSTAS DO PAULO (18/08) — cada uma virou entrada do catálogo
// ═══════════════════════════════════════════════════════════════════════════
describe('a lista da imune e da isenta é a que ele respondeu', () => {
    const porNome = (n: string): any => CATALOGO.IMUNE.find((o: any) => o.obrigacao === n)!;

    it('1 · ECD e ECF: "entrega se tiver movimento financeiro"', () => {
        for (const n of ['ECD', 'ECF']) {
            const o = porNome(n);
            expect(o.status).toBe('proposta');
            expect(o.dependeDe).toMatch(/movimento financeiro/);
        }
    });

    it('2 · DCTFWeb: "apenas quando houver eventos (aluguel/folha/retidos)"', () => {
        const o = porNome('DCTFWEB');
        expect(o.status).toBe('proposta');
        expect(o.dependeDe).toMatch(/aluguel, folha ou retenção/);
    });

    it('3 · EFD-Contribuições: "apenas em dezembro, indicando sem movimento"', () => {
        const o = porNome('EFD_CONTRIB');
        expect(o.frequencia).toBe('anual');
        expect(o.status).toBe('ativa');
        // `frequencia: 'anual'` já quer dizer "competência que fecha o ano".
        expect(obrigacoesAplicaveis('IMUNE', '12/2026').map((x: any) => x.obrigacao)).toContain('EFD_CONTRIB');
        expect(obrigacoesAplicaveis('IMUNE', '07/2026').map((x: any) => x.obrigacao)).not.toContain('EFD_CONTRIB');
    });

    it('🚩 o fim de vigência de 12/2026 é EXPECTATIVA — o app segue gerando e DIZ', () => {
        const o = porNome('EFD_CONTRIB');
        expect(o.vigenciaAteEsperada).toBe('12/2026');
        expect(o.vigenciaRessalva).toMatch(/reforma tributária/);
        // Parar de gerar por causa de expectativa faria a obrigação sumir em
        // silêncio — e sumir da tela é pior que aparecer com ressalva.
        expect(obrigacoesAplicaveis('IMUNE', '12/2027').map((x: any) => x.obrigacao)).toContain('EFD_CONTRIB');
    });

    // ⚠️ TESTE TROCADO EM 18/08, e a troca é o registro da decisão. Eu tinha
    // incluído FGTS como EXTENSÃO MINHA (ele citou FOLHA entre os eventos da
    // DCTFWeb, e FGTS é consequência de folha) e marquei para confirmar. Paulo
    // respondeu: "FGTS é um imposto gerado pelo departamento pessoal, não faz
    // base para impostos gerados pelo CFI". Mesmo com folha, não é obrigação
    // que este catálogo acompanha — é do módulo de DP.
    it('🚫 FGTS NÃO entra na lista — é do departamento pessoal, não do CFI', () => {
        const obrigacoes = CATALOGO.IMUNE.map((o: any) => o.obrigacao);
        expect(obrigacoes).not.toContain('FGTS');
    });

    it('mês comum de uma imune não gera tarefa nenhuma — e isso é o certo', () => {
        expect(obrigacoesAplicaveis('IMUNE', '07/2026')).toHaveLength(0);
    });
});

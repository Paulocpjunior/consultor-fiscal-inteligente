/**
 * Testes do verificador de cadastros incompletos das empresas.
 * Errar aqui = bloquear geração SPED ou cálculo DAS sem aviso claro.
 */
// @ts-expect-error — módulo .js puro
import { pendenciasCadastro, gravidadeCadastro } from '../sefaz-backend/diagnostico-cadastros-helper.js';

describe('pendenciasCadastro — campos críticos', () => {
    it('empresa SIMPLES completa → zero pendências', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190',
            nome: 'Acme',
            anexo: 'III',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', cnae: '6201500' },
        }, 'simples');
        expect(r).toHaveLength(0);
    });

    // 🚨 A FIXTURE MUDOU EM 26/08 e a TROCA É O CERTO: ela usava
    // `tipoTributacao`, um campo que **não existe em lugar nenhum do app** —
    // nenhuma tela grava, nenhum gerador lê, nenhum importador preenche. Ele
    // aparecia em DOIS lugares no repo inteiro: no helper, que o exigia, e
    // aqui, descrevendo a exigência. O teste descrevia um mundo que a produção
    // não vive, e como ninguém o preenche a pendência nascia em 100% das
    // empresas do Lucro (236 em ALTO no painel do Paulo).
    // O que a tela DE FATO grava é `dadosFiscais.regimeTributario` (18/08).
    it('empresa LUCRO completa → zero pendências', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190',
            nome: 'Acme',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', regimeTributario: 'LUCRO_PRESUMIDO' },
        }, 'lucro');
        expect(r).toHaveLength(0);
    });

    // 🚨 O CASO DO PRINT: A CASTELLANO, com "Lucro Presumido" escolhido no
    // modal, aparecia em ALTO dizendo "Tipo (Presumido/Real) não definido".
    it('regime escolhido no modal APAGA a pendência — o caso A CASTELLANO', () => {
        const r = pendenciasCadastro({
            cnpj: '51227692000146', nome: 'A CASTELLANO INDUSTRIA METALURGICA LTDA',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3509502', regimeTributario: 'LUCRO_PRESUMIDO' },
        }, 'lucro');
        expect(r).toHaveLength(0);
        expect(gravidadeCadastro(r)).toBe('ok');
    });

    // ⚠️ A precedência é a do DONO: `regimePadrao` também define a apuração, e
    // exigir o campo novo de quem já tem o antigo seria pedir trabalho por um
    // dado que o app já tem.
    it('`regimePadrao` na ficha também resolve', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'X', regimePadrao: 'lucro_real',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' },
        }, 'lucro');
        // ⚠️ A ASSERÇÃO ESTREITOU EM 27/08, e a troca é o certo: ela dizia
        // `toHaveLength(0)`, que descrevia o mundo em que o diagnóstico só
        // conhecia seis campos. O que este teste protege é a PRECEDÊNCIA do
        // regime — e o Lucro Real ganhou uma pendência PRÓPRIA e legítima
        // (IND_APRO_CRED do 0110), que nada tem a ver com ela.
        expect(r.map((p: any) => p.campo)).not.toContain('dadosFiscais.regimeTributario');
    });

    // ⚠️ E IMUNE/ISENTA não são "regime indefinido": são regimes próprios
    // (18/08, o caso da igreja que aparecia como Lucro Presumido).
    it('entidade IMUNE não vira pendência de regime', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'IGREJA',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', regimeTributario: 'IMUNE' },
        }, 'lucro');
        expect(r.find((p: any) => p.campo.endsWith('regimeTributario'))).toBeFalsy();
    });

    it('CNPJ inválido → pendência com impacto "TUDO"', () => {
        const r = pendenciasCadastro({ cnpj: '123', nome: 'X', dadosFiscais: { uf: 'SP', codMunIBGE: '1' } }, 'simples');
        const cnpj = r.find((p: any) => p.campo === 'cnpj');
        expect(cnpj).toBeTruthy();
        expect(cnpj.impacto).toMatch(/TUDO/);
    });

    it('CNPJ ausente → pendência', () => {
        const r = pendenciasCadastro({ nome: 'X', dadosFiscais: { uf: 'SP', codMunIBGE: '1' } }, 'simples');
        expect(r.find((p: any) => p.campo === 'cnpj')).toBeTruthy();
    });

    it('sem UF → pendência crítica (SPED não gera)', () => {
        const r = pendenciasCadastro({ cnpj: '12345678000190', dadosFiscais: { codMunIBGE: '1' } }, 'simples');
        const uf = r.find((p: any) => p.campo === 'dadosFiscais.uf');
        expect(uf).toBeTruthy();
        expect(uf.impacto).toMatch(/SPED/);
    });

    it('sem codMunIBGE → pendência crítica', () => {
        const r = pendenciasCadastro({ cnpj: '12345678000190', dadosFiscais: { uf: 'SP' } }, 'simples');
        expect(r.find((p: any) => p.campo === 'dadosFiscais.codMunIBGE')).toBeTruthy();
    });

    it('Simples sem anexo → pendência', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'X',
            dadosFiscais: { uf: 'SP', codMunIBGE: '1' },
        }, 'simples');
        expect(r.find((p: any) => p.campo === 'anexo')).toBeTruthy();
    });

    it('Lucro NÃO exige anexo (mas exige o regime, quando ele falta de verdade)', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'X',
            dadosFiscais: { uf: 'SP', codMunIBGE: '1' },
        }, 'lucro');
        expect(r.find((p: any) => p.campo === 'anexo')).toBeFalsy();
        const reg = r.find((p: any) => p.campo === 'dadosFiscais.regimeTributario');
        expect(reg).toBeTruthy();
        // 📌 E ela APONTA O LUGAR — pendência sem caminho de resolução foi
        // exatamente o defeito que este PR fecha.
        expect(reg.descricao).toMatch(/Dados Fiscais/);
    });

    it('empresa null/undefined → array vazio (defensivo)', () => {
        expect(pendenciasCadastro(null, 'simples')).toEqual([]);
        expect(pendenciasCadastro(undefined, 'lucro')).toEqual([]);
    });
});

describe('gravidadeCadastro — classificação', () => {
    it('sem pendências → ok', () => {
        expect(gravidadeCadastro([])).toBe('ok');
    });

    it('cnpj inválido → crítico (qualquer outra pendência junto)', () => {
        const g = gravidadeCadastro([{ campo: 'cnpj', descricao: 'x', impacto: 'y' }]);
        expect(g).toBe('critico');
    });

    it('faltando UF → crítico', () => {
        const g = gravidadeCadastro([{ campo: 'dadosFiscais.uf', descricao: 'x', impacto: 'y' }]);
        expect(g).toBe('critico');
    });

    it('faltando codMunIBGE → crítico', () => {
        expect(gravidadeCadastro([{ campo: 'dadosFiscais.codMunIBGE', descricao: 'x', impacto: 'y' }])).toBe('critico');
    });

    it('faltando anexo (Simples) → alto', () => {
        expect(gravidadeCadastro([{ campo: 'anexo', descricao: 'x', impacto: 'y' }])).toBe('alto');
    });

    it('faltando o regime (Lucro) → alto', () => {
        expect(gravidadeCadastro([{ campo: 'dadosFiscais.regimeTributario', descricao: 'x', impacto: 'y' }]))
            .toBe('alto');
    });

    it('só faltando CNAE → médio', () => {
        expect(gravidadeCadastro([{ campo: 'cnae', descricao: 'x', impacto: 'y' }])).toBe('medio');
    });

    it('só faltando nome → médio', () => {
        expect(gravidadeCadastro([{ campo: 'nome', descricao: 'x', impacto: 'y' }])).toBe('medio');
    });

    it('múltiplas pendências — pior dominante', () => {
        const g = gravidadeCadastro([
            { campo: 'nome', descricao: 'x', impacto: 'y' },
            { campo: 'dadosFiscais.uf', descricao: 'x', impacto: 'y' },
            { campo: 'cnae', descricao: 'x', impacto: 'y' },
        ]);
        expect(g).toBe('critico');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚦 OS CAMPOS QUE TRAVAM O ARQUIVO DO SPED
//
// O diagnóstico cobria seis campos e NENHUM deles é o que faz o PVA recusar.
// Os que fazem são de tabela oficial, o app se recusa a deduzi-los, e a falta
// só aparecia na hora de gerar — uma volta de validador por vez, que é o
// gargalo nomeado em 20/08.
//
// 🚨 A TRAVA QUE MANDA É "SÓ ACUSA QUEM PRECISA": cobrar classificação de
// estabelecimento industrial de um comércio faria a carteira inteira nascer em
// âmbar por campo que ninguém daquele grupo vai preencher — é o `tipoTributacao`
// de 26/08, em que 234 das 236 acusações eram falsas.
// ════════════════════════════════════════════════════════════════════════════
describe('🚦 pendências que travam o SPED', () => {
    const lucro = (df: any = {}, over: any = {}) => ({
        cnpj: '12345678000190', nome: 'Acme', regimePadrao: 'LUCRO_PRESUMIDO',
        dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', ...df },
        ...over,
    });
    const campos = (e: any, reg = 'lucro') => pendenciasCadastro(e, reg).map((p: any) => p.campo);

    // 🔒 O caso comum NASCE VERDE — é isto que separa esta régua do fantasma.
    it('empresa comum do Lucro em SP não ganha NENHUMA pendência nova', () => {
        expect(pendenciasCadastro(lucro(), 'lucro')).toHaveLength(0);
    });

    it('e a empresa do Simples também não — nada disto é do regime dela', () => {
        expect(pendenciasCadastro({
            cnpj: '12345678000190', nome: 'Acme', anexo: 'III',
            dadosFiscais: { uf: 'PR', codMunIBGE: '4106902', cnae: '6201500', inscricaoEstadual: '123' },
        }, 'simples')).toHaveLength(0);
    });

    describe('0002 — classificação do estabelecimento industrial', () => {
        it('contribuinte de IPI sem a classificação é ALTO: o PVA RECUSA o arquivo', () => {
            const p = pendenciasCadastro(lucro({ contribuinteIpi: 'sim' }), 'lucro');
            expect(p.map((x: any) => x.campo)).toEqual(['dadosFiscais.classEstabIpi']);
            expect(p[0].impacto).toMatch(/RECUSA/);
            expect(gravidadeCadastro(p)).toBe('alto');
        });

        it('⚠️ mas o comércio NÃO é cobrado — ele não tem esse registro', () => {
            expect(campos(lucro({ contribuinteIpi: 'nao' }))).toEqual([]);
            expect(campos(lucro())).toEqual([]);
        });

        it('e some quando o campo é preenchido', () => {
            expect(campos(lucro({ contribuinteIpi: 'sim', classEstabIpi: '01' }))).toEqual([]);
        });
    });

    describe('0000 — natureza da PJ (IND_NAT_PJ)', () => {
        it('entidade IMUNE sem o código é ALTO: o arquivo declara "sociedade empresária em geral"', () => {
            const p = pendenciasCadastro(lucro({ regimeTributario: 'IMUNE' }, { regimePadrao: null }), 'lucro');
            expect(p.map((x: any) => x.campo)).toContain('dadosFiscais.indNatPJ');
            expect(gravidadeCadastro(p)).toBe('alto');
        });

        it('vale também para a ISENTA e para quem é sem fins lucrativos', () => {
            expect(campos(lucro({ regimeTributario: 'ISENTA' }, { regimePadrao: null })))
                .toContain('dadosFiscais.indNatPJ');
            expect(campos(lucro({ semFinsLucrativos: true })))
                .toContain('dadosFiscais.indNatPJ');
        });

        // ⚠️ São EIXOS SEPARADOS: sociedade empresária comum declara '00' e o
        // '00' está CERTO nela — cobrar seria alarme sem ação na carteira toda.
        it('⚠️ a LTDA comum não é cobrada — nela o "00" é a resposta certa', () => {
            expect(campos(lucro())).toEqual([]);
        });
    });

    describe('0110 — apropriação de crédito de PIS/COFINS', () => {
        it('Lucro Real sem o método é MÉDIO: o arquivo sai, mas com "2" cravado', () => {
            const p = pendenciasCadastro(lucro({}, { regimePadrao: 'LUCRO_REAL' }), 'lucro');
            expect(p.map((x: any) => x.campo)).toEqual(['dadosFiscais.indAproCredPisCofins']);
            expect(gravidadeCadastro(p)).toBe('medio');
        });

        it('⚠️ o Presumido não é cobrado — no cumulativo não há crédito a apropriar', () => {
            expect(campos(lucro())).toEqual([]);
        });
    });

    describe('0500 — a conta contábil é TUDO OU NADA', () => {
        it('conta cadastrada sem nome e sem nível cobra os dois', () => {
            expect(campos(lucro({ contaContabilReceitaFinanceira: '30106030012' })))
                .toEqual([
                    'dadosFiscais.contaContabilReceitaFinanceiraNome',
                    'dadosFiscais.contaContabilReceitaFinanceiraNivel',
                ]);
        });

        // ⚠️ Quem NÃO cadastrou conta nenhuma não tem receita financeira a
        // declarar — cobrar dela seria inventar uma obrigação.
        it('⚠️ quem não cadastrou conta não é cobrado', () => {
            expect(campos(lucro())).toEqual([]);
        });

        it('conta inteira não gera pendência', () => {
            expect(campos(lucro({
                contaContabilReceitaFinanceira: '30106030012',
                contaContabilReceitaFinanceiraNome: 'RENDIMENTOS FINANCEIROS',
                contaContabilReceitaFinanceiraNivel: '5',
            }))).toEqual([]);
        });
    });

    describe('E116 — o ICMS a recolher tem prazo e código ESTADUAIS', () => {
        it('contribuinte fora de SP é cobrado, e a frase NOMEIA a UF', () => {
            const p = pendenciasCadastro(lucro({ uf: 'PR', inscricaoEstadual: '123' }), 'lucro');
            expect(p.map((x: any) => x.campo)).toEqual([
                'dadosFiscais.icmsDiaVencimento', 'dadosFiscais.icmsCodRec',
            ]);
            expect(p[0].descricao).toMatch(/em PR/);
            expect(p[0].impacto).toMatch(/dia 20/);
        });

        // ⚠️ Em SP o padrão do gerador está certo no caso comum.
        it('⚠️ dentro de SP não é cobrado — o padrão do app é o prazo de lá', () => {
            expect(campos(lucro({ inscricaoEstadual: '123' }))).toEqual([]);
        });

        // ⚠️ Sem inscrição estadual a empresa não apura ICMS (serviço puro) —
        // o E116 nunca sai, e cobrar ali seria alarme sem ação.
        it('⚠️ empresa de serviço (sem IE) fora de SP não é cobrada', () => {
            expect(campos(lucro({ uf: 'PR' }))).toEqual([]);
        });
    });
});

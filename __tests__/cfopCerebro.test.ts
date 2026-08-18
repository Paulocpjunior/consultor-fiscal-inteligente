// ============================================================================
// 🧠 O CÉREBRO DO CFOP — a decisão humana vira parâmetro para as próximas notas.
//
// Paulo, 18/08: *"poderíamos fazer o ajuste manual da reclassificação… um
// cérebro que, quando o usuário faz a alteração de forma manual, ele deve
// gravar, criando um parâmetro para os próximos meses"*.
//
// ═══ O NÚMERO QUE JUSTIFICA E A MEDIÇÃO QUE DEFINIU A CHAVE ═════════════════
//
// No Relatório de Notas de um cliente (2.330 entradas em 6 meses), 914 notas
// (39%) foram escrituradas como uso/consumo ou ativo — destino que o XML NÃO
// carrega, porque o fornecedor emite 5102/5405 (para ELE é venda de mercadoria).
//
// E no mesmo arquivo: apenas 6 de 311 fornecedores aparecem em mais de um grupo
// de destino. O FORNECEDOR determina o destino em 98% dos casos — mas 98% não é
// 100%, e por isso a chave é fornecedor + CFOP DE ORIGEM, com "qualquer CFOP do
// fornecedor" como escopo mais largo. O mais específico vence.
// ============================================================================
import { parametroAplicavel, sugerirParametro, chaveParametro, rotuloParametro } from '../sefaz-backend/cfop-cerebro.js';
import { cfopDoLancamento, origemDoCfopLancamento } from '../sefaz-backend/cfop-correlacao.js';

const FORN = '11222333000181';
const OUTRO = '99888777000166';

const param = (over: any = {}) => ({
    cnpjFornecedor: FORN, cfopOrigem: '5405', cfopDestino: '1407',
    vigenciaInicio: '2026-07', ativo: true, criadoPor: 'colab@sp.com.br', ...over,
});
const nota = (competencia: string, cnpj = FORN) => ({ cnpjEmit: cnpj, competencia });
const ctx = (parametrosCfop: any[]) => ({ naturezaAtividade: 'comercio', parametrosCfop });

describe('a chave: fornecedor + CFOP de origem, e o mais específico vence', () => {
    it('escopo específico e escopo amplo têm chaves diferentes', () => {
        expect(chaveParametro(FORN, '5405')).toBe(`${FORN}|5405`);
        expect(chaveParametro(FORN, null)).toBe(`${FORN}|*`);
    });

    it('o específico ganha do amplo', () => {
        const ps = [param({ cfopOrigem: null, cfopDestino: '1556' }), param()];
        expect(parametroAplicavel(ps, { cnpjFornecedor: FORN, cfopOrigem: '5405', competencia: '2026-07' })?.cfopDestino)
            .toBe('1407');
    });

    it('e o amplo cobre o CFOP que o específico não pega', () => {
        const ps = [param({ cfopOrigem: null, cfopDestino: '1556' }), param()];
        expect(parametroAplicavel(ps, { cnpjFornecedor: FORN, cfopOrigem: '5102', competencia: '2026-07' })?.cfopDestino)
            .toBe('1556');
    });

    it('outro fornecedor não é alcançado', () => {
        expect(parametroAplicavel([param()], { cnpjFornecedor: OUTRO, cfopOrigem: '5405', competencia: '2026-07' }))
            .toBeNull();
    });
});

describe('🚨 VIGÊNCIA NÃO RETROAGE — mês já entregue não muda de CFOP sozinho', () => {
    it('competência anterior à do parâmetro fica de fora', () => {
        expect(parametroAplicavel([param()], { cnpjFornecedor: FORN, cfopOrigem: '5405', competencia: '2026-06' }))
            .toBeNull();
    });

    it('a competência de início já vale', () => {
        expect(parametroAplicavel([param()], { cnpjFornecedor: FORN, cfopOrigem: '5405', competencia: '2026-07' }))
            .toBeTruthy();
    });

    it('entre dois parâmetros que já começaram, vence o mais RECENTE', () => {
        const ps = [param({ cfopDestino: '1407' }), param({ cfopDestino: '1556', vigenciaInicio: '2026-09' })];
        expect(parametroAplicavel(ps, { cnpjFornecedor: FORN, cfopOrigem: '5405', competencia: '2026-10' })?.cfopDestino)
            .toBe('1556');
        // …e em agosto ainda vale o antigo: a régua resolve pela DATA do fato.
        expect(parametroAplicavel(ps, { cnpjFornecedor: FORN, cfopOrigem: '5405', competencia: '2026-08' })?.cfopDestino)
            .toBe('1407');
    });

    it('desligado não decide nada', () => {
        expect(parametroAplicavel([param({ ativo: false })], { cnpjFornecedor: FORN, cfopOrigem: '5405', competencia: '2026-07' }))
            .toBeNull();
    });

    it('sem competência ou sem fornecedor não se decide — ausência não vira palpite', () => {
        expect(parametroAplicavel([param()], { cnpjFornecedor: FORN, cfopOrigem: '5405', competencia: '' })).toBeNull();
        expect(parametroAplicavel([param()], { cnpjFornecedor: '', cfopOrigem: '5405', competencia: '2026-07' })).toBeNull();
    });
});

describe('🚨 a PRECEDÊNCIA: a NF vence o cérebro', () => {
    it('sem parâmetro, vale a régua automática', () => {
        expect(cfopDoLancamento(nota('2026-07'), '5405', 'entrada', ctx([]))).toBe('1403');
    });

    it('com parâmetro, ele vence a régua', () => {
        expect(cfopDoLancamento(nota('2026-07'), '5405', 'entrada', ctx([param()]))).toBe('1407');
    });

    it('mas a decisão NAQUELA NF vence o parâmetro — quem corrigiu olhou a nota', () => {
        const doc = { ...nota('2026-07'), cfopEscriturado: '1949' };
        expect(cfopDoLancamento(doc, '5405', 'entrada', ctx([param()]))).toBe('1949');
    });

    it('e a competência anterior continua na régua, mesmo com parâmetro criado', () => {
        expect(cfopDoLancamento(nota('2026-06'), '5405', 'entrada', ctx([param()]))).toBe('1403');
    });

    it('🚨 SAÍDA não aprende — o CFOP da nota própria já é o certo', () => {
        // Aprender na saída seria reescrever o que o cliente emitiu.
        expect(cfopDoLancamento(nota('2026-07'), '5405', 'saida', ctx([param()]))).toBe('5405');
    });
});

describe('a ORIGEM diz que veio do cérebro, e de quem', () => {
    it('nomeia o parâmetro, o escopo e a vigência', () => {
        const o = origemDoCfopLancamento(nota('2026-07'), '5405', 'entrada', ctx([param()]));
        expect(o.origem).toBe('cerebro');
        expect(o.rotulo).toMatch(/parâmetro do fornecedor \(CFOP 5405, desde 2026-07\)/);
        expect(o.por).toBe('colab@sp.com.br');
    });

    it('escopo amplo se declara como "qualquer CFOP"', () => {
        expect(rotuloParametro(param({ cfopOrigem: null }))).toMatch(/qualquer CFOP/);
    });
});

describe('🚨 a sugestão é OPT-IN e diz a consequência ANTES do clique', () => {
    const base = {
        cnpjFornecedor: FORN, nomeFornecedor: 'POSTO X', cfopOrigem: '5405',
        cfopDestino: '1407', competencia: '2026-07',
    };

    it('a pergunta nomeia fornecedor, CFOP de origem e destino', () => {
        const s: any = sugerirParametro(base);
        expect(s.pode).toBe(true);
        expect(s.pergunta).toMatch(/POSTO X/);
        expect(s.pergunta).toMatch(/5405/);
        expect(s.pergunta).toMatch(/1407/);
    });

    it('e o detalhe diz que NÃO retroage e que a NF continua vencendo', () => {
        const s: any = sugerirParametro(base);
        expect(s.detalhe).toMatch(/de 2026-07 em diante/);
        expect(s.detalhe).toMatch(/Competências anteriores não mudam/);
        expect(s.detalhe).toMatch(/informado à mão continua vencendo/);
    });

    it('sem CNPJ do fornecedor a sugestão RECUSA com a ação — não cria parâmetro órfão', () => {
        const s: any = sugerirParametro({ ...base, cnpjFornecedor: '' });
        expect(s.pode).toBe(false);
        expect(s.motivo).toMatch(/Releia o XML/);
    });

    it('sem competência não nasce — parâmetro sem data de início retroagiria', () => {
        expect((sugerirParametro({ ...base, competencia: '' }) as any).pode).toBe(false);
    });

    it('o parâmetro nasce ATIVO e com a vigência da nota que o originou', () => {
        const s: any = sugerirParametro(base);
        expect(s.parametro).toMatchObject({
            cnpjFornecedor: FORN, cfopOrigem: '5405', cfopDestino: '1407',
            vigenciaInicio: '2026-07', ativo: true,
        });
    });
});

describe('🚨 a gravação valida e o desligar não apaga', () => {
    const fonte = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'services/cfopEscrituradoService.ts'), 'utf8');

    it('o CFOP de destino passa pela MESMA régua de faixa da nota', () => {
        // Parâmetro com CFOP de saída espalharia um CFOP torto por todas as
        // notas do fornecedor — é a família do 1405, multiplicada.
        expect(fonte).toMatch(/validarCfopEscriturado\(p\.cfopDestino, 'entrada'\)/);
    });

    it('desligar marca ativo:false — nunca deleta', () => {
        expect(fonte).toMatch(/ativo: false,\s*\n\s*desligadoPor/);
        expect(fonte).not.toMatch(/deleteDoc\(/);
    });

    it('falha de leitura devolve [] — o cérebro é palpite, não trava', () => {
        expect(fonte).toMatch(/catch \{\s*\n\s*return \[\];/);
    });

    it('a coleção está no catálogo do banco e nas rules', () => {
        const cat = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'sefaz-backend/catalogo-banco.js'), 'utf8');
        expect(cat).toMatch(/cfop_parametros/);
        const rules = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'firestore.rules'), 'utf8');
        const bloco = rules.slice(rules.indexOf('match /cfop_parametros/'));
        // UPDATE só para desligar: parâmetro não se reescreve por baixo, porque
        // ele explica as competências que já datou.
        expect(bloco).toMatch(/hasOnly\(\['ativo', 'desligadoPor', 'desligadoEm'\]\)/);
    });
});

// ============================================================================
// PGDAS-D sem movimento — a declaração que o app não tinha onde transmitir.
//
// Declaração e guia são obrigações DIFERENTES: a declaração vence todo mês
// (MAED de R$ 50,00 se não entregar), a guia só existe se houver o que pagar.
// No app estavam soldadas, porque a transmissão do PGDAS-D só acontecia dentro
// da emissão do DAS — que recusa valor abaixo de R$ 10,00.
//
// A trava que estes testes protegem: "sem movimento" é uma AFIRMAÇÃO à
// Receita. Fazê-la sobre uma captura furada é declarar mentira, e a diferença
// entre "não faturou" e "não capturamos" não está no zero — está na saúde da
// captura.
// ============================================================================
// @ts-expect-error módulo JS puro sem tipos
import { avaliarDeclaracaoJaEntregue, avaliarSemMovimento, montarDeclaracaoSemMovimento, interpretarRecusaSemMovimento, MAED_MINIMA } from '../sefaz-backend/pgdas-sem-movimento.js';

const limpo = {
    receitaLancada: 0,
    notasCapturadas: 0,
    capturaConfiavel: true,
    confirmadoPeloColaborador: true,
};

describe('o caminho feliz exige TODAS as condições', () => {
    test('sem receita, sem nota, captura saudável e confirmação → pode declarar', () => {
        const r = avaliarSemMovimento(limpo);
        expect(r.pode).toBe(true);
        expect(r.situacao).toBe('pode-declarar');
    });

    test('competência já declarada vira RETIFICADORA, e o aviso diz isso', () => {
        const r = avaliarSemMovimento({ ...limpo, jaDeclarado: true });
        expect(r.pode).toBe(true);
        expect(r.alertas.join(' ')).toMatch(/RETIFICADORA/);
    });
});

describe('o que NÃO é mês sem movimento', () => {
    test('receita lançada recusa e manda pro caminho normal', () => {
        const r = avaliarSemMovimento({ ...limpo, receitaLancada: 1234.56 });
        expect(r.pode).toBe(false);
        expect(r.situacao).toBe('tem-receita');
        expect(r.motivo).toMatch(/1234,56/);
        expect(r.acao).toMatch(/emissão normal/i);
    });

    test('nota capturada sem receita lançada recusa — e explica o absurdo', () => {
        const r = avaliarSemMovimento({ ...limpo, notasCapturadas: 3 });
        expect(r.pode).toBe(false);
        expect(r.situacao).toBe('tem-nota-capturada');
        // Declarar sem movimento aqui seria afirmar à Receita algo que o
        // próprio app desmente.
        expect(r.acao).toMatch(/o próprio app desmente/);
    });

    test('e isso impede o atalho: "sem movimento" não pode virar fuga da conferência', () => {
        // Se receita ou nota passassem, alguém usaria este caminho pra escapar
        // da divergência SERPRO × app na emissão normal.
        expect(avaliarSemMovimento({ ...limpo, receitaLancada: 0.01 }).pode).toBe(false);
        expect(avaliarSemMovimento({ ...limpo, notasCapturadas: 1 }).pode).toBe(false);
    });
});

describe('A TRAVA PRINCIPAL: zero sem captura confiável não prova nada', () => {
    test('captura incerta RECUSA, mesmo com tudo zerado', () => {
        const r = avaliarSemMovimento({ ...limpo, capturaConfiavel: false });
        expect(r.pode).toBe(false);
        expect(r.situacao).toBe('captura-incerta');
        expect(r.acao).toMatch(/declaração falsa/);
        expect(r.acao).toMatch(/quem responde é o contribuinte/);
    });

    test('o motivo da incerteza chega junto — alerta sem causa não vira ação', () => {
        const r = avaliarSemMovimento({
            ...limpo, capturaConfiavel: false,
            motivoCapturaIncerta: 'o cron da NFS-e SP falhou nas últimas 5 execuções',
        });
        expect(r.motivo).toMatch(/cron da NFS-e SP falhou/);
    });
});

describe('o app prova que não capturou; quem afirma que não houve é a pessoa', () => {
    test('sem confirmação humana, não declara', () => {
        const r = avaliarSemMovimento({ ...limpo, confirmadoPeloColaborador: false });
        expect(r.pode).toBe(false);
        expect(r.situacao).toBe('falta-confirmacao');
        expect(r.acao).toMatch(/NÃO CAPTUROU nada/);
    });

    test('e a distinção está escrita, não implícita', () => {
        const r = avaliarSemMovimento({ ...limpo, confirmadoPeloColaborador: false });
        expect(r.acao).toMatch(/quem afirma que não HOUVE faturamento é você/);
    });
});

describe('a declaração zerada ainda leva os estabelecimentos', () => {
    test('matriz sozinha', () => {
        const d = montarDeclaracaoSemMovimento({ cnpj: '27.510.552/0001-04' });
        expect(d.estabelecimentos).toEqual([{ cnpjCompleto: '27510552000104', atividades: [] }]);
        expect(d.receitaPaCompetenciaInterno).toBe(0);
        expect(d.receitaPaCompetenciaExterno).toBe(0);
    });

    test('filiais entram mesmo zeradas — é a exigência que derrubou o caso BRISKA', () => {
        const d = montarDeclaracaoSemMovimento({
            cnpj: '11222333000175', filiais: ['11222333000256'],
        });
        expect(d.estabelecimentos.map((e: any) => e.cnpjCompleto))
            .toEqual(['11222333000175', '11222333000256']);
    });

    test('duplicata não vira estabelecimento repetido', () => {
        const d = montarDeclaracaoSemMovimento({
            cnpj: '11222333000175', filiais: ['11222333000175', '11.222.333/0002-56'],
        });
        expect(d.estabelecimentos).toHaveLength(2);
    });

    test('CNPJ torto bloqueia — declaração não se monta sobre cadastro quebrado', () => {
        expect(() => montarDeclaracaoSemMovimento({ cnpj: '123' })).toThrow(/14 dígitos/);
    });

    test('nenhum valor sai como null onde o SERPRO espera zero', () => {
        const d = montarDeclaracaoSemMovimento({ cnpj: '27510552000104' });
        expect(d.receitaPaCompetenciaInterno).toBe(0);
        expect(d.receitasBrutasAnteriores).toEqual([]);
        // tipoDeclaracao NÃO vem daqui: quem decide Original x Retificadora é o
        // provider, consultando o PA no SERPRO.
        expect(d).not.toHaveProperty('tipoDeclaracao');
    });
});

test('a multa que justifica a feature está registrada', () => {
    expect(MAED_MINIMA).toBe(50);
});

describe('a recusa do SERPRO sai traduzida, com a ação', () => {
    // Primeira transmissão real (07/08, ELS COMERCIO DE BANANAS 07/2026):
    // o SN-Entregar recusou a declaração zerada. A forma correta da declaração
    // sem movimento não está confirmada, e adivinhar payload numa entrega ao
    // PGDAS-D é o oposto da regra da casa — entrega não se desfaz.
    const bruta = 'SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_023] - SN-Entregar: '
        + 'O valor da atividade deve ser maior que zero.';

    test('a MSG_ISN_023 é reconhecida e explicada', () => {
        const r = interpretarRecusaSemMovimento(bruta);
        expect(r.conhecida).toBe(true);
        expect(r.codigo).toBe('MSG_ISN_023');
        expect(r.mensagem).toMatch(/nada foi transmitido/i);
    });

    test('e a ação cobre a competência que continua vencendo', () => {
        const r = interpretarRecusaSemMovimento(bruta);
        expect(r.acao).toMatch(/e-CAC/);
        expect(r.acao).toMatch(/MAED/);
        // ATENÇÃO — dois pedidos IMPOSSÍVEIS já foram removidos daqui:
        //   · "mande o extrato": sem movimento não gera extrato;
        //   · "use o 🔎 Atividades declaradas": a consulta devolve só PDF.
        // Pedido impossível vira pedido ignorado, e a pendência some de vista.
        expect(r.acao).not.toMatch(/mande o extrato/i);
        expect(r.acao).not.toMatch(/Atividades declaradas/i);
        // E a ação diz o que resolve HOJE, sem prometer atalho.
        expect(r.acao).toMatch(/e-CAC/);
        expect(r.acao).toMatch(/segue bloqueado/i);
        expect(r.acao).toMatch(/n[ãa]o se deduz/i);
    });

    test('recusa desconhecida também vira ação, não fica crua', () => {
        const r = interpretarRecusaSemMovimento('SERPRO 500: erro interno');
        expect(r.conhecida).toBe(false);
        expect(r.acao).toMatch(/recusa que ninguém traduz/);
    });
});

/**
 * JÁ FOI ENTREGUE? — o app devolvia ERRO pra quem ACERTOU.
 *
 * Paulo, 12/08 (MORDAM 07/2026): ele entregou no e-CAC, exatamente como a
 * mensagem do app manda, e o botão continuou deixando tentar — falhando com
 * MSG_ISN_023. Gasta transmissão à toa e ainda dá cara de erro pra quem fez
 * certo.
 */
describe('competência que já tem declaração transmitida', () => {
    it('reconhece pelo numeroDeclaracao e NÃO soa como erro', () => {
        const r: any = avaliarDeclaracaoJaEntregue({ situacao: 'so-pdf', numeroDeclaracao: '49710197202607001' });
        expect(r.jaEntregue).toBe(true);
        expect(r.motivo).toMatch(/JÁ TEM declaração transmitida/);
        expect(r.motivo).toMatch(/MAED não corre/);
        expect(r.acao).toMatch(/Nada a fazer/);
        expect(r.acao).toMatch(/era exatamente isso que precisava ser feito/);
    });

    it('MSG_ISN_005 (não há declaração) NÃO bloqueia — é o caso normal', () => {
        const r: any = avaliarDeclaracaoJaEntregue({ situacao: 'sem-declaracao', mensagemDaReceita: [] });
        expect(r.jaEntregue).toBe(false);
    });

    it('consulta indisponível não afirma nada', () => {
        expect(avaliarDeclaracaoJaEntregue(null).jaEntregue).toBe(false);
        expect(avaliarDeclaracaoJaEntregue(undefined).jaEntregue).toBe(false);
    });
});

/**
 * A RECUSA PRECISA CONTAR QUE HOUVE UMA CONFERÊNCIA ANTES.
 *
 * Paulo, 12/08: a trava "já entregue" pegou a MORDAM (*"agora sim"*) e não
 * pegou a ELS COMERCIO DE BANANAS 07/2026 (*"aqui não foi não"*). Da tela não
 * dava pra saber por quê — "a Receita disse que não há declaração" e "eu não
 * consegui perguntar" chegavam com a MESMA cara, e as ações são OPOSTAS.
 */
describe('o que a conferência prévia respondeu chega junto da recusa', () => {
    const bruta = 'SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_023] - SN-Entregar: '
        + 'O valor da atividade deve ser maior que zero.';

    it('a Receita respondeu que NÃO há declaração — e a mensagem diz isso', () => {
        const r = interpretarRecusaSemMovimento(bruta, { ok: true, situacao: 'sem-declaracao' });
        expect(r.acao).toMatch(/Conferi antes/);
        expect(r.acao).toMatch(/NÃO há declaração transmitida/);
        // Entregue agora há pouco? a consulta pode atrasar — sem isso a frase
        // manda entregar duas vezes.
        expect(r.acao).toMatch(/poucos minutos/);
    });

    it('consulta CAÍDA não vira "não há declaração" — indeterminado tem cara própria', () => {
        const r = interpretarRecusaSemMovimento(bruta, { ok: false, erro: 'timeout no SERPRO' });
        expect(r.acao).toMatch(/a consulta falhou \(timeout no SERPRO\)/);
        expect(r.acao).toMatch(/JÁ entregou no e-CAC, ignore/);
        expect(r.acao).not.toMatch(/NÃO há declaração transmitida/);
    });

    it('consulta que nem existe no ambiente também é nomeada', () => {
        const r = interpretarRecusaSemMovimento(bruta, null);
        expect(r.acao).toMatch(/não está disponível neste ambiente/);
    });

    it('sem o argumento, a tradução segue pura — não se inventa conferência', () => {
        const r = interpretarRecusaSemMovimento(bruta);
        expect(r.acao).not.toMatch(/Conferi antes|consulta falhou|neste ambiente/);
    });

    it('vale também para a recusa desconhecida', () => {
        const r = interpretarRecusaSemMovimento('SERPRO 500: erro interno', { ok: true });
        expect(r.conhecida).toBe(false);
        expect(r.acao).toMatch(/Conferi antes/);
    });
});

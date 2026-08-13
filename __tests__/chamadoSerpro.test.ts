/**
 * O chamado ao SERPRO é uma ENTREGA — e o que ele precisa ter é o que a
 * primeira rodada real (ELS 07/2026) mostrou faltar no despejo antigo:
 * identificação, a frase "nada foi transmitido" na frente, a mensagem INTEIRA
 * do serviço e uma PERGUNTA que siga o veredito.
 */
import { montarChamadoSerpro, perguntaDoChamado } from '../services/chamadoSerpro';

const MSG_036 = 'SERPRO 400: [MSG_ISN_036] Não foi possível processar a declaração para o período '
    + 'informado. Verifique as informações e tente novamente.';

const candidato = (nome: string, codigo: string | null, mensagem = MSG_036) => ({
    nome,
    hipotese: `hipótese de ${nome}`,
    situacao: (codigo ? 'recusada' : 'indeterminado') as 'recusada' | 'indeterminado',
    codigo,
    mensagem,
});

const SEIS = ['atual', 'sem-estabelecimentos', 'flag-semMovimento', 'flag-indicadorSemMovimento',
    'flag-por-estabelecimento', 'sem-o-campo-atividades'].map((n) => candidato(n, 'MSG_ISN_036'));

const dadosELS = {
    razaoSocial: 'ELS COMERCIO DE BANANAS LTDA',
    cnpj: '48967340000112',
    competencia: '2026-07',
    rodadoEm: '13/08/2026 09:12',
    resultado: {
        candidatos: SEIS,
        veredito: {
            destravou: false,
            forma: null,
            aEstruturaFoiAvaliada: false,
            codigoUnico: 'MSG_ISN_036',
            resumo: 'As 6 formas foram recusadas com o MESMO código (MSG_ISN_036).',
        },
    },
};

describe('chamado ao SERPRO', () => {
    it('põe "nada foi transmitido" na PRIMEIRA linha — senão o atendente responde sobre entrega', () => {
        const { corpo } = montarChamadoSerpro(dadosELS);
        const primeira = corpo.split('\n')[0];
        expect(primeira).toMatch(/nenhuma declaração foi transmitida/i);
        expect(primeira).toMatch(/IMPORTANTE/);
        expect(corpo).toContain('indicadorTransmissao = false');
    });

    it('identifica contribuinte, PA no formato do e-CAC e o serviço exato', () => {
        const { corpo, assunto } = montarChamadoSerpro(dadosELS);
        expect(corpo).toContain('48.967.340/0001-12');
        expect(corpo).toContain('ELS COMERCIO DE BANANAS LTDA');
        expect(corpo).toContain('07/2026');            // não "2026-07"
        expect(corpo).toContain('TRANSDECLARACAO11');
        expect(assunto).toContain('MSG_ISN_036');
        expect(assunto).toContain('48.967.340/0001-12');
    });

    it('leva a mensagem do SERPRO INTEIRA, uma por candidato — foi o corte do toast que matou a 1ª rodada', () => {
        const { corpo } = montarChamadoSerpro(dadosELS);
        SEIS.forEach((c) => {
            expect(corpo).toContain(c.nome);
            expect(corpo).toContain(c.hipotese);
        });
        // A mensagem completa aparece uma vez por candidato, sem truncar.
        expect(corpo.split(MSG_036).length - 1).toBe(6);
    });

    it('com código ÚNICO, a pergunta é sobre a CONDIÇÃO — nunca "qual o leiaute"', () => {
        const p = perguntaDoChamado(dadosELS);
        expect(p).toMatch(/Por que a VALIDAÇÃO/);
        expect(p).toContain('MSG_ISN_036');
        expect(p).toMatch(/situação cadastral|período de apuração|procuração/);
        expect(p).not.toMatch(/Qual é a estrutura/);
        // E o corpo explica POR QUE não é a estrutura — é o achado da rodada.
        expect(montarChamadoSerpro(dadosELS).corpo)
            .toMatch(/não falham pelo mesmo motivo se o motivo fosse a estrutura/);
    });

    it('com códigos DIFERENTES, aí sim a pergunta é sobre o campo do leiaute', () => {
        const dados = {
            ...dadosELS,
            resultado: {
                candidatos: [candidato('atual', 'MSG_ISN_023'), candidato('flag-semMovimento', 'MSG_ISN_018')],
                veredito: { destravou: false, aEstruturaFoiAvaliada: true, codigoUnico: null },
            },
        };
        const p = perguntaDoChamado(dados);
        expect(p).toMatch(/Qual é a estrutura/);
        expect(p).not.toMatch(/Por que a VALIDAÇÃO/);
        const { corpo } = montarChamadoSerpro(dados);
        expect(corpo).not.toMatch(/não falham pelo mesmo motivo/);
        expect(corpo).toMatch(/especificação do campo/);
    });

    it('RECUSA abrir chamado sem evidência — só indeterminado, ou sonda não rodada', () => {
        const soIndeterminado = montarChamadoSerpro({
            ...dadosELS,
            resultado: { candidatos: [candidato('atual', null, 'ECONNRESET')], veredito: {} },
        });
        expect(soIndeterminado.podeAbrir).toBe(false);
        expect(soIndeterminado.motivoDoBloqueio).toMatch(/repita a sonda/);
        expect(soIndeterminado.corpo).toBe('');

        const semRodar = montarChamadoSerpro({ ...dadosELS, resultado: null });
        expect(semRodar.podeAbrir).toBe(false);
        expect(semRodar.motivoDoBloqueio).toMatch(/ainda não rodou/);
    });

    it('RECUSA abrir chamado quando a sonda ACHOU a forma — o que falta é implementar', () => {
        const achou = montarChamadoSerpro({
            ...dadosELS,
            resultado: {
                candidatos: [{ ...candidato('flag-semMovimento', null), situacao: 'aceita' as const }],
                veredito: { destravou: true, forma: 'flag-semMovimento' },
            },
        });
        expect(achou.podeAbrir).toBe(false);
        expect(achou.motivoDoBloqueio).toMatch(/implementar essa forma/);
    });

    it('diz o custo de não entregar — é o que dá prioridade ao chamado', () => {
        expect(montarChamadoSerpro(dadosELS).corpo).toMatch(/MAED de R\$ 50,00/);
        expect(montarChamadoSerpro(dadosELS).corpo).toMatch(/manualmente no e-CAC/);
    });
});

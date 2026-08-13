/**
 * Extrato de entregas da EFD-Reinf — o que fecha a competência.
 *
 * Paulo, 13/08: e-mail com "somente o que foi enviado e seu status", disparado
 * no fechamento do R-2099, SharePoint na pasta do cliente.
 *
 * A trava que manda: TRANSMITIDO ≠ ENTREGUE. Protocolo prova que a Receita
 * RECEBEU o lote; recibo prova que ela PROCESSOU o evento. Entre um e outro
 * cabe uma recusa.
 */
import {
    situacaoDaEntrega, montarExtratoEntregas, montarEmailFechamento,
    nomeArquivoExtrato, competenciaHumana,
} from '../sefaz-backend/reinf-recibo-entrega.js';

const EMPRESA = { nome: 'VINCENZO GUERRA', cnpj: '63027940000194' };
const entregue = (over: any = {}) => ({
    evento: 'ID1630279400001942026070811123300001', tipo: 'R-2055',
    recibo: '11774083-10-2055-2607-11774082', protocolo: '2.202608.33245995',
    transmitidoEm: '13/08/2026 10:41', ...over,
});

// Conferência real do R-2099 da VINCENZO 07/2026.
const CONFERE = {
    situacao: 'confere',
    linhas: [
        { componente: 'inss', apurado: 249.48 },
        { componente: 'gilrat', apurado: 20.79 },
        { componente: 'senar', apurado: 37.80 },
    ],
    resumo: '✓ O totalizador do R-2099 bate com a apuração da aba 🌾 nos três componentes (total R$ 308,07).',
};

describe('situação de uma entrega', () => {
    it('com recibo é ENTREGUE', () => {
        expect(situacaoDaEntrega(entregue()).situacao).toBe('entregue');
    });

    it('SEM recibo não é entregue, mesmo com protocolo do lote', () => {
        const s = situacaoDaEntrega(entregue({ recibo: null }));
        expect(s.situacao).toBe('sem-recibo');
        expect(s.detalhe).toMatch(/Recebido não é processado/);
    });

    it('sem protocolo E sem recibo diz que não há prova nenhuma', () => {
        const s = situacaoDaEntrega({ evento: 'x' });
        expect(s.situacao).toBe('sem-recibo');
        expect(s.detalhe).toMatch(/não há prova/);
    });

    it('ocorrência VENCE o recibo — evento recusado não entrou', () => {
        const s = situacaoDaEntrega(entregue({ ocorrencias: [{ codigo: 'MS0030', descricao: 'ideProdutor' }] }));
        expect(s.situacao).toBe('recusado');
        expect(s.detalhe).toMatch(/MS0030/);
    });
});

describe('farol da competência', () => {
    it('tudo entregue + totalizador batendo = fechado', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA,
            entregas: [entregue()], conferencia: CONFERE,
        });
        expect(e.farol.cor).toBe('ok');
        expect(e.resumo).toEqual({ total: 1, entregues: 1, recusados: 0, semRecibo: 0 });
        expect(e.competenciaHumana).toBe('07/2026');
    });

    it('evento sem recibo derruba o farol — some é o que faz achar que fechou', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA,
            entregas: [entregue(), entregue({ evento: 'B', recibo: null })],
            conferencia: CONFERE,
        });
        expect(e.farol.cor).toBe('falha');
        expect(e.farol.resumo).toMatch(/Transmitido não é entregue/);
        expect(e.resumo.semRecibo).toBe(1);
        // E ele CONTINUA na lista, nomeado.
        expect(e.linhas.map((l: any) => l.evento)).toContain('B');
    });

    it('recusado é falha e vence o resto', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA,
            entregas: [entregue({ ocorrencias: [{ codigo: 'MS0030' }] })],
            conferencia: CONFERE,
        });
        expect(e.farol.cor).toBe('falha');
        expect(e.farol.resumo).toMatch(/RECUSADO/);
    });

    it('totalizador divergente NÃO fecha, mesmo com tudo entregue', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA, entregas: [entregue()],
            conferencia: { situacao: 'divergente', linhas: [], resumo: 'INSS: app 249,48 × Receita 200,00.' },
        });
        expect(e.farol.cor).toBe('falha');
        expect(e.farol.resumo).toMatch(/contra o totalizador que a guia é paga/);
    });

    it('sem totalizador fica ÂMBAR — entregue não é o mesmo que conferido', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA, entregas: [entregue()],
            conferencia: { situacao: 'nao-conferido', linhas: [], resumo: '' },
        });
        expect(e.farol.cor).toBe('atencao');
        expect(e.farol.resumo).toMatch(/não dá para afirmar que a Receita entendeu/);
    });

    it('ZERO evento não é sucesso — manda olhar apuração e captura', () => {
        const e = montarExtratoEntregas({ competencia: '2026-07', empresa: EMPRESA, entregas: [] });
        expect(e.farol.cor).toBe('atencao');
        expect(e.farol.resumo).toMatch(/falha de apuração ou de captura/);
        // A frase NEGA a leitura confortável: "não é ausência de obrigação".
        expect(e.farol.resumo).toMatch(/não é ausência de obrigação/);
    });
});

describe('e-mail do fechamento', () => {
    const extrato = montarExtratoEntregas({
        competencia: '2026-07', empresa: EMPRESA,
        entregas: [entregue()], conferencia: CONFERE,
        fechamento: { recibo: '11774083-10-2099-2607-11774083', processadoEm: '13/08/2026 10:47:37' },
    });

    it('o ASSUNTO carrega o farol — 30 e-mails iguais no mês ninguém tria', () => {
        const { assunto } = montarEmailFechamento(extrato);
        expect(assunto).toMatch(/^✅/);
        expect(assunto).toContain('EFD-Reinf 07/2026');
        expect(assunto).toContain('VINCENZO GUERRA');
    });

    it('o corpo traz o recibo do R-2099 e a situação de cada evento', () => {
        const { corpo } = montarEmailFechamento(extrato);
        expect(corpo).toContain('11774083-10-2099-2607-11774083');
        expect(corpo).toMatch(/✓ ID1630279400001942026070811123300001 \(R-2055\)/);
        expect(corpo).toContain('11774083-10-2055-2607-11774082');
        expect(corpo).toMatch(/308,07/);
    });

    it('NÃO leva o conteúdo do evento — é declaração do cliente', () => {
        const { corpo } = montarEmailFechamento(extrato);
        expect(corpo).toMatch(/conteúdo dos eventos não é enviado/);
    });

    it('farol vermelho aparece no assunto, para triagem', () => {
        const ruim = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA,
            entregas: [entregue({ recibo: null })],
        });
        expect(montarEmailFechamento(ruim).assunto).toMatch(/^🔴/);
    });
});

describe('arquivo no SharePoint', () => {
    it('um por empresa × competência — refechar SOBRESCREVE', () => {
        const e = montarExtratoEntregas({ competencia: '2026-07', empresa: EMPRESA, entregas: [entregue()] });
        expect(nomeArquivoExtrato(e)).toBe('reinf-entregas-63027940000194-202607.pdf');
    });
});

describe('competenciaHumana', () => {
    it('AAAA-MM vira MM/AAAA (é como o e-CAC mostra)', () => {
        expect(competenciaHumana('2026-07')).toBe('07/2026');
        expect(competenciaHumana('')).toBe('—');
    });
});

// @ts-expect-error — módulo .js puro (sem tipos)
import { interpretarRespostaWs, enxugarParaDiagnostico } from '../sefaz-backend/nfse-sp-ws-leitura';

/**
 * Teste do Paulo em 06/08 (CLINICA MANTOAN) com a resposta crua na mão. Ele
 * derrubou a premissa que estava escrita no app desde 22/07: "WS aposentado,
 * 1102 pra tudo". O serviço atende — quem está errado é o nosso XML.
 */
describe('de quem é o problema do WS da Prefeitura', () => {
    it('HTTP 200 com erro 1102: serviço VIVO e o defeito é NOSSO', () => {
        const l = interpretarRespostaWs({
            ok: true, httpStatus: 200, sucesso: false, totalNFes: 0,
            erros: [{ codigo: '1102', descricao: 'Mensagem XML de Pedido do serviço sem conteúdo.' }],
        });
        expect(l.veredicto).toBe('servico-vivo-recusou');
        expect(l.lado).toBe('cfi');
        expect(l.motivo).toMatch(/RESPONDEU/);
        expect(l.acao).toMatch(/não é serviço fora do ar/);
        // A frase não pode sugerir "tente de novo": o erro é determinístico.
        expect(l.acao).toMatch(/Não adianta tentar de novo/);
    });

    it('código desconhecido não é chutado — vira recusa de negócio com o texto da Prefeitura', () => {
        const l = interpretarRespostaWs({
            ok: true, httpStatus: 200, sucesso: false,
            erros: [{ codigo: '205', descricao: 'Contribuinte não autorizou o remetente' }],
        });
        expect(l.veredicto).toBe('servico-vivo-recusou');
        expect(l.lado).toBe('prefeitura');
        expect(l.codigo).toBe('205');
        expect(l.motivo).toMatch(/Contribuinte não autorizou o remetente/);
        expect(l.acao).toMatch(/antes de concluir que o WS está fora/);
    });

    it('sucesso limpo é o único verde', () => {
        const l = interpretarRespostaWs({ ok: true, httpStatus: 200, sucesso: true, erros: [], totalNFes: 4 });
        expect(l.veredicto).toBe('servico-vivo-ok');
        expect(l.motivo).toMatch(/4 nota\(s\)/);
    });

    it('falha antes da resposta NÃO autoriza dizer que o serviço está fora', () => {
        const l = interpretarRespostaWs({ ok: false, falhaAntesDaResposta: true, erro: 'certificado sem PEM extraído' });
        expect(l.veredicto).toBe('nao-chegamos');
        expect(l.lado).toBe('ambiente');
        expect(l.acao).toMatch(/não diz nada sobre o serviço estar no ar/);
    });

    it('sem sucesso e sem erro declarado fica indefinido, não vira conclusão', () => {
        const l = interpretarRespostaWs({ ok: true, httpStatus: 200, sucesso: false, erros: [] });
        expect(l.veredicto).toBe('indefinido');
        expect(l.acao).toMatch(/sem código de erro não dá pra concluir/);
    });
});

describe('enxugarParaDiagnostico', () => {
    it('tira o certificado e a assinatura, que ocupam a tela inteira', () => {
        const s = enxugarParaDiagnostico(
            `<X509Certificate>${'A'.repeat(2000)}</X509Certificate><SignatureValue>${'B'.repeat(400)}</SignatureValue>`,
            5000,
        );
        expect(s).toMatch(/certificado omitido/);
        expect(s).toMatch(/assinatura omitida/);
        expect(s).not.toMatch(/AAAA/);
    });

    it('corta o excesso DIZENDO quanto cortou', () => {
        expect(enxugarParaDiagnostico('x'.repeat(100), 10)).toMatch(/\[\+90 chars\]$/);
    });

    it('vazio não quebra', () => {
        expect(enxugarParaDiagnostico(null)).toBe('');
    });
});

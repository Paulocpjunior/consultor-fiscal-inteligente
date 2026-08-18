/**
 * consultaSituacaoNFe — o webservice que resolve "cancelada deveria puxar"
 * mesmo sem A1 próprio.
 *
 * Paulo, MV LIDER 639 · 18/08: clicou em "Reconferir na SEFAZ" e caiu no erro
 * "Empresa sem certificado A1 próprio ou da mesma raiz" (o cert dela é A3, que
 * não assina em nuvem) — e perguntou *"o estranho é que cancelada deveria
 * puxar"*. Ele tinha razão: existe um SEGUNDO webservice, diferente do
 * DistDFe usado até aqui — a Consulta Situação (`NfeConsultaProtocolo4`) só
 * devolve o STATUS da nota (nunca o conteúdo), e por isso não exige que o
 * certificado pertença ao emitente. O do ESCRITÓRIO serve.
 *
 * 🚧 O host de SP não foi provado contra uma resposta real (rede da SEFAZ
 * bloqueada neste ambiente, mesma cegueira que já vale pro DistDFe) — a prova
 * vem de produção, rodando contra uma das 3 chaves da MV LIDER já confirmadas
 * canceladas no portal.
 */
// @ts-ignore — módulo JS do backend
import { montaEnvelopeConsultaSituacao, ufTemConsultaSituacao } from '../sefaz-backend/sefaz-client.js';
// @ts-ignore
import { lerRespostaConsultaSituacao } from '../sefaz-backend/reconferir-cancelamento.js';

describe('montaEnvelopeConsultaSituacao — envelope da Consulta Situação', () => {
    it('leva chNFe, tpAmb e xServ CONSULTAR — versão 4.00', () => {
        const env = montaEnvelopeConsultaSituacao({ chave: '3'.repeat(44) });
        expect(env).toContain('<chNFe>' + '3'.repeat(44) + '</chNFe>');
        expect(env).toContain('<xServ>CONSULTAR</xServ>');
        expect(env).toContain('consSitNFe versao="4.00"');
        expect(env).toContain('NFeConsultaProtocolo4');
    });

    it('recusa chave que não tem 44 dígitos — nunca manda chave torta', () => {
        expect(() => montaEnvelopeConsultaSituacao({ chave: '123' })).toThrow(/44 dígitos/);
    });
});

describe('ufTemConsultaSituacao — só cadastro, nunca chute', () => {
    it('SP está cadastrado', () => {
        expect(ufTemConsultaSituacao('SP')).toBe(true);
        expect(ufTemConsultaSituacao('sp')).toBe(true);
    });

    it('UF não cadastrada devolve false — nunca inventa host', () => {
        expect(ufTemConsultaSituacao('PR')).toBe(false);
        expect(ufTemConsultaSituacao('')).toBe(false);
        expect(ufTemConsultaSituacao(undefined as any)).toBe(false);
    });
});

describe('lerRespostaConsultaSituacao — vocabulário PRÓPRIO de cStat', () => {
    it('cStat 101 (cancelamento homologado) ⇒ cancelada', () => {
        const r = lerRespostaConsultaSituacao({ ok: true, cStat: '101', xMotivo: 'Cancelamento de NF-e homologado', nProt: '135260000999999' });
        expect(r.situacao).toBe('cancelada');
        expect(r.evento!.tpEvento).toBe('110111');
        expect(r.evento!.nProt).toBe('135260000999999');
    });

    it('cStat 151 também cancela', () => {
        expect(lerRespostaConsultaSituacao({ ok: true, cStat: '151' }).situacao).toBe('cancelada');
    });

    it('cStat 100 (autorizada) ⇒ não cancelada', () => {
        const r = lerRespostaConsultaSituacao({ ok: true, cStat: '100', xMotivo: 'Autorizado o uso da NF-e' });
        expect(r.situacao).toBe('nao-cancelada');
    });

    it('cStat desconhecido (ex.: 217 "não consta") NÃO afirma nada', () => {
        const r = lerRespostaConsultaSituacao({ ok: true, cStat: '217', xMotivo: 'NF-e não consta na base de dados' });
        expect(r.situacao).toBe('indeterminado');
        expect(r.motivo).toMatch(/não permite concluir/);
    });

    it('UF sem host cadastrado (indisponivel) é indeterminado, com a causa', () => {
        const r = lerRespostaConsultaSituacao({ indisponivel: true, motivo: 'Consulta Situação não está cadastrada para a UF "PR"' });
        expect(r.situacao).toBe('indeterminado');
        expect(r.motivo).toMatch(/PR/);
    });

    // ─── A TRAVA QUE MANDA, DE NOVO: falha nunca vira "não cancelada" ────────
    it('erro de rede NUNCA vira "não cancelada"', () => {
        const r = lerRespostaConsultaSituacao({ erro: 'ECONNRESET' });
        expect(r.situacao).toBe('indeterminado');
        expect(r.motivo).toMatch(/não prova que a nota é válida/);
    });

    it('resposta vazia é indeterminado', () => {
        expect(lerRespostaConsultaSituacao(null as any).situacao).toBe('indeterminado');
    });
});

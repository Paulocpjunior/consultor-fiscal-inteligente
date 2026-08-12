/**
 * A SONDA do "sem movimento" — perguntar ao SERPRO sem entregar nada.
 *
 * A regra da casa é que payload de entrega não se deduz, porque entrega ao
 * PGDAS-D não se desfaz. Ela continua valendo: o que esta sonda usa é o modo
 * `indicadorTransmissao: false` do TRANSDECLARACAO11, que VALIDA e não entrega
 * — é dele que vem a MSG_ISN_023 que a ELS COMERCIO DE BANANAS recebe, e por
 * isso a mensagem sempre pôde dizer "nada foi transmitido".
 *
 * O que estes testes protegem: a sonda nunca entrega, recusa também é resposta,
 * indeterminado não vira recusa, e ninguém vence por eliminação silenciosa.
 */
// @ts-expect-error módulo JS puro sem tipos
import { candidatosSemMovimento, assertSondaNaoTransmite, codigoDaResposta, lerResultadoCandidato, vereditoDaSonda } from '../sefaz-backend/pgdas-sonda-sem-movimento.js';

describe('a trava que manda: a sonda NUNCA entrega', () => {
    it('recusa rodar se indicadorTransmissao não for false', () => {
        expect(() => assertSondaNaoTransmite({ indicadorTransmissao: true })).toThrow(/nunca entrega/);
        expect(() => assertSondaNaoTransmite({})).toThrow(/precisa ser false/);
        // Nem `undefined` passa: ausência não é "false".
        expect(() => assertSondaNaoTransmite({ indicadorTransmissao: undefined })).toThrow();
    });

    it('com false, libera', () => {
        expect(assertSondaNaoTransmite({ indicadorTransmissao: false })).toBe(true);
    });
});

describe('os candidatos', () => {
    const cands = candidatosSemMovimento({ cnpj: '48.967.340/0001-12', filiais: ['48967340000203'] });

    it('todo candidato leva a HIPÓTESE que testa — sem ela é chute com outro nome', () => {
        expect(cands.length).toBeGreaterThan(3);
        for (const c of cands) {
            expect(c.nome).toBeTruthy();
            expect(String(c.hipotese).length).toBeGreaterThan(30);
            expect(c.declaracao).toBeTruthy();
        }
    });

    it('o primeiro é o CONTROLE — a forma que o app manda hoje', () => {
        expect(cands[0].nome).toBe('atual');
        expect(cands[0].hipotese).toMatch(/CONTROLE/);
    });

    it('as filiais entram (MSG_ISN_018, caso BRISKA) e o CNPJ sai em dígitos', () => {
        expect(cands[0].declaracao.estabelecimentos.map((e: any) => e.cnpjCompleto))
            .toEqual(['48967340000112', '48967340000203']);
    });

    it('todo candidato zera a receita — é disso que se trata', () => {
        for (const c of cands) {
            expect(c.declaracao.receitaPaCompetenciaInterno).toBe(0);
            expect(c.declaracao.receitaPaCompetenciaExterno).toBe(0);
        }
    });
});

describe('ler a resposta do SN-Entregar', () => {
    it('extrai o código da mensagem', () => {
        expect(codigoDaResposta('SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_023] - ...')).toBe('MSG_ISN_023');
        expect(codigoDaResposta('erro qualquer')).toBeNull();
    });

    it('sem erro = forma ACEITA, e a frase diz que nada foi transmitido', () => {
        const r = lerResultadoCandidato({ nome: 'x', hipotese: 'h' });
        expect(r.situacao).toBe('aceita');
        expect(r.mensagem).toMatch(/Nada foi transmitido/);
    });

    it('erro do SN-Entregar = forma RECUSADA, com o código', () => {
        const r = lerResultadoCandidato({
            nome: 'atual', hipotese: 'h',
            erro: new Error('SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_023] - valor da atividade'),
        });
        expect(r.situacao).toBe('recusada');
        expect(r.codigo).toBe('MSG_ISN_023');
    });

    it('falha de REDE não é recusa — não saber não pode ter cara de resposta', () => {
        const r = lerResultadoCandidato({ nome: 'x', hipotese: 'h', erro: new Error('ECONNRESET') });
        expect(r.situacao).toBe('indeterminado');
        expect(r.mensagem).toMatch(/NÃO recusa a forma/);
    });

    it('código desconhecido guarda o retorno CRU — lição do localErroAviso', () => {
        const r = lerResultadoCandidato({ nome: 'x', hipotese: 'h', erro: new Error('SERPRO 400: coisa nova') });
        expect(r.situacao).toBe('recusada');
        expect(r.codigo).toBeNull();
        expect(r.resposta).toMatch(/coisa nova/);
    });
});

describe('o veredito não elege vencedor por eliminação', () => {
    const aceita = (nome: string) => ({ nome, hipotese: 'h', situacao: 'aceita', codigo: null });
    const recusa = (nome: string, codigo: string) => ({ nome, hipotese: 'h', situacao: 'recusada', codigo });

    it('UMA forma aceita destrava — e diz que implementar ainda é preciso', () => {
        const v = vereditoDaSonda([aceita('flag-semMovimento'), recusa('atual', 'MSG_ISN_023')]);
        expect(v.destravou).toBe(true);
        expect(v.forma).toBe('flag-semMovimento');
        expect(v.resumo).toMatch(/Nada foi transmitido/);
        expect(v.resumo).toMatch(/botão continua bloqueado até isso/);
    });

    it('DUAS aceitas NÃO viram escolha silenciosa', () => {
        const v = vereditoDaSonda([aceita('a'), aceita('b')]);
        expect(v.destravou).toBe(false);
        expect(v.forma).toBeNull();
        expect(v.resumo).toMatch(/A sonda NÃO escolhe/);
    });

    it('nenhuma aceita: segue bloqueado, mas com as recusas nomeadas', () => {
        const v = vereditoDaSonda([recusa('atual', 'MSG_ISN_023'), recusa('sem-estabelecimentos', 'MSG_ISN_018')]);
        expect(v.destravou).toBe(false);
        expect(v.resumo).toMatch(/MSG_ISN_023, MSG_ISN_018/);
        expect(v.resumo).toMatch(/abrir o chamado/);
    });

    it('tudo indeterminado não recusa forma nenhuma', () => {
        const v = vereditoDaSonda([{ nome: 'a', situacao: 'indeterminado' }, { nome: 'b', situacao: 'indeterminado' }]);
        expect(v.destravou).toBe(false);
        expect(v.resumo).toMatch(/NÃO recusa forma nenhuma/);
    });
});

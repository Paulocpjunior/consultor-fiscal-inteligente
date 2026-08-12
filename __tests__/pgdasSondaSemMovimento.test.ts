// ============================================================================
// A SONDA do "sem movimento" — perguntar ao SERPRO sem entregar nada.
//
// A regra da casa continua valendo: entrega ao PGDAS-D não se desfaz, então
// não se adivinha payload. Esta sonda existe JUSTAMENTE por isso — em vez de
// tentativa e erro no botão de declarar, ela usa o modo de VALIDAÇÃO do
// TRANSDECLARACAO11 (`indicadorTransmissao: false`), que é de onde a MSG_ISN_023
// já vem hoje (por isso a mensagem sempre pôde dizer "nada foi transmitido").
//
// O que estes testes protegem é a diferença entre PERGUNTAR e ENTREGAR.
// ============================================================================
// @ts-expect-error módulo JS puro sem tipos
import { candidatosSemMovimento, assertSondaNaoTransmite, codigoDaResposta, lerResultadoCandidato, vereditoDaSonda } from '../sefaz-backend/pgdas-sonda-sem-movimento.js';

describe('A TRAVA: a sonda nunca entrega', () => {
    test('indicadorTransmissao true é RECUSADO', () => {
        expect(() => assertSondaNaoTransmite({ indicadorTransmissao: true }))
            .toThrow(/precisa ser false/);
    });

    test('campo ausente também é recusado — não se assume false', () => {
        expect(() => assertSondaNaoTransmite({})).toThrow(/indicadorTransmissao/);
        expect(() => assertSondaNaoTransmite(null)).toThrow();
    });

    test('só passa com false explícito', () => {
        expect(assertSondaNaoTransmite({ indicadorTransmissao: false })).toBe(true);
    });
});

describe('os candidatos', () => {
    const cs = candidatosSemMovimento({ cnpj: '48.967.340/0001-12' });

    test('todo candidato leva a HIPÓTESE que ele testa — sem ela é chute com outro nome', () => {
        expect(cs.length).toBeGreaterThan(1);
        for (const c of cs) {
            expect(c.nome).toBeTruthy();
            expect(String(c.hipotese).length).toBeGreaterThan(30);
            expect(c.declaracao).toBeTruthy();
        }
    });

    test('o primeiro é o CONTROLE: exatamente o que o app manda hoje', () => {
        expect(cs[0].nome).toBe('atual');
        expect(cs[0].declaracao.estabelecimentos).toEqual([
            { cnpjCompleto: '48967340000112', atividades: [] },
        ]);
        expect(cs[0].hipotese).toMatch(/CONTROLE/);
    });

    test('as filiais entram em todos — é a exigência conhecida (MSG_ISN_018, BRISKA)', () => {
        const comFilial = candidatosSemMovimento({
            cnpj: '11222333000175', filiais: ['11.222.333/0002-56', '11222333000175'],
        });
        expect(comFilial[0].declaracao.estabelecimentos.map((e: any) => e.cnpjCompleto))
            .toEqual(['11222333000175', '11222333000256']);
    });

    test('nenhum candidato traz receita — é sonda de FORMA, não de valor', () => {
        for (const c of cs) {
            expect(c.declaracao.receitaPaCompetenciaInterno).toBe(0);
            expect(c.declaracao.receitaPaCompetenciaExterno).toBe(0);
        }
    });
});

describe('ler a resposta do SN-Entregar', () => {
    test('sem erro = a forma foi VALIDADA, e a frase diz que nada foi transmitido', () => {
        const r = lerResultadoCandidato({ nome: 'x', hipotese: 'h' });
        expect(r.situacao).toBe('aceita');
        expect(r.mensagem).toMatch(/Nada foi transmitido/);
    });

    test('recusa do SN-Entregar carrega o código, que é o que estreita o campo', () => {
        const r = lerResultadoCandidato({
            nome: 'atual', hipotese: 'h',
            erro: new Error('SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_023] - SN-Entregar: O valor da atividade deve ser maior que zero.'),
        });
        expect(r.situacao).toBe('recusada');
        expect(r.codigo).toBe('MSG_ISN_023');
    });

    test('código NOVO leva o retorno CRU junto — rótulo inventado vale menos', () => {
        const r = lerResultadoCandidato({ nome: 'x', hipotese: 'h', erro: new Error('SERPRO 400: erro sem código') });
        expect(r.situacao).toBe('recusada');
        expect(r.codigo).toBeNull();
        expect(r.resposta).toMatch(/erro sem código/);
    });

    // Mesma régua do indeterminado do gate: não saber não pode ter cara de "não".
    test('falha de REDE não recusa a forma — vira indeterminado', () => {
        const r = lerResultadoCandidato({ nome: 'x', hipotese: 'h', erro: new Error('socket hang up') });
        expect(r.situacao).toBe('indeterminado');
        expect(r.mensagem).toMatch(/NÃO recusa a forma/);
    });

    test('codigoDaResposta extrai só o que existe', () => {
        expect(codigoDaResposta('blá MSG_ISN_018 blá')).toBe('MSG_ISN_018');
        expect(codigoDaResposta('nada aqui')).toBeNull();
    });
});

describe('o veredito', () => {
    const aceita = (nome: string) => ({ nome, hipotese: 'h', situacao: 'aceita', codigo: null });
    const recusa = (nome: string, codigo: string) => ({ nome, hipotese: 'h', situacao: 'recusada', codigo });

    test('UMA forma aceita destrava — e ainda assim o botão só abre depois de implementar', () => {
        const v = vereditoDaSonda([aceita('flag-semMovimento'), recusa('atual', 'MSG_ISN_023')]);
        expect(v.destravou).toBe(true);
        expect(v.forma).toBe('flag-semMovimento');
        expect(v.resumo).toMatch(/Nada foi transmitido/);
        expect(v.resumo).toMatch(/botão continua bloqueado até isso/);
    });

    test('DUAS formas aceitas: a sonda NÃO escolhe', () => {
        const v = vereditoDaSonda([aceita('a'), aceita('b')]);
        expect(v.destravou).toBe(false);
        expect(v.forma).toBeNull();
        // Validação passar não prova que a entrega aceita — e entrega não se desfaz.
        expect(v.resumo).toMatch(/NÃO escolhe/);
    });

    test('nenhuma aceita: o bloqueio continua, mas com as recusas nomeadas', () => {
        const v = vereditoDaSonda([recusa('atual', 'MSG_ISN_023'), recusa('sem-estabelecimentos', 'MSG_ISN_018')]);
        expect(v.destravou).toBe(false);
        expect(v.resumo).toMatch(/MSG_ISN_023, MSG_ISN_018/);
        expect(v.resumo).toMatch(/abrir o chamado/);
    });

    test('rodada toda indeterminada não recusa nada — manda repetir', () => {
        const v = vereditoDaSonda([
            { nome: 'a', situacao: 'indeterminado', codigo: null },
            { nome: 'b', situacao: 'indeterminado', codigo: null },
        ]);
        expect(v.destravou).toBe(false);
        expect(v.resumo).toMatch(/NÃO recusa forma nenhuma/);
    });
});

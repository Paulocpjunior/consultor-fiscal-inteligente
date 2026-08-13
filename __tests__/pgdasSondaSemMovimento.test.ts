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

/**
 * A SONDA LIGADA — o cabeamento, não só o núcleo.
 *
 * Núcleo testado que ninguém chama não protege nada: era exatamente esta a
 * situação até 13/08 (o módulo existia, sem rota e sem botão).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('a sonda está ligada de ponta a ponta', () => {
    const orquestrador = raiz('sefaz-backend/das-orchestrator.js');
    const rotas = raiz('sefaz-backend/das-routes.js');
    const provider = raiz('sefaz-backend/das-provider.js');
    const service = raiz('services/dasService.ts');
    const tela = raiz('components/SimplesNacionalDetalhe.tsx');

    it('o orquestrador usa os quatro pedaços do núcleo', () => {
        for (const fn of ['candidatosSemMovimento', 'assertSondaNaoTransmite', 'lerResultadoCandidato', 'vereditoDaSonda']) {
            expect(orquestrador).toContain(fn);
        }
    });

    it('A TRAVA vai junto do envio — não sobre uma cópia', () => {
        // O guard é passado ao provider e roda sobre o MESMO objeto que sai
        // para o SERPRO. Conferir uma cópia provaria só que a cópia estava boa.
        expect(orquestrador).toMatch(/antesDeEnviar:\s*assertSondaNaoTransmite/);
        expect(provider).toMatch(/if \(typeof antesDeEnviar === 'function'\) antesDeEnviar\(dadosValidacao\)/);
        // E o modo é sempre VALIDAÇÃO.
        expect(provider).toMatch(/transmitir:\s*false/);
    });

    it('a trava violada PARA a sonda inteira — não vira "candidato recusado"', () => {
        // Se `SONDA_NAO_TRANSMITE` fosse tratado como resposta do SERPRO, uma
        // sonda que passasse a transmitir seguiria rodando os candidatos.
        expect(orquestrador).toMatch(/if \(e\?\.code === 'SONDA_NAO_TRANSMITE'\) throw e/);
    });

    it('a rota é admin-only e existe', () => {
        expect(rotas).toMatch(/router\.post\('\/sondar-sem-movimento', requireAdmin/);
        expect(rotas).toContain('sondarFormaSemMovimento');
    });

    it('modo mock RECUSA — não há a quem perguntar, e inventar seria o oposto', () => {
        expect(orquestrador).toMatch(/SONDA_SEM_PROVIDER/);
        expect(orquestrador).toMatch(/inventar a resposta seria o oposto/);
    });

    it('a resposta afirma, em qualquer desfecho, que nada foi transmitido', () => {
        expect(orquestrador).toMatch(/nadaFoiTransmitido:\s*true/);
    });

    it('o botão existe, é admin-only e avisa que não transmite', () => {
        expect(service).toContain('export async function sondarFormaSemMovimento');
        expect(tela).toContain('handleSondarSemMovimento');
        expect(tela).toMatch(/currentUser\?\.role === 'admin' && \(\s*<button\s*\n\s*onClick=\{handleSondarSemMovimento\}/);
        expect(tela).toMatch(/Sondar forma \(não transmite\)/);
        expect(tela).toMatch(/NADA é transmitido/);
    });

    it('a auditoria guarda o resultado — a sonda produz CONHECIMENTO', () => {
        expect(orquestrador).toContain('pgdas_sonda_sem_movimento');
        // Falha de auditoria não derruba a sonda: perder o registro é ruim,
        // perder a resposta do SERPRO que já foi paga é pior.
        expect(orquestrador).toMatch(/auditoria não gravada/);
    });
});

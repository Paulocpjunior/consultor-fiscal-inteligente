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

    /**
     * O ACHADO DA PRIMEIRA RODADA REAL (ELS 07/2026, 13/08).
     *
     * As 6 formas voltaram com o MESMO código (MSG_ISN_036). Isso não é
     * "nenhuma serve": estruturas diferentes não falham pelo mesmo motivo se o
     * motivo fosse a estrutura. A recusa acontece ANTES de o SN-Entregar olhar
     * o conteúdo — e dizer isso muda o próximo passo de "testar outra forma"
     * para "levar o código ao SERPRO".
     */
    it('TODAS com o mesmo código ⇒ a estrutura nem foi avaliada', () => {
        const v = vereditoDaSonda([
            recusa('atual', 'MSG_ISN_036'),
            recusa('sem-estabelecimentos', 'MSG_ISN_036'),
            recusa('flag-semMovimento', 'MSG_ISN_036'),
        ]);
        expect(v.destravou).toBe(false);
        expect(v.aEstruturaFoiAvaliada).toBe(false);
        expect(v.codigoUnico).toBe('MSG_ISN_036');
        expect(v.resumo).toMatch(/MESMO código/);
        expect(v.resumo).toMatch(/ACHADO, não um beco/);
        expect(v.resumo).toMatch(/Pare de procurar estrutura/);
    });

    it('códigos DIFERENTES ⇒ o conteúdo chegou a ser avaliado', () => {
        const v = vereditoDaSonda([
            recusa('atual', 'MSG_ISN_023'),
            recusa('sem-estabelecimentos', 'MSG_ISN_018'),
        ]);
        expect(v.aEstruturaFoiAvaliada).toBe(true);
        expect(v.codigoUnico).toBeNull();
        expect(v.resumo).toMatch(/chegou a avaliar o conteúdo/);
    });

    it('um candidato só não vira conclusão sobre a estrutura', () => {
        // Com uma amostra, "todas deram o mesmo código" é trivialmente
        // verdadeiro e não prova nada.
        const v = vereditoDaSonda([recusa('atual', 'MSG_ISN_036')]);
        expect(v.aEstruturaFoiAvaliada).toBe(true);
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

/**
 * O RESULTADO É EVIDÊNCIA — precisa caber na tela e poder ser copiado.
 *
 * A primeira rodada real saiu num toast que mostrava `nome: situação (código)`
 * e escondia a MENSAGEM do SERPRO — justo o que permite abrir o chamado. Código
 * sozinho não diz nada a ninguém.
 */
describe('o resultado da sonda vai para um painel, não para um toast', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/SimplesNacionalDetalhe.tsx'), 'utf8');

    it('há painel de resultado, e ele mostra a MENSAGEM inteira do SERPRO', () => {
        expect(tela).toMatch(/setResultadoSonda\(r\)/);
        expect(tela).toMatch(/\{c\.mensagem\}/);
        expect(tela).toMatch(/hipótese|c\.hipotese/);
    });

    // O botão copiava um DESPEJO (veredito + candidatos). Despejo não é
    // chamado: sem identificação, sem "nada foi transmitido" e sem PERGUNTA, o
    // atendente responde sobre entrega. Quem monta o chamado é o módulo, com
    // teste próprio (chamadoSerpro.test.ts) — a tela só chama.
    it('o botão copia um CHAMADO montado, não o despejo do resultado', () => {
        expect(tela).toMatch(/montarChamadoSerpro/);
        expect(tela).toMatch(/Copiar chamado do SERPRO/);
        expect(tela).not.toMatch(/copiarResultadoSonda/);
        // E o chamado fica visível ANTES de copiar — pergunta reescrita na mão
        // vira "não consigo declarar sem movimento", que volta genérica.
        expect(tela).toMatch(/Chamado pronto — ver antes de copiar/);
        expect(tela).toMatch(/chamado\.motivoDoBloqueio/);
    });

    it('quando a estrutura não foi avaliada, a tela DIZ para parar de testar formas', () => {
        expect(tela).toMatch(/aEstruturaFoiAvaliada === false/);
        expect(tela).toMatch(/A estrutura NÃO foi avaliada/);
        expect(tela).toMatch(/Não adianta testar outra forma/);
    });

    it('o toast não é mais o canal do resultado', () => {
        // O toast segue existindo para a FALHA da chamada — o que saiu foi o
        // resultado da sonda, que não cabe nele.
        expect(tela).not.toMatch(/onShowToast\(`\$\{r\.veredito\.resumo\}/);
    });
});

/**
 * O PAINEL FICA FORA DO CABEÇALHO.
 *
 * Primeira versão (13/08) inseriu o painel DENTRO do
 * `flex md:flex-row justify-between` do cabeçalho — ele virou um flex item ao
 * lado da fileira de botões e apareceu espremido numa coluna de ~180px, com o
 * texto ilegível. O conteúdo estava certo; o lugar, não.
 */
describe('o painel da sonda ocupa a largura da tela', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/SimplesNacionalDetalhe.tsx'), 'utf8');

    it('vem DEPOIS do cabeçalho, não dentro dele', () => {
        // O último elemento do cabeçalho é o input de importar. Se o painel
        // aparecer antes dele, voltou pra dentro do flex.
        const posImport = tela.indexOf('Importar NFe/PGDAS');
        const posPainel = tela.indexOf('RESULTADO DA SONDA');
        expect(posImport).toBeGreaterThan(-1);
        expect(posPainel).toBeGreaterThan(posImport);
    });

    it('e o cabeçalho fecha antes do painel abrir', () => {
        const trecho = tela.slice(tela.indexOf('Importar NFe/PGDAS'), tela.indexOf('RESULTADO DA SONDA'));
        // Duas tags de fechamento entre o último botão e o painel: a do label
        // e a do próprio cabeçalho.
        expect(trecho).toMatch(/<\/label>[\s\S]*<\/div>[\s\S]*<\/div>/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A SONDA PERGUNTAVA COM UM PAYLOAD INVÁLIDO — as 6 formas nunca foram
// avaliadas.
//
// Paulo, 20/08 (ELS COMERCIO DE BANANAS, PA 07/2026): rodou a sonda e os seis
// candidatos voltaram com o MESMO erro, e o SERPRO disse o campo na cara:
//
//   [EntradaIncorreta-PGDASD-MSG_ISN_036] - O Json contém dados inválidos -
//   Required property 'TipoDeclaracao' not found in JSON. Path 'declaracao'.
//
// `tipoDeclaracao` é obrigatório e quem o preenche no caminho real é o
// `transmitirPgdasD` — a sonda chamava `validarDeclaracaoPgdas` direto e o
// deixava de fora. A recusa foi de SCHEMA, antes de qualquer leitura de "sem
// movimento".
//
// E o veredito piorava o estrago: lia "seis recusas com o mesmo código" e
// mandava *"pare de procurar estrutura, leve ao SERPRO"* — chamado sobre um
// defeito NOSSO, com o campo escrito na própria resposta.
// ═══════════════════════════════════════════════════════════════════════════
// @ts-expect-error módulo JS puro sem tipos
import { candidatosSemMovimento as candidatos2, campoObrigatorioAusente, lerResultadoCandidato as ler2, vereditoDaSonda as veredito2 } from '../sefaz-backend/pgdas-sonda-sem-movimento.js';

const ERRO_036 = "SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_036] - O Json contém dados inválidos - "
    + "Required property 'TipoDeclaracao' not found in JSON. Path 'declaracao', line 1, position 380.";

describe('🚨 a sonda manda o payload do caminho REAL', () => {
    it('TODO candidato leva tipoDeclaracao — era ele que faltava', () => {
        const cs = candidatos2({ cnpj: '48967340000112' });
        expect(cs.length).toBeGreaterThan(1);
        for (const c of cs) expect(c.declaracao.tipoDeclaracao).toBe(1);
    });

    it('e ele acompanha o que o caminho real decidiria (2 = Retificadora)', () => {
        const cs = candidatos2({ cnpj: '48967340000112', tipoDeclaracao: 2 });
        for (const c of cs) expect(c.declaracao.tipoDeclaracao).toBe(2);
    });

    it('o candidato "sem-estabelecimentos" continua sem estabelecimento — a variação é OUTRA', () => {
        const c = candidatos2({ cnpj: '48967340000112' }).find((x: any) => x.nome === 'sem-estabelecimentos');
        expect(c.declaracao.estabelecimentos).toEqual([]);
        expect(c.declaracao.tipoDeclaracao).toBe(1);
    });
});

describe('🚨 mensagem que NOMEIA o campo é achado, não beco', () => {
    it('extrai o campo do "Required property ... not found"', () => {
        expect(campoObrigatorioAusente(ERRO_036)).toBe('TipoDeclaracao');
        expect(campoObrigatorioAusente('qualquer outra coisa')).toBeNull();
    });

    it('o candidato recusado carrega o campo ausente junto do código', () => {
        const r = ler2({ nome: 'atual', hipotese: 'h', erro: new Error(ERRO_036) });
        expect(r.situacao).toBe('recusada');
        expect(r.codigo).toBe('MSG_ISN_036');
        expect(r.campoAusente).toBe('TipoDeclaracao');
    });

    it('🚨 e o veredito para de mandar abrir chamado — o defeito é do app', () => {
        const rs = ['atual', 'sem-estabelecimentos', 'flag-semMovimento']
            .map((nome) => ler2({ nome, hipotese: 'h', erro: new Error(ERRO_036) }));
        const v = veredito2(rs);
        expect(v.destravou).toBe(false);
        expect(v.campoAusente).toBe('TipoDeclaracao');
        expect(v.aEstruturaFoiAvaliada).toBe(false);
        expect(v.resumo).toMatch(/não veio no JSON/);
        expect(v.resumo).toMatch(/payload da sonda incompleto/);
        // O conselho velho não pode sobreviver: ele mandava para o lugar errado.
        expect(v.resumo).not.toMatch(/leve ESTE código ao SERPRO/);
    });

    it('mesmo código SEM campo nomeado continua caindo no veredito antigo', () => {
        // Aquele veredito não estava errado — estava incompleto. Mensagem
        // opaca com o mesmo código segue sendo sinal de condição da empresa.
        const opaco = 'SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_023] - O valor da atividade deve ser maior que zero.';
        const rs = ['atual', 'sem-estabelecimentos', 'flag-semMovimento']
            .map((nome) => ler2({ nome, hipotese: 'h', erro: new Error(opaco) }));
        const v = veredito2(rs);
        expect(v.campoAusente).toBeUndefined();
        expect(v.resumo).toMatch(/MESMO código/);
    });
});

// ─── A TRAVA: a sonda tem que PERGUNTAR o tipo, não cravar ───────────────────
describe('🚨 o orquestrador consulta o tipo antes de sondar', () => {
    const fonte = require('fs').readFileSync(
        require('path').resolve(__dirname, '../sefaz-backend/das-orchestrator.js'), 'utf8',
    );
    const trecho = fonte.slice(fonte.indexOf('export async function sondarFormaSemMovimento'),
        fonte.indexOf('export async function declararPgdasSemMovimento'));

    it('usa consultarDeclaracaoPa — a mesma decisão do caminho real', () => {
        expect(trecho).toMatch(/consultarDeclaracaoPa/);
        expect(trecho).toMatch(/candidatosSemMovimento\(\{ cnpj: cnpjLimpo, filiais, tipoDeclaracao \}\)/);
    });

    it('consulta caída NÃO para a sonda — cai em Original e diz qual usou', () => {
        expect(trecho).toMatch(/origemTipo = 'padrao-original'/);
        expect(trecho).toMatch(/tipoDeclaracao,\s*\n\s*origemTipo,/);
    });
});

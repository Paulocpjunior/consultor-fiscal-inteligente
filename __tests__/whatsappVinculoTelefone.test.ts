// ============================================================================
// 🔗 DE QUEM É ESTE NÚMERO? — a medição que precede a tela
//
// Nos prints de 26/08 quase toda conversa tem o selo âmbar "vincular". Sem o
// vínculo, a coluna do cliente nasce vazia, o relatório não sabe de qual
// cliente é a conversa, e a fase 3 da IA é impossível.
//
// 🚨 O QUE ESTE MÓDULO SE RECUSA A FAZER É DECIDIR. Ele SUGERE, carimbando o
// campo que casou. Vincular errado mostraria as guias de um cliente dentro da
// conversa de outro — dado fiscal na tela da pessoa errada.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import {
    formasDoNumero, telefonesDaEmpresa, cruzarNumerosComCadastro, sugestaoParaNumero,
} from '../sefaz-backend/whatsapp-vinculo-telefone';

describe('📞 as formas do mesmo telefone', () => {
    it('o 9º dígito é o MESMO número — o cadastro tem número dos dois tempos', () => {
        // O WhatsApp entrega 13 dígitos com o 9; cadastro antigo tem 10.
        expect(formasDoNumero('5511997377599')).toEqual(expect.arrayContaining(['11997377599', '1197377599']));
        expect(formasDoNumero('(11) 9737-7599')).toEqual(expect.arrayContaining(['1197377599', '11997377599']));
    });

    it('🚨 FIXO não ganha o 9 — isso inventaria um celular de outra pessoa', () => {
        // 11 3337-1554 é o telefone da casa. Virar "11 93337-1554" casaria com
        // um celular que pode ser de qualquer um.
        const f = formasDoNumero('1133371554');
        expect(f).toEqual(['1133371554']);
        expect(f.join()).not.toMatch(/933371554/);
    });

    it('o DDI 55 sai, mas o DDD 55 (RS) FICA', () => {
        // `5555999998888` é DDI 55 + DDD 55. Cortar "55" duas vezes por regra
        // cega devolveria um número que não existe.
        expect(formasDoNumero('5555999998888')).toContain('55999998888');
        expect(formasDoNumero('5511997377599')).toContain('11997377599');
    });

    it('número ilegível não vira forma nenhuma — nunca um palpite', () => {
        for (const lixo of ['', null, undefined, '123', 'sem telefone', '000']) {
            expect(formasDoNumero(lixo as never)).toEqual([]);
        }
    });
});

describe('🏢 os dois campos do cadastro, com a ORIGEM junto', () => {
    it('lê `whatsappCliente` e `telefone`, aninhados ou no topo', () => {
        const r = telefonesDaEmpresa({ dadosFiscais: { whatsappCliente: '11997377599', telefone: '1133371554' } });
        expect(r.find((x) => x.campo === 'whatsappCliente')?.forma).toBe('11997377599');
        expect(r.find((x) => x.campo === 'telefone')?.forma).toBe('1133371554');
    });

    it('campo vazio não entra — cadastro em branco não sugere nada', () => {
        expect(telefonesDaEmpresa({ dadosFiscais: { telefone: '' } })).toEqual([]);
        expect(telefonesDaEmpresa({})).toEqual([]);
    });
});

describe('🔗 o cruzamento', () => {
    const empresas = [
        { id: 'e1', nome: 'PADARIA DO ZE LTDA', dadosFiscais: { whatsappCliente: '(11) 99737-7599' } },
        { id: 'e2', nome: 'MERCADO CENTRAL ME', dadosFiscais: { telefone: '1133334444' } },
        { id: 'e3', nome: 'REPETIDO A', dadosFiscais: { whatsappCliente: '11955556666' } },
        { id: 'e4', nome: 'REPETIDO B', dadosFiscais: { telefone: '11955556666' } },
    ];

    it('casou por `whatsappCliente` — sugestão com o campo carimbado', () => {
        const r = cruzarNumerosComCadastro({ conversas: [{ numero: '5511997377599', nome: 'Zé' }], empresas });
        expect(r.sugestoes).toHaveLength(1);
        expect(r.sugestoes[0]).toMatchObject({ empresaId: 'e1', nomeEmpresa: 'PADARIA DO ZE LTDA', campo: 'whatsappCliente' });
    });

    it('🐛 e o nome do CONTATO sobrevive — ele não vira o nome do cliente', () => {
        // Duas coisas diferentes com a mesma chave era o defeito da 1ª versão:
        // o atendente leria o nome do cliente no lugar de com quem está falando.
        const r = cruzarNumerosComCadastro({ conversas: [{ numero: '5511997377599', nome: 'Zé' }], empresas });
        expect(r.sugestoes[0].nome).toBe('Zé');
    });

    it('🚨 dois clientes com o MESMO número não viram escolha — saem os dois', () => {
        const r = cruzarNumerosComCadastro({ conversas: [{ numero: '5511955556666' }], empresas });
        expect(r.sugestoes).toHaveLength(0);
        expect(r.ambiguos).toHaveLength(1);
        expect(r.ambiguos[0].candidatos.map((c) => c.empresaId).sort()).toEqual(['e3', 'e4']);
    });

    it('⚠️ mas o MESMO cliente nos dois campos NÃO é ambiguidade', () => {
        // Cadastro que repete o número em `telefone` e `whatsappCliente` é o
        // caso comum; tratá-lo como conflito encheria a fila de problema
        // inexistente, e fila com falso positivo é fila que ninguém abre.
        const r = cruzarNumerosComCadastro({
            conversas: [{ numero: '5511988887777' }],
            empresas: [{ id: 'e9', nome: 'UM SÓ', dadosFiscais: { whatsappCliente: '11988887777', telefone: '11988887777' } }],
        });
        expect(r.ambiguos).toHaveLength(0);
        expect(r.sugestoes[0].empresaId).toBe('e9');
    });

    it('número que não está em cadastro nenhum é BALDE PRÓPRIO', () => {
        // "sem cadastro" e "ambíguo" pedem ações opostas: um é preencher o
        // cadastro (ou é terceiro mesmo), o outro é escolher.
        const r = cruzarNumerosComCadastro({ conversas: [{ numero: '5511900000000' }], empresas });
        expect(r.semCadastro).toHaveLength(1);
        expect(r.sugestoes).toHaveLength(0);
    });

    it('DM do Instagram sai NOMEADA — não é lacuna de vínculo, é outro canal', () => {
        const r = cruzarNumerosComCadastro({
            conversas: [{ numero: 'ig_17841400000000000', canal: 'instagram' }], empresas,
        });
        expect(r.semNumeroLegivel).toHaveLength(1);
        expect(r.semCadastro).toHaveLength(0);
    });

    it('a medição diz quantas empresas TÊM número — senão "0 sugestões" engana', () => {
        // Zero sugestão com zero empresa cadastrada é falta de CADASTRO;
        // zero sugestão com 400 empresas cadastradas é outra história.
        const r = cruzarNumerosComCadastro({ conversas: [{ numero: '5511900000000' }], empresas });
        expect(r.empresasComNumero).toBe(4);
        expect(r.total).toBe(1);
    });

    it('o sinal mais forte vem primeiro: `whatsappCliente` antes de `telefone`', () => {
        const r = cruzarNumerosComCadastro({
            conversas: [{ numero: '551133334444' }, { numero: '5511997377599' }], empresas,
        });
        expect(r.sugestoes.map((s) => s.campo)).toEqual(['whatsappCliente', 'telefone']);
    });
});

describe('🔗 a sugestão de UMA conversa (a que a coluna do cliente mostra)', () => {
    const empresas = [{ id: 'e1', nome: 'PADARIA', dadosFiscais: { whatsappCliente: '11997377599' } }];

    it('devolve a empresa e o campo', () => {
        expect(sugestaoParaNumero('5511997377599', empresas)).toMatchObject({ situacao: 'sugerida', empresaId: 'e1' });
    });

    it('sem cadastro devolve `sem-cadastro` — nunca uma empresa "mais provável"', () => {
        expect(sugestaoParaNumero('5511911112222', empresas).situacao).toBe('sem-cadastro');
    });
});

// ============================================================================
// 🚨 A FIAÇÃO — rota que nenhuma tela chama é código morto com cara de entrega
// (13/08), e medição que ninguém consegue rodar não mede nada.
// ============================================================================
describe('🚨 a medição tem porta, botão e guarda', () => {
    const raiz = (...p: string[]) => path.join(process.cwd(), ...p);
    const rota = fs.readFileSync(raiz('sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = fs.readFileSync(raiz('components/SpConnect/index.tsx'), 'utf8');
    const servico = fs.readFileSync(raiz('services/spConnectService.ts'), 'utf8');

    it('a rota é de ADMIN — ela varre a carteira inteira', () => {
        expect(rota).toMatch(/router\.get\('\/vinculo-sugestoes', requireAdmin/);
    });

    it('e a tela chama a rota (aba 🔗 Vínculos)', () => {
        expect(servico).toMatch(/\/api\/admin\/whatsapp\/vinculo-sugestoes/);
        expect(tela).toMatch(/sugestoesDeVinculo\(\)/);
        expect(tela).toMatch(/'vinculos', '🔗 Vínculos'/);
    });

    it('🚨 a rota NÃO grava nada — ela mede; quem vincula é o clique', () => {
        // Vínculo automático mostraria a guia de um cliente na conversa de
        // outro no dia em que o número trocar de dono.
        const bloco = rota.slice(rota.indexOf("router.get('/vinculo-sugestoes'"));
        const corpo = bloco.slice(0, bloco.indexOf('\n});'));
        expect(corpo).not.toMatch(/\.set\(|\.update\(|batch|FieldValue/);
    });

    it('LÁPIDE fica de fora — cadastro excluído não volta como sugestão', () => {
        const bloco = rota.slice(rota.indexOf("router.get('/vinculo-sugestoes'"));
        expect(bloco.slice(0, 2200)).toMatch(/_deleted \|\| x\._merged_into/);
    });

    it('já vinculado não entra na conta — pendência é quem NÃO tem', () => {
        const bloco = rota.slice(rota.indexOf("router.get('/vinculo-sugestoes'"));
        expect(bloco.slice(0, 2600)).toMatch(/filter\(\(c\) => !c\.empresaId\)/);
    });

    it('🚨 e a tela DIZ quantos clientes têm telefone — senão "0 sugestões" engana', () => {
        // Zero com cadastro vazio manda preencher cadastro; zero com cadastro
        // cheio é outro problema. Um número só faria procurar no lugar errado.
        expect(tela).toMatch(/empresasComNumero === 0/);
        expect(tela).toMatch(/Dados Fiscais/);
    });

    it('recorte da lista é DITO — nunca corte mudo', () => {
        expect(tela).toMatch(/Mostrando 50 de \{vincSug\.sugestoes\.length\}/);
    });
});

// ============================================================================
// 🔗 A SUGESTÃO NA CONVERSA — a aba 🔗 Vínculos limpa em massa UMA vez; esta
// linha resolve o dia a dia, no lugar onde a dúvida nasce (18/08).
// ============================================================================
describe('🔗 a conversa sem vínculo DIZ de quem o cadastro acha que é', () => {
    const raiz2 = (...p: string[]) => path.join(process.cwd(), ...p);
    const rota = fs.readFileSync(raiz2('sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = fs.readFileSync(raiz2('components/SpConnect/index.tsx'), 'utf8');

    it('a rota do cliente devolve a sugestão quando NÃO há vínculo', () => {
        const bloco = rota.slice(rota.indexOf("router.get('/conversas/:numero/cliente'"));
        expect(bloco.slice(0, 1200)).toMatch(/vinculado: false, sugestao/);
    });

    it('🚨 e a tela CONSULTA a conversa sem vínculo — senão a sugestão nunca aparece', () => {
        // O `return` antigo exigia `empresaId`: só perguntava a quem já tinha
        // resposta. A sugestão existiria no backend e em tela nenhuma.
        const bloco = tela.slice(tela.indexOf('const [cliente360, setCliente360]'));
        expect(bloco.slice(0, 900)).not.toMatch(/if \(!numero \|\| !sel\?\.empresaId\) return;/);
        expect(bloco.slice(0, 900)).toMatch(/if \(!numero\) return;/);
    });

    it('a sugestão vira BOTÃO de confirmar, com o campo que casou na frase', () => {
        expect(tela).toMatch(/Confirmar este cliente/);
        expect(tela).toMatch(/WhatsApp do cliente/);
    });

    it('🚨 ambígua NÃO ganha botão — o app não escolhe entre dois cadastros', () => {
        const bloco = tela.slice(tela.indexOf("cliente360?.sugestao?.situacao === 'ambigua'"));
        expect(bloco.slice(0, 600)).toMatch(/está em mais de um cadastro/);
        expect(bloco.slice(0, 600)).not.toMatch(/acaoVincular\(/);
    });

    it('🚨 a projeção do índice carrega a LÁPIDE — campo fora do select some da leitura', () => {
        // Sem `_deleted`/`_merged_into` no `.select()`, o filtro passaria todo
        // mundo e o app sugeriria cadastro que a casa já apagou (21/08).
        expect(rota).toMatch(/CAMPOS_PARA_SUGESTAO_VINCULO = \[[^\]]*'_deleted'[^\]]*'_merged_into'/);
    });

    it('índice cacheado por janela — sugestão não custa uma varredura por conversa', () => {
        expect(rota).toMatch(/JANELA_INDICE_VINCULO_MS/);
    });
});

// ============================================================================
// 🚨 CONTATO ≠ CONVERSA — a primeira medição real inflou o buraco 7×
//
// 26/08, print do Paulo: **2.216 contatos sem vínculo · 2.159 sem cadastro**.
// Lido assim, parece 2.159 clientes perdidos. Mas `whatsapp_contatos` guarda
// também o CATÁLOGO importado da Ultra Fox — gente que nunca trocou uma
// mensagem no Connect. Cobrar "preencha o cadastro" sobre uma agenda que em
// boa parte nem é de cliente é alarme com número inflado, e alarme inflado é o
// que faz a equipe parar de olhar o painel.
// ============================================================================
describe('🚨 o recorte de quem JÁ ESCREVEU', () => {
    const empresas = [{ id: 'e1', nome: 'PADARIA', dadosFiscais: { whatsappCliente: '11997377599' } }];

    it('conta à parte quem tem conversa de quem é só agenda', () => {
        const r = cruzarNumerosComCadastro({
            conversas: [
                { numero: '5511997377599', temConversa: true },    // cliente que escreveu
                { numero: '5511911112222', temConversa: true },    // escreveu, sem cadastro
                { numero: '5511933334444', temConversa: false },   // só agenda importada
                { numero: '5511944445555', temConversa: false },
            ],
            empresas,
        });
        expect(r.total).toBe(4);              // a agenda inteira
        expect(r.ativos.total).toBe(2);       // o que muda a tela do atendente
        expect(r.ativos.sugestoes).toBe(1);
        expect(r.ativos.semCadastro).toBe(1);
        expect(r.semCadastro).toHaveLength(3);   // 3 na agenda, mas só 1 escreveu
    });

    it('e a linha carrega o fato — a tela precisa saber qual é qual', () => {
        const r = cruzarNumerosComCadastro({
            conversas: [{ numero: '5511997377599', temConversa: true }], empresas,
        });
        expect(r.sugestoes[0].temConversa).toBe(true);
    });

    it('🚨 a tela DIZ os dois números — o da agenda e o de quem escreveu', () => {
        const tela = fs.readFileSync(path.join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');
        expect(tela).toMatch(/vincSug\.ativos\?\.total/);
        expect(tela).toMatch(/nunca escreveu aqui/);
        // E o TETO do método, senão "25 de 2.216" parece fracasso quando na
        // verdade só 244 clientes têm telefone cadastrado.
        expect(tela).toMatch(/teto do que este cruzamento consegue achar/);
    });

    it('a leitura das conversas é só de IDS — booleano não paga documento', () => {
        const rota = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
        expect(rota).toMatch(/collection\('whatsapp_conversas'\)\.select\(\)\.get\(\)/);
    });
});

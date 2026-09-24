// ============================================================================
// 🚨 A JANELA FECHOU E O AVISO MANDAVA REDIGITAR O NÚMERO
//
// 23/09, achado de um COLABORADOR no atendimento do Eduardo Guerra (Paulo
// trouxe o print): com a janela de 24h fechada, o rodapé do composer dizia
// *"o envio de template direto daqui chega na próxima etapa; por enquanto use
// o envio de guia/template das telas do módulo"* — e nessas telas a pessoa
// **digita de novo** o número de quem já está aberto na tela.
//
// ⚠️ É A MESMA FAMÍLIA DO PREFIXO QUE O PAULO RECUSOU NA LIGAÇÃO (25/08):
// *"mandar a pessoa decorar um prefixo e REDIGITAR o número reintroduz à mão
// um dado que o sistema já tem — e é exatamente aí que um dígito errado liga
// para um estranho"*. Aqui o custo é o mesmo com outra roupa: template de
// cliente saindo para um número trocado.
//
// 📌 E O BACKEND JÁ FAZIA TUDO: `/conversas/iniciar` recebe número, template
// e variáveis desde sempre. Não faltava mecanismo — faltava o BOTÃO. Por isso
// a trava cobra o CAMINHO DO DADO (número, nome e fila saindo da conversa),
// não a existência de um botão bonito.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { filaParaTemplate } from '../services/spConnect';
import { podeIniciarTemplateNaConversa } from '../sefaz-backend/whatsapp-atendimento.js';
import { renderizarCorpoTemplate } from '../sefaz-backend/whatsapp-cloud.js';

const tela = readFileSync(join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');

describe('🚨 template fora da janela não faz redigitar o número', () => {
    it('o aviso da janela fechada oferece o envio PARA O CONTATO ABERTO', () => {
        expect(tela).toMatch(/Janela de 24h fechada/);
        expect(tela).toMatch(/abrirNovaPara\(sel\)/);
    });

    it('🚨 e o número vem da CONVERSA, nunca de digitação', () => {
        // O ponto inteiro do achado. Se algum dia isto virar um campo vazio
        // de novo, o defeito volta inteiro.
        expect(tela).toMatch(/para: conversa\.numero/);
        expect(tela).toMatch(/nomeContato: conversa\.nome/);
    });

    it('⚠️ a FILA vem da conversa, e a REGRA tem dono fora da tela', () => {
        // 🐛 AS DUAS ASSERÇÕES QUE MORAVAM AQUI PRENDIAM A IMPLEMENTAÇÃO
        // INLINE (`filasChip.some(...)`, `filasChip[0]?.id || ...`) e caíram
        // no minuto em que a regra virou função pura — sobre código MELHOR.
        // Trava que cobra a forma da linha atrapalha justamente o refactor
        // que ela deveria proteger. O que importa é que a tela CONSOME o
        // dono; o comportamento se prova executando `filaParaTemplate`,
        // no bloco do fim deste arquivo.
        expect(tela).toMatch(/filaParaTemplate\(/);
    });

    it('📌 o texto morto saiu — não promete mais "na próxima etapa"', () => {
        // A etapa chegou. Aviso que descreve um futuro que já é presente é a
        // classe que mordeu quatro vezes nesta semana.
        expect(tela).not.toMatch(/chega na próxima etapa/);
        expect(tela).not.toMatch(/use o envio de guia\/template das telas do módulo/);
    });

    it('🔒 e o carregamento de templates tem DONO ÚNICO', () => {
        // Duas portas abrem o mesmo modal (✚ Nova e "enviar para este
        // contato"). Duas cópias do carregamento divergiriam em silêncio no
        // primeiro filtro que mudasse — e o filtro aqui decide QUAIS
        // templates a pessoa pode mandar ao cliente.
        expect(tela).toMatch(/carregarTemplatesSePreciso/);
        expect((tela.match(/listarTemplatesDaMeta\(\)/g) || []).length).toBe(1);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// ✅ A PARTE QUE DÁ PARA PROVAR POR EXECUÇÃO
//
// Os testes acima são VARREDURA DE FONTE: provam que a fiação está escrita,
// não que o botão renderiza. A escolha da fila é a única decisão de verdade
// desta entrega, e ela foi extraída para função pura justamente para sair do
// regex e entrar no exercício real. O clique continua sendo prova da pessoa.
// ════════════════════════════════════════════════════════════════════════════
describe('✅ filaParaTemplate — exercitada, não varrida', () => {
    const filas = [{ id: 'contabil' }, { id: 'fiscal' }];

    it('a fila da conversa é respeitada quando a pessoa a enxerga', () => {
        expect(filaParaTemplate('contabil', filas, 'fiscal')).toBe('contabil');
    });

    it('🚨 conversa na RECEPÇÃO (fila null) não vira select vazio', () => {
        // Caso NORMAL, não exceção: toda conversa nova nasce sem fila.
        expect(filaParaTemplate(null, filas, 'fiscal')).toBe('contabil');
        expect(filaParaTemplate(undefined, filas, 'fiscal')).toBe('contabil');
    });

    it('🚨 fila que a pessoa NÃO enxerga cai na primeira dela', () => {
        // Devolver 'juridico' aqui renderizaria um <select> vazio e o envio
        // falharia sem causa — a lição de 16/08.
        expect(filaParaTemplate('juridico', filas, 'fiscal')).toBe('contabil');
    });

    it('⚠️ sem fila nenhuma visível, devolve o padrão — nunca string vazia', () => {
        // Campo vazio é o que faz o envio morrer calado; o padrão ao menos
        // chega ao backend, que recusa com motivo.
        expect(filaParaTemplate('contabil', [], 'fiscal')).toBe('fiscal');
        expect(filaParaTemplate(null, [], 'fiscal')).toBe('fiscal');
    });

    it('e a tela CONSOME o dono — não reimplementa a escolha', () => {
        expect(tela).toMatch(/filaParaTemplate\(conversa\.fila, filasChip, nc\.departamento\)/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 24/09, O PRIMEIRO USO REAL DO BOTÃO — três coisas que o print mostrou
//
// O Paulo clicou, o template saiu (✓✓)… e a tela: (1) mostrou o balão como
// `📋 iniciarconversa:` e NADA depois — um template sem variável virava só o
// nome; (2) não disse que a janela continua fechada (regra da Meta), então
// ele clicou DE NOVO e o cliente recebeu duas vezes; (3) o painel passou a
// dizer "Atribuída a: ninguém ainda" porque o pós-envio substituía a conversa
// REAL por um stub com `atribuidoA: null`.
//
// E uma quarta, que o print NÃO mostrou mas o código sim: a recusa 409
// barrava o PRÓPRIO condutor — escrita para o ✚ Nova, onde "alguém já
// atende" é motivo; dentro da conversa, quem conduz é justamente quem pode.
// ════════════════════════════════════════════════════════════════════════════
describe('✅ podeIniciarTemplateNaConversa — exercitada', () => {
    it('conduzida por OUTRO recusa, e diz quem', () => {
        const r = podeIniciarTemplateNaConversa({ status: 'aberta', atribuidoA: 'ana@sp.com' }, 'vilson@sp.com');
        expect(r.ok).toBe(false);
        expect((r as any).emConducaoPor).toBe('ana@sp.com');
    });

    it('🚨 conduzida por MIM libera — quem conduz é a voz da conversa', () => {
        expect(podeIniciarTemplateNaConversa({ status: 'aberta', atribuidoA: 'vilson@sp.com' }, 'vilson@sp.com').ok).toBe(true);
        // e-mail não diferencia maiúscula
        expect(podeIniciarTemplateNaConversa({ status: 'aberta', atribuidoA: 'Vilson@SP.com' }, 'vilson@sp.com').ok).toBe(true);
    });

    it('sem dono, resolvida ou inexistente: ok', () => {
        expect(podeIniciarTemplateNaConversa({ status: 'aberta', atribuidoA: null }, 'x@sp.com').ok).toBe(true);
        expect(podeIniciarTemplateNaConversa({ status: 'resolvida', atribuidoA: 'ana@sp.com' }, 'x@sp.com').ok).toBe(true);
        expect(podeIniciarTemplateNaConversa(null, 'x@sp.com').ok).toBe(true);
    });

    it('e a rota CONSOME o dono', () => {
        const rotas = readFileSync(join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
        expect(rotas).toMatch(/podeIniciarTemplateNaConversa\(cx, req\.user\?\.email\)/);
    });
});

describe('✅ renderizarCorpoTemplate — o balão mostra o que o cliente recebeu', () => {
    it('preenche {{n}} na ordem', () => {
        expect(renderizarCorpoTemplate('Olá {{1}}, sua guia de {{2}} venceu.', ['Ana', 'DAS']))
            .toBe('Olá Ana, sua guia de DAS venceu.');
    });

    it('🚨 template SEM variável devolve o corpo inteiro — era o caso do print', () => {
        // `iniciarconversa` não tem {{n}}: antes o balão ficava `📋 iniciarconversa:`.
        expect(renderizarCorpoTemplate('Olá! Aqui é a SP Assessoria. Como podemos ajudar?', []))
            .toBe('Olá! Aqui é a SP Assessoria. Como podemos ajudar?');
    });

    it('⚠️ variável que faltou FICA como {{n}} — nunca vira vazio', () => {
        expect(renderizarCorpoTemplate('Olá {{1}}, {{2}}.', ['Ana'])).toBe('Olá Ana, {{2}}.');
        expect(renderizarCorpoTemplate('{{1}}', [''])).toBe('{{1}}');
    });

    it('e a rota grava o texto RENDERIZADO, com o fallback dito', () => {
        const rotas = readFileSync(join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
        expect(rotas).toMatch(/texto: corpoRenderizado \|\| resumo/);
        expect(rotas).toMatch(/corpoIndisponivel: !corpoRenderizado/);
        // e devolve à tela o que saiu + que a janela não abriu
        expect(rotas).toMatch(/janelaAbreSoComResposta: true/);
    });
});

describe('🚨 depois do envio a tela não mente nem cala', () => {
    it('o pós-envio reabre a conversa REAL, não o stub', () => {
        // "Atribuída a: ninguém ainda" logo após mandar — era o stub.
        expect(tela).toMatch(/const lista = await recarregar\(true\)/);
        expect(tela).toMatch(/abrir\(real \|\| nova\)/);
    });

    it('e DIZ que a janela só abre com a resposta do cliente', () => {
        expect(tela).toMatch(/A janela de 24h só abre quando o cliente responder/);
        expect(tela).toMatch(/Não reenvie: o cliente já recebeu/);
    });

    it('o aviso é DESTA conversa — trocar de conversa o apaga', () => {
        expect(tela).toMatch(/templateEnviado\.numero !== sel\?\.numero\) setTemplateEnviado\(null\)/);
    });
});

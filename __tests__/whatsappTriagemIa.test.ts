// ============================================================================
// 🤖 A IA DE TRIAGEM — o que ela pode e, principalmente, o que ela NÃO pode
//
// Paulo (25/08): "o que acha de ligarmos uma IA no bot?" → "vamos tocar na sua
// sugestão". O buraco que ela fecha está numa linha do bot: texto livre caía no
// `else` e o cliente recebia o MENU de novo ("preciso da 2ª via do DAS" →
// "digite 1 para Recepção…").
//
// 🚨 A TRAVA QUE MANDA NESTE ARQUIVO É A DO LIMITE. Bot de escritório contábil
// respondendo matéria fiscal por conta própria é o `1405` no pior lugar que
// existe: inventado, por escrito, com o nome da casa, direto ao cliente. Por
// isso aqui se prova que a saída é FECHADA (uma fila do menu ou nada) e que o
// prompt PROÍBE responder — e não só que a classificação funciona.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import {
    CONFIANCA_MINIMA_TRIAGEM,
    filasParaTriagem,
    valeClassificar,
    montarPromptTriagem,
    interpretarRespostaTriagem,
    decidirDestinoDaTriagem,
} from '../sefaz-backend/whatsapp-triagem-ia';
import { decidirAutomacao, configPadraoAtendimento, resolverConfig } from '../sefaz-backend/whatsapp-atendimento';

const raiz = (...p: string[]) => path.join(process.cwd(), ...p);

const CONFIG = resolverConfig({
    ...configPadraoAtendimento(),
    botAtivo: true, botAlcance: 'todos', triagemIaAtiva: true,
});
const FILAS = filasParaTriagem(CONFIG);

describe('🤖 de onde saem os destinos', () => {
    it('as filas vêm do MENU configurado, nunca de uma lista escrita na IA', () => {
        // Menu editado na ⚙️ → a IA passa a conhecer o que foi editado. Uma
        // segunda lista divergiria no primeiro item que o Paulo mudasse.
        const cfg = resolverConfig({
            ...configPadraoAtendimento(), botAtivo: true,
            menu: [{ opcao: '1', fila: 'fiscal', rotulo: 'Fiscal' }],
        });
        expect(filasParaTriagem(cfg)).toEqual([{ fila: 'fiscal', rotulo: 'Fiscal' }]);
    });

    it('sub-opções entram como destino — elas são folhas do mesmo mapa', () => {
        // ⚠️ O id é `dp-folha`, não `dp`. Escrevi `dp` na 1ª versão deste teste
        // e ele reprovou — porque `resolverConfig` DESCARTA fila fora do
        // catálogo. Ou seja, a trava pegou uma fila inventada no meu próprio
        // fixture, que é exatamente o serviço que ela presta em produção.
        const cfg = resolverConfig({
            ...configPadraoAtendimento(), botAtivo: true,
            menu: [{
                opcao: '1', fila: 'recepcao', rotulo: 'Recepção',
                submenu: [{ opcao: '1', fila: 'dp-folha', rotulo: 'DP' }, { opcao: '2', fila: 'fiscal', rotulo: 'Fiscal' }],
            }],
        });
        expect(filasParaTriagem(cfg).map((f: { fila: string }) => f.fila)).toEqual(['dp-folha', 'fiscal']);
    });
});

describe('🤖 quando NÃO vale gastar uma chamada', () => {
    it.each(['1', '10', 'oi', 'Olá', 'bom dia', 'ok', 'obrigado', '#menu', '#sair', '  '])(
        '"%s" não vai para a IA', (t) => expect(valeClassificar(t)).toBe(false),
    );

    it('texto de verdade vai', () => {
        expect(valeClassificar('preciso da segunda via do DAS de julho')).toBe(true);
    });
});

describe('🚨 o prompt PROÍBE responder ao cliente', () => {
    const prompt = montarPromptTriagem({ texto: 'quanto é meu DAS?', filas: FILAS });

    it('manda escolher da lista, e a lista está DENTRO do prompt', () => {
        for (const f of FILAS) expect(prompt).toContain(`- ${f.fila}:`);
        expect(prompt).toMatch(/use exatamente o identificador/i);
    });

    it('🚨 diz com todas as letras que ela NÃO dá informação fiscal', () => {
        // Modelo prestativo tenta ajudar, e "ajudar" aqui é o dano.
        expect(prompt).toMatch(/NUNCA responda a dúvida do cliente/);
        expect(prompt).toMatch(/NUNCA dê informação fiscal/);
    });

    it('tem a saída "nenhuma" — sem ela, o modelo escolhe algo para agradar', () => {
        expect(prompt).toContain('"nenhuma"');
    });

    it('o texto do cliente é truncado (mensagem gigante não vira prompt gigante)', () => {
        const p = montarPromptTriagem({ texto: 'a'.repeat(5000), filas: FILAS });
        expect(p.length).toBeLessThan(3000);
    });
});

describe('🚨 a saída é FECHADA', () => {
    it('fila fora do menu NÃO vira fila — volta nomeada como inexistente', () => {
        const r = interpretarRespostaTriagem('{"fila":"marketing","confianca":0.99}', FILAS);
        expect(r?.fila).toBeNull();
        expect(r?.invalida).toBe('marketing');
        const d = decidirDestinoDaTriagem({ resultado: r, filas: FILAS });
        expect(d.fila).toBeNull();
        expect(d.situacao).toBe('fila-inexistente');
    });

    it('"nenhuma" é resposta legítima e vira null', () => {
        expect(interpretarRespostaTriagem('{"fila":"nenhuma","confianca":0.9}', FILAS)).toBeNull();
    });

    it('resposta que não é JSON não derruba nada — vira "não entendi"', () => {
        expect(interpretarRespostaTriagem('desculpe, não posso ajudar', FILAS)).toBeNull();
        expect(decidirDestinoDaTriagem({ resultado: null, filas: FILAS }).situacao).toBe('nao-entendi');
    });

    it('JSON embrulhado em ```json é lido (isso é forma, não conteúdo)', () => {
        const r = interpretarRespostaTriagem('```json\n{"fila":"fiscal","confianca":0.9}\n```', FILAS);
        expect(r?.fila).toBe('fiscal');
    });

    it('confiança fora de 0-1 é aparada, não aceita como veio', () => {
        expect(interpretarRespostaTriagem('{"fila":"fiscal","confianca":7}', FILAS)?.confianca).toBe(1);
        expect(interpretarRespostaTriagem('{"fila":"fiscal","confianca":-3}', FILAS)?.confianca).toBe(0);
        expect(interpretarRespostaTriagem('{"fila":"fiscal"}', FILAS)?.confianca).toBe(0);
    });
});

describe('🚨 na dúvida, o comportamento de HOJE', () => {
    it(`abaixo de ${CONFIANCA_MINIMA_TRIAGEM} não encaminha — e diz o que ela sugeria`, () => {
        const d = decidirDestinoDaTriagem({
            resultado: { fila: 'fiscal', confianca: 0.5, motivo: 'talvez' }, filas: FILAS,
        });
        expect(d.fila).toBeNull();
        expect(d.situacao).toBe('sem-certeza');
        expect(d.sugeria).toBe('fiscal');
    });

    it('IA fora do ar é situação PRÓPRIA — não se confunde com "não entendi"', () => {
        // As duas mandam mostrar o menu hoje, mas são fatos diferentes: um
        // contador só faria "a triagem parou de pegar" virar palpite.
        const d = decidirDestinoDaTriagem({ resultado: null, filas: FILAS, erro: new Error('tempo esgotado') });
        expect(d.situacao).toBe('ia-indisponivel');
        expect(d.detalhe).toMatch(/tempo esgotado/);
    });

    it('com certeza, encaminha e carrega o RÓTULO da fila', () => {
        const d = decidirDestinoDaTriagem({
            resultado: { fila: 'fiscal', confianca: 0.95, motivo: 'pediu guia de imposto' }, filas: FILAS,
        });
        expect(d).toMatchObject({ fila: 'fiscal', situacao: 'classificada', confianca: 0.95 });
        expect(d.rotulo).toBeTruthy();
    });
});

describe('🚨 o cérebro do bot com a sugestão da IA', () => {
    const base = {
        conversa: {}, numero: '5511999999999', nomeContato: 'Fulano',
        config: CONFIG, agora: new Date('2026-08-25T14:00:00-03:00'), protocoloNovo: 'P1',
    };

    it('texto livre COM sugestão encaminha, e carimba a origem', () => {
        const acoes = decidirAutomacao({
            ...base, textoMensagem: 'preciso da 2ª via do DAS',
            filaSugerida: { fila: 'fiscal', rotulo: 'Fiscal', confianca: 0.9, motivo: 'guia de imposto' },
        });
        const tipos = acoes.map((a: any) => a.tipo);
        expect(tipos).toContain('definirFila');
        // O carimbo existe porque quem assume precisa saber que o cliente NÃO
        // escolheu — automático pode estar errado.
        expect(tipos).toContain('registrarTriagemIa');
        // E o 1º contato continua ganhando protocolo e saudação ANTES.
        expect(tipos.indexOf('gravarProtocolo')).toBeLessThan(tipos.indexOf('definirFila'));
    });

    it('texto livre SEM sugestão mostra o menu — o comportamento de sempre', () => {
        const acoes = decidirAutomacao({ ...base, textoMensagem: 'preciso de ajuda', filaSugerida: null });
        expect(acoes.map((a: any) => a.tipo)).not.toContain('definirFila');
        expect(acoes.some((a: any) => a.tipo === 'responder' && /Digite uma das seguintes/.test(a.texto))).toBe(true);
    });

    it('🚨 sugestão com fila FORA do catálogo é barrada aqui também', () => {
        // Segunda porta de propósito: a régua lá fora já deveria ter barrado,
        // e mesmo assim o cérebro não aceita fila que não existe.
        const acoes = decidirAutomacao({
            ...base, textoMensagem: 'quero falar sobre marketing',
            filaSugerida: { fila: 'marketing', rotulo: 'Marketing', confianca: 1 },
        });
        expect(acoes.map((a: any) => a.tipo)).not.toContain('definirFila');
    });

    it('🚨 dígito do menu NÃO passa pela IA — a escolha do cliente vence', () => {
        const acoes = decidirAutomacao({
            ...base, textoMensagem: '1',
            filaSugerida: { fila: 'fiscal', rotulo: 'Fiscal', confianca: 1 },
        });
        const definir = acoes.find((a: any) => a.tipo === 'definirFila') as any;
        expect(definir.fila).toBe(CONFIG.menu[0].fila);   // o que ELE digitou
        expect(acoes.map((a: any) => a.tipo)).not.toContain('registrarTriagemIa');
    });

    it('🚨 conversa COM DONO não recebe encaminhamento da IA', () => {
        // A mesma trava de 17/08: o bot não fala por cima de atendimento em
        // andamento. Aqui vale dobrado — a IA moveria a conversa de fila.
        const acoes = decidirAutomacao({
            ...base, conversa: { atribuidoA: 'alguem@sp.com.br' },
            textoMensagem: 'preciso da 2ª via do DAS',
            filaSugerida: { fila: 'fiscal', rotulo: 'Fiscal', confianca: 1 },
        });
        expect(acoes).toEqual([]);
    });

    it('🚨 #sair e #menu vencem a IA', () => {
        const sair = decidirAutomacao({
            ...base, textoMensagem: '#sair',
            filaSugerida: { fila: 'fiscal', rotulo: 'Fiscal', confianca: 1 },
        });
        expect(sair.map((a: any) => a.tipo)).toContain('resolverConversa');
        expect(sair.map((a: any) => a.tipo)).not.toContain('definirFila');
    });
});

describe('🚨 a chave e a fiação', () => {
    const cfgSrc = fs.readFileSync(raiz('sefaz-backend/whatsapp-atendimento.js'), 'utf8');
    const rota = fs.readFileSync(raiz('sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');
    const tela = fs.readFileSync(raiz('components/SpConnect/index.tsx'), 'utf8');

    it('NASCE DESLIGADA — a régua da casa para tudo que fala com o CLIENTE', () => {
        expect(configPadraoAtendimento().triagemIaAtiva).toBe(false);
        expect(resolverConfig({}).triagemIaAtiva).toBe(false);
        // Config gravada antes do campo existir também fica desligada.
        expect(resolverConfig({ botAtivo: true }).triagemIaAtiva).toBe(false);
        expect(resolverConfig({ triagemIaAtiva: true }).triagemIaAtiva).toBe(true);
    });

    it('🚨 a chave tem BOTÃO — régua sem tela é código morto com cara de entrega', () => {
        expect(tela).toContain('triagemIaAtiva');
        // E o texto diz o LIMITE, senão "IA no bot" se lê como "o bot tira dúvidas".
        expect(tela).toMatch(/só classifica/);
        expect(tela).toMatch(/nunca responde ao cliente/i);
    });

    it('🚨 a IA só é consultada no estado de TRIAGEM', () => {
        expect(rota).toMatch(/const emTriagem = !conversa\.fila && !conversa\.atribuidoA && !conversa\.submenuAberto/);
    });

    it('🚨 a chamada tem PRAZO — cliente esperando não pode ficar refém do modelo', () => {
        expect(rota).toMatch(/TEMPO_MAX_TRIAGEM_MS/);
        expect(rota).toMatch(/Promise\.race/);
    });

    it('🚨 o modelo sai do resolvedor do app, nunca cravado', () => {
        // Id cravado é a segunda régua do modelo — custou caro em 15/08.
        expect(rota).toMatch(/app\.get\('geminiModelos'\)/);
        expect(rota).not.toMatch(/model:\s*['"]gemini-/);
    });

    it('o cérebro continua PURO — nada de rede dentro dele', () => {
        expect(cfgSrc).not.toMatch(/generateContent|fetch\(/);
    });

    it('o carimbo da IA vira nota INTERNA (o cliente não vê) e campo na conversa', () => {
        expect(rota).toMatch(/registrarTriagemIa/);
        expect(rota).toMatch(/direcao: 'interna', tipo: 'nota'/);
        expect(rota).toMatch(/confira se é a fila certa/);
    });
});

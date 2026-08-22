// ============================================================================
// F3 do SP Connect — triagem, filas e automações (núcleo puro).
// Régua de paridade: os prints do bot atual (16/08).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    FILAS_ATENDIMENTO, filaValida, filasVisiveis, conversaVisivel,
    configPadraoAtendimento, resolverConfig, dentroDoHorario,
    gerarProtocolo, renderMensagem, montarTextoMenu, interpretarEscolha,
    decidirAutomacao, papelValido, podeEncerrar, interpretarNota,
    botAlcancaNumero, soDigitos, emConducaoHumana, coberturaDasFilas,
} from '../sefaz-backend/whatsapp-atendimento.js';

describe('filas de atendimento (≠ departamentos do SaaS)', () => {
    it('as 8 filas do menu atual, com RH e Jurídico separados (decisão de 16/08)', () => {
        expect(FILAS_ATENDIMENTO.map((f: any) => f.id)).toEqual(
            ['recepcao', 'financeiro', 'dp-folha', 'fiscal', 'contabil', 'legalizacao', 'rh', 'juridico'],
        );
        expect(filaValida('rh')).toBe(true);
        expect(filaValida('marketing')).toBe(false);
    });

    it('Recepção atende TODOS; os demais veem a própria + Recepção; admin vê tudo', () => {
        expect(filasVisiveis({ role: 'admin' })).toBeNull();
        expect(filasVisiveis({ role: 'colaborador', filasAtendimento: ['recepcao'] })).toBeNull();
        expect(filasVisiveis({ role: 'colaborador', departamentos: ['fiscal'] })).toEqual(['fiscal', 'recepcao']);
        // filasAtendimento explícita VENCE os departamentos de módulo
        expect(filasVisiveis({ role: 'colaborador', departamentos: ['fiscal'], filasAtendimento: ['rh'] })).toEqual(['rh', 'recepcao']);
    });

    it('conversa sem fila é da Recepção — todo atendente a enxerga', () => {
        expect(conversaVisivel(['fiscal', 'recepcao'], null)).toBe(true);
        expect(conversaVisivel(['fiscal', 'recepcao'], 'juridico')).toBe(false);
        expect(conversaVisivel(null, 'juridico')).toBe(true);
    });
});

describe('papéis do atendimento (Paulo, 16/08): admin tudo · gestor vê/atende/encerra tudo · colaborador só o seu', () => {
    it('gestor vê TODAS as filas; papel desconhecido é recusado', () => {
        expect(filasVisiveis({ role: 'colaborador', papelAtendimento: 'gestor', departamentos: ['fiscal'] })).toBeNull();
        expect(papelValido('gestor')).toBe(true);
        expect(papelValido('colaborador')).toBe(true);
        expect(papelValido('supervisor')).toBe(false);
    });
    it('encerrar: admin e gestor qualquer atendimento; colaborador SÓ o que conduz', () => {
        expect(podeEncerrar({ role: 'admin', email: 'a@sp', atribuidoA: 'x@sp' })).toBe(true);
        expect(podeEncerrar({ role: 'colaborador', papelAtendimento: 'gestor', email: 'g@sp', atribuidoA: 'x@sp' })).toBe(true);
        expect(podeEncerrar({ role: 'colaborador', email: 'x@sp', atribuidoA: 'x@sp' })).toBe(true);
        expect(podeEncerrar({ role: 'colaborador', email: 'x@sp', atribuidoA: 'y@sp' })).toBe(false);
        expect(podeEncerrar({ role: 'colaborador', email: 'x@sp', atribuidoA: null })).toBe(false);
    });
});

describe('interpretarNota — a nota nunca é deduzida de texto livre', () => {
    it('aceita "5", " 5 ", "5.", "nota 4", "3 estrelas"; recusa o resto', () => {
        // Escala 5 EXPLÍCITA: este teste é sobre a leitura do texto, não sobre
        // qual escala a casa usa (essa é decisão do Paulo e tem teste próprio).
        expect(interpretarNota('5', 5)).toBe(5);
        expect(interpretarNota(' 5 ', 5)).toBe(5);
        expect(interpretarNota('5.', 5)).toBe(5);
        expect(interpretarNota('nota 4', 5)).toBe(4);
        expect(interpretarNota('3 estrelas', 5)).toBe(3);
        expect(interpretarNota('0', 5)).toBeNull();
        expect(interpretarNota('6', 5)).toBeNull();
        expect(interpretarNota('10', 5)).toBeNull();
        expect(interpretarNota('obrigado!', 5)).toBeNull();
        expect(interpretarNota('nota 5 pelo carinho', 5)).toBeNull();
    });
});

describe('config: padrão honesto e merge que não engole campo', () => {
    it('o bot NASCE DESLIGADO — dois bots no mesmo cliente é menu em dobro', () => {
        expect(configPadraoAtendimento().botAtivo).toBe(false);
    });
    it('o aviso de transferência ao cliente também NASCE DESLIGADO (admin liga)', () => {
        expect(configPadraoAtendimento().avisarClienteTransferencia).toBe(false);
        expect(configPadraoAtendimento().mensagens.transferencia).toContain('{fila}');
        expect(resolverConfig({ avisarClienteTransferencia: true }).avisarClienteTransferencia).toBe(true);
    });
    it('resolverConfig preserva o gravado e completa o que faltar', () => {
        const r = resolverConfig({ botAtivo: true, mensagens: { sair: 'Tchau!' } });
        expect(r.botAtivo).toBe(true);
        expect(r.mensagens.sair).toBe('Tchau!');
        expect(r.mensagens.saudacao).toContain('{protocolo}');
        expect(r.menu).toHaveLength(8);
        // item de menu com fila inválida é filtrado, nunca engolido em silêncio no envio
        expect(resolverConfig({ menu: [{ opcao: '1', fila: 'marketing', rotulo: 'X' }] }).menu).toHaveLength(8);
    });
});

describe('horário de funcionamento (SP, com almoço)', () => {
    const h = configPadraoAtendimento().horario; // seg-sex 8-12 / 13-17:30
    it('manhã e tarde dentro; almoço e noite fora; fim de semana fora', () => {
        expect(dentroDoHorario(h, new Date('2026-08-17T09:00:00-03:00'))).toBe(true);  // seg 9h
        expect(dentroDoHorario(h, new Date('2026-08-17T12:30:00-03:00'))).toBe(false); // almoço
        expect(dentroDoHorario(h, new Date('2026-08-17T17:29:00-03:00'))).toBe(true);
        expect(dentroDoHorario(h, new Date('2026-08-17T17:30:00-03:00'))).toBe(false);
        expect(dentroDoHorario(h, new Date('2026-08-16T10:00:00-03:00'))).toBe(false); // domingo
    });
});

describe('protocolo, templates e menu', () => {
    it('protocolo é número solto (estilo do bot atual) e cresce com o tempo', () => {
        const a = gerarProtocolo(new Date('2026-08-16T12:00:00Z'), 5);
        const b = gerarProtocolo(new Date('2026-08-16T12:00:01Z'), 5);
        expect(a).toMatch(/^\d+$/);
        expect(Number(b)).toBeGreaterThan(Number(a));
    });
    it('placeholders preenchem; desconhecido fica VISÍVEL (nunca some em silêncio)', () => {
        expect(renderMensagem('Oi {nome}, protocolo {protocolo}', { nome: 'Ju', protocolo: '123' }))
            .toBe('Oi Ju, protocolo 123');
        expect(renderMensagem('Oi {nome}', {})).toBe('Oi {nome}');
    });
    it('menu lista as 8 opções e a escolha aceita "1", "1." e " 1 "', () => {
        const cfg = configPadraoAtendimento();
        const menu = montarTextoMenu(cfg);
        expect(menu).toContain('1 - Recepção / Front Desk');
        expect(menu).toContain('8 - Departamento - Jurídico');
        expect(interpretarEscolha('4', cfg)?.fila).toBe('fiscal');
        expect(interpretarEscolha(' 8. ', cfg)?.fila).toBe('juridico');
        expect(interpretarEscolha('99', cfg)).toBeNull();
        expect(interpretarEscolha('quero falar do DAS', cfg)).toBeNull();
    });
});

describe('decidirAutomacao — o cérebro, puro', () => {
    // Alcance 'todos' de propósito: esta suíte testa o CÉREBRO do bot. Quem
    // decide A QUEM ele responde é `botAlcancaNumero`, com testes próprios.
    const cfg = { ...configPadraoAtendimento(), botAtivo: true, botAlcance: 'todos' as const };
    const dentroDoExpediente = new Date('2026-08-17T09:00:00-03:00');

    it('bot desligado = silêncio TOTAL (a plataforma atual ainda responde)', () => {
        expect(decidirAutomacao({ conversa: {}, textoMensagem: 'oi', config: configPadraoAtendimento(), agora: dentroDoExpediente })).toEqual([]);
    });

    it('1º contato: protocolo + saudação com nome + menu', () => {
        const acoes = decidirAutomacao({
            conversa: {}, textoMensagem: 'Bom dia', nomeContato: 'Ju',
            config: cfg, agora: dentroDoExpediente, protocoloNovo: '2077',
        });
        expect(acoes[0]).toEqual({ tipo: 'gravarProtocolo', protocolo: '2077' });
        expect(acoes[1].texto).toContain('Ju, aguarde um momento');
        expect(acoes[1].texto).toContain('Protocolo: 2077');
        expect(acoes[2].texto).toContain('1 - Recepção / Front Desk');
    });

    it('escolha numérica define a fila e confirma com o nome da fila', () => {
        const acoes = decidirAutomacao({
            conversa: { protocolo: '2077' }, textoMensagem: '5',
            config: cfg, agora: dentroDoExpediente,
        });
        expect(acoes[0]).toEqual({ tipo: 'definirFila', fila: 'contabil' });
        expect(acoes[1].texto).toContain('Gestão - Departamento Contábil');
    });

    it('conversa JÁ triada não recebe menu — atendente humano assume dali', () => {
        const acoes = decidirAutomacao({
            conversa: { fila: 'fiscal', protocolo: '2077' }, textoMensagem: 'segue o comprovante',
            config: cfg, agora: dentroDoExpediente,
        });
        expect(acoes).toEqual([]);
    });

    it('#sair encerra: reseta a triagem, RESOLVE (por cliente) e — com a pesquisa ligada — pede a nota', () => {
        const acoes = decidirAutomacao({ conversa: { fila: 'fiscal' }, textoMensagem: '#sair', config: cfg, agora: dentroDoExpediente });
        expect(acoes[0]).toEqual({ tipo: 'resetarTriagem' });
        expect(acoes[1]).toEqual({ tipo: 'resolverConversa', por: 'cliente' });
        expect(acoes[2].texto).toContain('encerrado');
        expect(acoes.some((a: any) => a.tipo === 'marcarAguardandoAvaliacao')).toBe(false); // pesquisa desligada
        const comPesquisa = decidirAutomacao({
            conversa: { fila: 'fiscal' }, textoMensagem: '#sair',
            config: { ...cfg, avaliacaoAtiva: true }, agora: dentroDoExpediente,
        });
        expect(comPesquisa.some((a: any) => a.texto?.includes('1 a 10'))).toBe(true);
        expect(comPesquisa[comPesquisa.length - 1]).toEqual({ tipo: 'marcarAguardandoAvaliacao' });
    });

    it('#menu reapresenta o menu em qualquer estado — é o cliente pedindo outro depto', () => {
        const acoes = decidirAutomacao({ conversa: { fila: 'fiscal', protocolo: '2077' }, textoMensagem: '#menu', config: cfg, agora: dentroDoExpediente });
        expect(acoes[0]).toEqual({ tipo: 'resetarTriagem' });
        // Volta pra triagem SEM dono — senão a conversa cairia na fila nova
        // com o atendente da fila velha (o estado que a transferência evita).
        expect(acoes[1]).toEqual({ tipo: 'liberarConducao' });
        expect(acoes[2].texto).toContain('1 - Recepção / Front Desk');
        // "2" solto em conversa TRIADA continua sendo resposta ao atendente, nunca menu
        expect(decidirAutomacao({ conversa: { fila: 'fiscal' }, textoMensagem: '2', config: cfg, agora: dentroDoExpediente })).toEqual([]);
    });

    it('fora do horário avisa UMA vez por dia por conversa (anti-metralhadora)', () => {
        const noite = new Date('2026-08-17T22:00:00-03:00');
        const primeira = decidirAutomacao({ conversa: { fila: 'fiscal' }, textoMensagem: 'oi', config: cfg, agora: noite });
        expect(primeira.some((a: any) => a.texto?.includes('horário de atendimento'))).toBe(true);
        expect(primeira.some((a: any) => a.tipo === 'marcarAusenciaEnviada')).toBe(true);
        const repetida = decidirAutomacao({
            conversa: { fila: 'fiscal', ausenciaAvisadaEm: '2026-08-17' }, textoMensagem: 'alguém?',
            config: cfg, agora: noite,
        });
        expect(repetida).toEqual([]);
    });
});

// ============================================================================
// 🖼️ IMAGEM POR FILA (20/08) — a arte do departamento que a Ultra Fox manda
// junto da confirmação. Fila sem imagem cadastrada segue só com o texto.
// ============================================================================

describe('🖼️ imagensPorFila — o banner que acompanha a confirmação da fila', () => {
    const cfg = { ...configPadraoAtendimento(), botAtivo: true, botAlcance: 'todos' as const };
    const dentroDoExpediente = new Date('2026-08-17T09:00:00-03:00');

    it('config nasce sem nenhuma imagem — nada muda pra quem não cadastrou', () => {
        expect(configPadraoAtendimento().imagensPorFila).toEqual({});
    });

    it('resolverConfig guarda a URL da fila válida', () => {
        const r = resolverConfig({ imagensPorFila: { rh: 'https://exemplo.com/rh.jpg' } });
        expect(r.imagensPorFila).toEqual({ rh: 'https://exemplo.com/rh.jpg' });
    });

    it('🚨 fila inválida ou URL vazia são DESCARTADAS na gravação, nunca a mensagem quebrada', () => {
        const r = resolverConfig({ imagensPorFila: { 'nao-existe': 'https://x', rh: '', fiscal: 42 } });
        expect(r.imagensPorFila).toEqual({});
    });

    it('escolha com imagem cadastrada: a imagem sai ANTES do texto de confirmação', () => {
        const comImagem = { ...cfg, imagensPorFila: { contabil: 'https://exemplo.com/contabil.jpg' } };
        const acoes = decidirAutomacao({
            conversa: { protocolo: '2077' }, textoMensagem: '5',
            config: comImagem, agora: dentroDoExpediente,
        });
        expect(acoes[0]).toEqual({ tipo: 'definirFila', fila: 'contabil' });
        expect(acoes[1]).toEqual({ tipo: 'enviarImagem', url: 'https://exemplo.com/contabil.jpg', fila: 'contabil' });
        expect(acoes[2].tipo).toBe('responder');
        expect(acoes[2].texto).toContain('Gestão - Departamento Contábil');
    });

    it('escolha SEM imagem cadastrada pra aquela fila: nenhuma ação enviarImagem', () => {
        const comOutraFila = { ...cfg, imagensPorFila: { rh: 'https://exemplo.com/rh.jpg' } };
        const acoes = decidirAutomacao({
            conversa: { protocolo: '2077' }, textoMensagem: '5', // 5 = contabil
            config: comOutraFila, agora: dentroDoExpediente,
        });
        expect(acoes.some((a: any) => a.tipo === 'enviarImagem')).toBe(false);
        expect(acoes).toHaveLength(2);
    });
});

// ============================================================================
// 🚨 ALCANCE DO BOT — o que torna a CONVIVÊNCIA possível.
//
// Paulo, 17/08: *"temos que permanecer com os 2 apps ativos, não faz sentido
// criar uma opção pra migrar o bot se os 2 não estiverem ativos"*.
//
// Os dois apps ficam assinados na WABA DE PROPÓSITO — a Ultra Fox é a rede de
// segurança enquanto o SP Connect é validado. Só que os dois recebem a MESMA
// mensagem: se os dois bots responderem, o cliente vê menu em dobro. A saída
// não é desligar a Ultra Fox antes da hora; é limitar QUEM o nosso bot atende.
// ============================================================================

describe('🚨 botAlcancaNumero — o piloto que deixa os dois apps de pé', () => {
    const piloto = (nums: string[]) => ({ botAlcance: 'piloto' as const, botNumerosPiloto: nums });

    it('responde ao número do piloto', () => {
        expect(botAlcancaNumero(piloto(['5511999990000']), '5511999990000')).toBe(true);
    });

    it('🚨 NÃO responde a quem está fora do piloto — é isso que protege o cliente', () => {
        expect(botAlcancaNumero(piloto(['5511999990000']), '5511888887777')).toBe(false);
    });

    it('🚨 lista VAZIA no piloto não responde a ninguém (não é "sem restrição")', () => {
        // A leitura oposta soltaria o bot na carteira inteira quando alguém
        // apagasse a lista sem querer.
        expect(botAlcancaNumero(piloto([]), '5511999990000')).toBe(false);
    });

    it('alcance "todos" responde a qualquer um — é o dia do corte', () => {
        expect(botAlcancaNumero({ botAlcance: 'todos' as const, botNumerosPiloto: [] }, '5511888887777')).toBe(true);
    });

    it('máscara no cadastro não impede o casamento (dígito é a chave)', () => {
        expect(botAlcancaNumero(piloto(['+55 (11) 99999-0000']), '5511999990000')).toBe(true);
    });

    it('🚨 casa pelos últimos 11 dígitos — o WhatsApp entrega ora com o 9, ora sem', () => {
        // Casar a string inteira faria o piloto "não pegar" justamente o
        // número que a pessoa acabou de cadastrar.
        expect(botAlcancaNumero(piloto(['11999990000']), '5511999990000')).toBe(true);
        expect(botAlcancaNumero(piloto(['5511999990000']), '11999990000')).toBe(true);
    });

    it('número ilegível não é atendido — bot não escapa do piloto pela porta dos fundos', () => {
        expect(botAlcancaNumero(piloto(['5511999990000']), '')).toBe(false);
        expect(botAlcancaNumero(piloto(['5511999990000']), null as any)).toBe(false);
    });

    it('config sem alcance definido cai no lado SEGURO (piloto), nunca em "todos"', () => {
        expect(botAlcancaNumero({} as any, '5511999990000')).toBe(false);
    });

    it('soDigitos tira máscara', () => {
        expect(soDigitos('+55 (11) 99999-0000')).toBe('5511999990000');
    });
});

describe('🚨 decidirAutomacao respeita o alcance', () => {
    const cfg = {
        ...resolverConfig({ botAtivo: true, botAlcance: 'piloto', botNumerosPiloto: ['5511999990000'] }),
    };

    it('número do piloto recebe o menu', () => {
        const acoes = decidirAutomacao({
            conversa: {}, numero: '5511999990000', textoMensagem: 'oi',
            config: cfg, protocoloNovo: 'P1',
        });
        expect(acoes.length).toBeGreaterThan(0);
    });

    it('🚨 número FORA do piloto recebe SILÊNCIO — igualzinho a bot desligado', () => {
        const acoes = decidirAutomacao({
            conversa: {}, numero: '5511888887777', textoMensagem: 'oi',
            config: cfg, protocoloNovo: 'P1',
        });
        expect(acoes).toEqual([]);
    });

    it('nem #sair escapa do alcance — comando de fora do piloto não age', () => {
        const acoes = decidirAutomacao({
            conversa: { fila: 'fiscal' }, numero: '5511888887777', textoMensagem: '#sair',
            config: cfg, protocoloNovo: 'P1',
        });
        expect(acoes).toEqual([]);
    });
});

describe('🚨 a migração não emudece o bot de quem já o tinha ligado', () => {
    it('config ANTIGA com bot ligado (sem o campo novo) segue respondendo a TODOS', () => {
        // Ela respondia a todo mundo; virar "piloto com lista vazia" a deixaria
        // MUDA — e o efeito só apareceria no cliente sem resposta, sem ninguém
        // ligar uma coisa à outra.
        const c = resolverConfig({ botAtivo: true });
        expect(c.botAlcance).toBe('todos');
        expect(botAlcancaNumero(c, '5511888887777')).toBe(true);
    });

    it('config NOVA (bot desligado) nasce em piloto — o lado seguro', () => {
        expect(resolverConfig({}).botAlcance).toBe('piloto');
        expect(configPadraoAtendimento().botAlcance).toBe('piloto');
    });

    it('escolha EXPLÍCITA do admin vence a retrocompatibilidade', () => {
        expect(resolverConfig({ botAtivo: true, botAlcance: 'piloto' }).botAlcance).toBe('piloto');
    });

    it('a lista gravada é normalizada pra dígitos', () => {
        const c = resolverConfig({ botNumerosPiloto: ['+55 (11) 99999-0000', 'xx'] });
        expect(c.botNumerosPiloto).toEqual(['5511999990000']);
    });
});

// ============================================================================
// 🚨 MATA-BURRO: O TEXTO NA TELA E A RÉGUA DO CÓDIGO NÃO PODEM DISCORDAR.
//
// Defeito real, 17/08, no PRIMEIRO teste ponta a ponta do Paulo. A mensagem
// de avaliação foi editada para "De 1 a 10" e o `interpretarNota` só aceitava
// 1-5. Ele respondeu **10** — e a nota virou `null`, sem registro e sem aviso.
// O painel 📊 mostraria "0 avaliações" com o cliente tendo avaliado.
//
// É a família do "número digitado sem documento por trás": duas leituras do
// mesmo fato discordando, e a perda acontecendo em silêncio. A escala virou
// DADO (a mensagem, a leitura e o painel leem dela) e o descarte virou
// REGISTRO NOMEADO.
// ============================================================================
import {
    ESCALAS_AVALIACAO, ESCALA_AVALIACAO_PADRAO, leituraDaNota, conferirEscalaNaMensagem,
} from '../sefaz-backend/whatsapp-atendimento.js';

describe('🚨 escala da avaliação — o texto e a régua andam juntos', () => {
    it('a escala padrão é 1 a 10 (decisão do Paulo, 17/08)', () => {
        expect(ESCALA_AVALIACAO_PADRAO).toBe(10);
        expect(configPadraoAtendimento().avaliacaoEscala).toBe(10);
        expect(configPadraoAtendimento().mensagens.avaliacao).toContain('1 a 10');
    });

    it('🚨 nota 10 é ACEITA na escala 10 — era exatamente a que se perdia', () => {
        expect(interpretarNota('10', 10)).toBe(10);
        expect(leituraDaNota('10', 10)).toEqual({ tipo: 'nota', nota: 10 });
    });

    it('na escala 5, o 10 não vira nota — mas é NOMEADO como fora da escala', () => {
        // `null` fundia "não é nota" com "é nota inválida", e são ações opostas.
        expect(leituraDaNota('10', 5)).toEqual({ tipo: 'fora-da-escala', nota: null, informado: 10, escala: 5 });
    });

    it('texto que não é número segue sendo "não é nota" (o fluxo normal continua)', () => {
        expect(leituraDaNota('bom dia', 10).tipo).toBe('nao-e-nota');
    });

    it('zero e 11 não viram nota na escala 10', () => {
        expect(interpretarNota('0', 10)).toBeNull();
        expect(interpretarNota('11', 10)).toBeNull();
    });

    it('escala inválida cai no padrão em vez de aceitar qualquer número', () => {
        expect(interpretarNota('10', 7 as any)).toBe(10);   // 7 não existe ⇒ padrão 10
        expect(interpretarNota('99', 999 as any)).toBeNull();
    });

    it('a config só aceita as escalas conhecidas', () => {
        expect(resolverConfig({ avaliacaoEscala: 5 }).avaliacaoEscala).toBe(5);
        expect(resolverConfig({ avaliacaoEscala: 7 }).avaliacaoEscala).toBe(ESCALA_AVALIACAO_PADRAO);
        expect(ESCALAS_AVALIACAO).toEqual([5, 10]);
    });
});

describe('🚨 conferirEscalaNaMensagem — a trava que teria pego o defeito', () => {
    it('acusa mensagem que pede 1 a 10 com escala 5, dizendo o custo', () => {
        const r = conferirEscalaNaMensagem('De 1 a 10, que nota você dá?', 5);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.erro).toMatch(/DESCARTADA/);
    });

    it('aceita quando os dois dizem a mesma coisa', () => {
        expect(conferirEscalaNaMensagem('De 1 a 10, que nota você dá?', 10).ok).toBe(true);
        expect(conferirEscalaNaMensagem('De 1 a 5, que nota?', 5).ok).toBe(true);
    });

    it('entende as várias formas de escrever a faixa', () => {
        expect(conferirEscalaNaMensagem('nota de 1 até 10', 10).ok).toBe(true);
        expect(conferirEscalaNaMensagem('nota 1-10', 10).ok).toBe(true);
    });

    it('texto SEM faixa explícita não é acusado — nem toda redação diz o intervalo', () => {
        const r = conferirEscalaNaMensagem('Que nota você dá para este atendimento?', 10);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.semFaixaNoTexto).toBe(true);
    });
});

// ============================================================================
// 🚨 O BOT NÃO TRIAGA POR CIMA DE QUEM ESTÁ ATENDENDO
//
// Achado ao ler o que aconteceria quando o alcance virar 'todos' — não veio de
// defeito reportado, e é justamente esse o ponto: ele só apareceria NO DIA DO
// CORTE, na frente do cliente, em série.
//
// A causa: o bot só age quando `!conversa.fila`, e "sem fila" foi lido como
// "está na triagem". Não é. Assumir (🙋), responder texto e mandar anexo
// gravam `atribuidoA` e NÃO gravam `fila` — fila só nasce da triagem do bot ou
// da transferência. Ou seja: toda conversa conduzida por gente hoje está, para
// o bot, na triagem.
//
// O que o cliente veria: por cima da resposta da colaboradora, *"aguarde um
// momento, logo te atenderemos"* + o menu de 8 opções + um protocolo NOVO numa
// conversa em andamento. E as conversas que já existem no app (as de antes do
// bot e as que vierem do backup da Ultra Fox) são exatamente as de `fila:
// null` — então isso seria o padrão do primeiro dia, não o caso raro.
// ============================================================================

describe('🚨 emConducaoHumana — a régua é o DONO, não a fila', () => {
    it('conversa ABERTA com dono está em condução', () => {
        expect(emConducaoHumana({ atribuidoA: 'ju@sp.com.br' })).toBe(true);
        expect(emConducaoHumana({ atribuidoA: 'ju@sp.com.br', status: 'aberta' })).toBe(true);
    });

    it('sem dono não está em condução — é triagem de verdade', () => {
        expect(emConducaoHumana({})).toBe(false);
        expect(emConducaoHumana({ atribuidoA: null })).toBe(false);
        expect(emConducaoHumana(null)).toBe(false);
    });

    it('RESOLVIDA solta a trava: cliente que volta depois do encerramento é atendimento NOVO', () => {
        expect(emConducaoHumana({ atribuidoA: 'ju@sp.com.br', status: 'resolvida' })).toBe(false);
    });
});

describe('🚨 decidirAutomacao com atendente conduzindo', () => {
    const cfg = { ...configPadraoAtendimento(), botAtivo: true, botAlcance: 'todos' as const };
    const dia = new Date('2026-08-17T09:00:00-03:00');

    it('conversa SEM fila mas COM dono: nada de saudação, menu ou protocolo', () => {
        const acoes = decidirAutomacao({
            // Exatamente o estado que 🙋/responder deixam: dono gravado, fila não.
            conversa: { atribuidoA: 'ju@sp.com.br' }, textoMensagem: 'segue o documento',
            nomeContato: 'Cliente', config: cfg, agora: dia, protocoloNovo: '2077',
        });
        expect(acoes).toEqual([]);
    });

    it('a MESMA conversa sem dono recebe a triagem — a diferença é só quem conduz', () => {
        const acoes = decidirAutomacao({
            conversa: {}, textoMensagem: 'segue o documento',
            nomeContato: 'Cliente', config: cfg, agora: dia, protocoloNovo: '2077',
        });
        expect(acoes.some((a: any) => a.tipo === 'gravarProtocolo')).toBe(true);
        expect(acoes.some((a: any) => a.texto?.includes('1 - Recepção / Front Desk'))).toBe(true);
    });

    it('número solto do cliente NÃO é escolha de menu quando alguém conduz', () => {
        // "quantas parcelas?" → "3". Sem a trava, o 3 viraria fila 'dp-folha'
        // e o cliente levaria "Você foi direcionado para..." no meio da conversa.
        const acoes = decidirAutomacao({
            conversa: { atribuidoA: 'ju@sp.com.br' }, textoMensagem: '3', config: cfg, agora: dia,
        });
        expect(acoes).toEqual([]);
    });

    it('#sair continua funcionando — é o CLIENTE encerrando, não o bot invadindo', () => {
        const acoes = decidirAutomacao({
            conversa: { atribuidoA: 'ju@sp.com.br' }, textoMensagem: '#sair', config: cfg, agora: dia,
        });
        expect(acoes.some((a: any) => a.tipo === 'resolverConversa')).toBe(true);
    });

    it('#menu continua funcionando e LIBERA a condução — o cliente pediu outro depto', () => {
        const acoes = decidirAutomacao({
            conversa: { atribuidoA: 'ju@sp.com.br' }, textoMensagem: '#menu', config: cfg, agora: dia,
        });
        expect(acoes.some((a: any) => a.tipo === 'liberarConducao')).toBe(true);
        expect(acoes.some((a: any) => a.texto?.includes('1 - Recepção'))).toBe(true);
    });

    it('fora de horário AVISA mesmo com atendente conduzindo — o cliente precisa saber que ninguém responde às 22h', () => {
        const noite = new Date('2026-08-17T22:00:00-03:00');
        const acoes = decidirAutomacao({
            conversa: { atribuidoA: 'ju@sp.com.br' }, textoMensagem: 'alguém aí?', config: cfg, agora: noite,
        });
        expect(acoes.some((a: any) => a.texto?.includes('horário de atendimento'))).toBe(true);
        // …e SÓ isso: nem menu, nem saudação por cima do atendimento.
        expect(acoes.some((a: any) => a.texto?.includes('1 - Recepção'))).toBe(false);
    });

    it('depois de ENCERRADA, o cliente que volta é triado normalmente', () => {
        const acoes = decidirAutomacao({
            conversa: { atribuidoA: 'ju@sp.com.br', status: 'resolvida', protocolo: '2077' },
            textoMensagem: 'oi, tenho outra dúvida', config: cfg, agora: dia,
        });
        expect(acoes.some((a: any) => a.texto?.includes('1 - Recepção'))).toBe(true);
    });
});

// ============================================================================
// 🚨 O MENU PROMETE 8 DEPARTAMENTOS — TEM GENTE EM CADA UM?
//
// O bot pergunta para onde o cliente quer ir e MOVE a conversa para aquela
// fila. A partir daí quem enxerga é só quem atende a fila, mais quem vê tudo
// (Recepção, gestor, admin). Enquanto os colaboradores não estiverem
// vinculados na ⚙️ → 👥, o cliente escolhe "3 - Departamento Pessoal", sai da
// Recepção e vai parar numa fila sem ninguém do departamento — achando que
// foi encaminhado.
// ============================================================================

describe('🚨 coberturaDasFilas — o menu não pode prometer departamento vazio', () => {
    const cfg = configPadraoAtendimento();
    const eu = (extra: any) => ({ uid: String(Math.random()), role: 'colaborador', papelAtendimento: 'colaborador', departamentos: [], filasAtendimento: [], ...extra });

    it('sem a lista de atendentes é INDETERMINADO — não afirma órfã nem coberta', () => {
        // Acusar fila vazia porque a leitura falhou é o alarme falso que
        // aparece justo quando está tudo certo.
        const r = coberturaDasFilas({ menu: cfg.menu });
        expect(r.indeterminado).toBe(true);
        expect(r.filas).toEqual([]);
        expect(r.motivo).toMatch(/atendentes/i);
    });

    it('fila com colaborador vinculado é COBERTA', () => {
        const r = coberturaDasFilas({ menu: cfg.menu, atendentes: [eu({ filasAtendimento: ['fiscal'] })] });
        expect(r.filas.find((f: any) => f.fila === 'fiscal')!.situacao).toBe('coberta');
    });

    it('fila sem ninguém do departamento, mas com gestor na casa, NÃO é o mesmo que invisível', () => {
        // Ações diferentes: uma é vincular alguém; a outra é socorrer a
        // conversa agora. Fundir as duas esconderia a segunda.
        const comGestor = coberturaDasFilas({ menu: cfg.menu, atendentes: [eu({ papelAtendimento: 'gestor' })] });
        const rh = comGestor.filas.find((f: any) => f.fila === 'rh')!;
        expect(rh.situacao).toBe('so-quem-ve-tudo');
        expect(rh.doDepartamento).toBe(0);
        expect(rh.tambemVeem).toBe(1);

        const sozinho = coberturaDasFilas({ menu: cfg.menu, atendentes: [eu({ filasAtendimento: ['fiscal'] })] });
        expect(sozinho.filas.find((f: any) => f.fila === 'rh')!.situacao).toBe('invisivel');
    });

    it('quem tem a fila Recepção conta como quem vê tudo (decisão de 16/08)', () => {
        const r = coberturaDasFilas({ menu: cfg.menu, atendentes: [eu({ filasAtendimento: ['recepcao'] })] });
        expect(r.filas.find((f: any) => f.fila === 'juridico')!.situacao).toBe('so-quem-ve-tudo');
        // …e a própria Recepção fica COBERTA por essa mesma pessoa
        expect(r.filas.find((f: any) => f.fila === 'recepcao')!.situacao).toBe('coberta');
    });

    it('o departamento de MÓDULO vale como fila quando não há atribuição própria', () => {
        const r = coberturaDasFilas({ menu: cfg.menu, atendentes: [eu({ departamentos: ['contabil'] })] });
        expect(r.filas.find((f: any) => f.fila === 'contabil')!.situacao).toBe('coberta');
    });

    it('a lista de problemas sai pela OPÇÃO do menu — é o que o cliente digita', () => {
        // "ninguém na fila dp-folha" não ajuda quem lê; "a opção 3 leva a…" ajuda.
        const r = coberturaDasFilas({ menu: cfg.menu, atendentes: [eu({ filasAtendimento: ['recepcao'] })] });
        const dp = r.opcoesSemDono.find((o: any) => o.fila === 'dp-folha')!;
        expect(dp.opcao).toBe('3');
        expect(dp.rotulo).toMatch(/Departamento Pessoal/);
        // Recepção está coberta, então não aparece na lista de problemas.
        expect(r.opcoesSemDono.some((o: any) => o.fila === 'recepcao')).toBe(false);
    });

    it('casa toda vinculada = nenhuma pendência (farol que grita sempre é farol desligado)', () => {
        const equipe = FILAS_ATENDIMENTO.map((f: any) => eu({ filasAtendimento: [f.id] }));
        const r = coberturaDasFilas({ menu: cfg.menu, atendentes: equipe });
        expect(r.opcoesSemDono).toEqual([]);
    });

    it('menu customizado é respeitado — a régua lê o menu que está no ar', () => {
        const menu = [{ opcao: '1', fila: 'fiscal', rotulo: 'Impostos' }];
        const r = coberturaDasFilas({ menu, atendentes: [eu({ filasAtendimento: ['rh'] })] });
        expect(r.opcoesSemDono).toHaveLength(1);
        expect(r.opcoesSemDono[0].rotulo).toBe('Impostos');
    });
});

describe('🚨 farol de fila órfã tem que aparecer ONDE a decisão é tomada', () => {
    // Núcleo que ninguém lê é o defeito de 15/08 (a trava T1 do escopo passou
    // 4 dias escrita e não aplicada). Aqui o leitor tem que ser a aba do BOT —
    // é lá que se liga o alcance 🌐 — e não só a aba de atendentes.
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('a tela do Connect chama o núcleo (e não refaz a conta)', () => {
        // A trava contra uma SEGUNDA cópia mora em `reguaUnica.test.ts` (a
        // assinatura vigiada é a definição da função). Aqui basta provar que a
        // tela CHAMA o núcleo — e a chamada não pode virar assertiva mais
        // esperta que isso: a tela legitimamente lê `filasAtendimento` para
        // desenhar os chips de cada pessoa, e um teste que grita por causa
        // disso é um teste que alguém desliga.
        expect(tela).toMatch(/coberturaDasFilas\(/);
    });

    it('a aba do BOT carrega os atendentes — senão o farol nasce mudo', () => {
        // O efeito só existe porque o carregamento deixou de ser exclusivo da
        // aba 👥; sem isto, o aviso ficaria em "conferindo…" para sempre.
        expect(tela).toMatch(/cfgAba === 'atendentes' \|\| cfgAba === 'bot'/);
    });
});

describe('🖼️ imagensPorFila — ação produzida pelo núcleo tem que ter QUEM EXECUTA', () => {
    // O cérebro (decidirAutomacao) empilha {tipo:'enviarImagem'} — se o
    // executor do webhook não conhecer o tipo, a ação cai no chão em
    // silêncio (nenhum `else if` bate, nada acontece, ninguém percebe).
    // Mesma família da rota-sem-botão de 13/08, do lado do BACKEND.
    const rotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');
    const rotasAdmin = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it("o executor do bot (rodarBot) trata 'enviarImagem' e manda por LINK", () => {
        expect(rotas).toMatch(/acao\.tipo === 'enviarImagem'/);
        expect(rotas).toMatch(/enviarMidiaWhatsapp\(\{ para: msg\.de, tipo: 'image', link: acao\.url \}, depsEnvio\)/);
    });

    it('existe rota PÚBLICA que serve o banner (a Meta busca sem token nosso)', () => {
        expect(rotas).toMatch(/router\.get\('\/publico\/imagem-fila\/:fila'/);
    });

    it('existe rota admin de upload — sem ela o painel não teria como gravar a imagem', () => {
        expect(rotasAdmin).toMatch(/router\.post\('\/atendimento-config\/imagem-fila'/);
    });

    it('a aba do bot chama o upload (não é rota morta)', () => {
        expect(tela).toMatch(/subirImagemFila\(/);
        expect(tela).toMatch(/removerImagemFila\(/);
    });
});

describe('🚨 "Nova conversa" tinha uma SEGUNDA lista de departamentos, e ela não tinha a Recepção', () => {
    // Paulo, 21/08 (print da tela): "o Dpto Front/Recepcao, nao aparece p
    // iniciar msg". O <select> do modal era 5 <option> escritas à mão —
    // cópia velha dos 5 apps do SaaS — enquanto o catálogo de VERDADE
    // (FILAS_ATENDIMENTO) tem 8, com Recepção, RH e Jurídico. Mesma família
    // do #382: campo que devia ler de UM lugar só tinha nascido com a lista
    // duplicada e desatualizada.
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');
    const rotasAdmin = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');

    it('o select de departamento do modal lê de `filas` (o catálogo), não de <option> fixas', () => {
        expect(tela).toMatch(/\{filas\.map\(\(f\) => <option key=\{f\.id\} value=\{f\.id\}>\{rotuloCurtoFila\(f\.id\)\}<\/option>\)\}/);
        // A lista velha não pode ter voltado por um merge desatento.
        expect(tela).not.toMatch(/<option value="fiscal">🧾 Fiscal<\/option>/);
    });

    // Isola o handler da rota (até o próximo `router.` do arquivo) — janela
    // de tamanho fixo em char é frágil a qualquer comentário que cresça.
    const inicioHandler = rotasAdmin.indexOf("router.post('/conversas/iniciar'");
    const proximaRota = rotasAdmin.indexOf('router.', inicioHandler + 10);
    const handler = rotasAdmin.slice(inicioHandler, proximaRota > 0 ? proximaRota : undefined);

    it('a rota /conversas/iniciar aceita qualquer FILA válida, não só os 5 apps do SaaS', () => {
        // DEPARTAMENTOS_WHATSAPP segue existindo (é o escopo do CADASTRO de
        // template — decisão de 10/08, não mexida aqui); quem abre ou fecha a
        // porta de iniciar conversa é `filaValida`.
        expect(handler).toMatch(/filaValida\(departamento\)/);
        expect(handler).not.toMatch(/DEPARTAMENTOS_WHATSAPP\.has\(departamento\)/);
    });

    it('a conversa nasce COM a fila de quem a iniciou (senão cai no default da Recepção)', () => {
        expect(handler).toMatch(/fila: departamento,/);
    });
});

describe('🚨 a lista de conversas não pode ter teto SECO — "Todas · 100" no 1º teste real', () => {
    // Paulo, 21/08, com várias pessoas logadas: o chip dizia exatamente
    // "Todas · 100" — o limit(100) da rota. Conversa mais antiga que a
    // centésima sumia CALADA, mesmo aberta e não lida. Mesma classe do
    // limit(2000) dos contatos, pega dois dias antes.
    const rotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('a leitura é paginada até um teto ALTO, e o teto sai NOMEADO na resposta', () => {
        expect(rotas).toMatch(/TETO_LEITURA_CONVERSAS = 2000/);
        expect(rotas).toMatch(/limiteLeitura: docsConversas\.length >= TETO_LEITURA_CONVERSAS/);
        // O limit(100) seco não pode voltar por merge desatento.
        expect(rotas).not.toMatch(/whatsapp_conversas'\)\s*\n?\s*\.orderBy\('atualizadoEm', 'desc'\)\.limit\(100\)/);
    });

    it('lista cortada SEMPRE diz — o aviso existe na tela (farol honesto)', () => {
        expect(tela).toMatch(/limiteConversas != null/);
        expect(tela).toMatch(/conversas mais recentes/);
    });
});

describe('⚡ respostas rápidas viraram CONFIG — eram 4 frases cravadas na tela', () => {
    // Pergunta 2 do de-para, fechada por construção (21/08, "vamos relacionar
    // o que falta e completar"): o mecanismo é editável; a LISTA quem digita
    // é o admin, na ⚙️ → 🤖.
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');
    const rotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');

    it('o padrão traz as 4 frases que estavam cravadas — config antiga não muda nada', () => {
        expect(configPadraoAtendimento().respostasRapidas).toEqual([
            'Bom dia! Tudo bem?',
            'Recebido, já estamos verificando.',
            'Pode nos enviar o comprovante, por favor?',
            'Ficamos à disposição!',
        ]);
        expect(resolverConfig({}).respostasRapidas).toHaveLength(4);
    });

    it('lista gravada VAZIA é escolha (some os chips) — diferente do menu, que volta ao padrão', () => {
        expect(resolverConfig({ respostasRapidas: [] }).respostasRapidas).toEqual([]);
        // Linha em branco e espaço não viram chip vazio.
        expect(resolverConfig({ respostasRapidas: ['  Oi  ', '', '   '] }).respostasRapidas).toEqual(['Oi']);
    });

    it('o composer lê do estado, não de frases cravadas — e a rota /conversas as carrega', () => {
        expect(tela).toMatch(/respostasRapidas\.map\(\(q\)/);
        expect(tela).not.toMatch(/\['Bom dia! Tudo bem\?'/);
        // A INTENÇÃO, não a forma literal (lição das travas de 22/08): a rota
        // resolve a config e é DELA que as respostas rápidas saem.
        expect(rotas).toMatch(/cfgAtendimento = resolverConfig\(cfgDoc\.data\(\)\)/);
        expect(rotas).toMatch(/respostasRapidas = cfgAtendimento\.respostasRapidas/);
    });
});

describe('↳ SUB-MENUS do bot (item 5 de 21/08) — um nível, com 0 de voltar', () => {
    const cfgCom = resolverConfig({
        botAtivo: true, botAlcance: 'todos',
        menu: [
            { opcao: '1', fila: 'recepcao', rotulo: 'Recepção' },
            {
                opcao: '2', fila: 'fiscal', rotulo: 'Gestão',
                submenu: [
                    { opcao: '1', fila: 'fiscal', rotulo: 'Impostos' },
                    { opcao: '2', fila: 'contabil', rotulo: 'Contábil' },
                ],
            },
        ],
    });
    const decidir = (texto: string, conversa: Record<string, unknown> = {}) => decidirAutomacao({
        conversa, numero: '5511999990000', textoMensagem: texto, nomeContato: 'Cli',
        config: cfgCom, agora: new Date('2026-08-21T14:00:00-03:00'), protocoloNovo: 'P1',
    });

    it('escolher a opção-PORTA abre o sub-menu SEM definir fila nenhuma', () => {
        const acoes = decidir('2', { protocolo: 'P1' });
        expect(acoes.map((a) => a.tipo)).toEqual(['abrirSubmenu', 'responder']);
        expect(acoes[1].texto).toContain('Impostos');
        expect(acoes[1].texto).toContain('0 - Voltar');
        expect(acoes.some((a) => a.tipo === 'definirFila')).toBe(false);
    });

    it('dentro do sub-menu, o dígito escolhe a SUB-fila e fecha o sub-menu', () => {
        const acoes = decidir('2', { protocolo: 'P1', submenuAberto: '2' });
        expect(acoes.map((a) => a.tipo)).toEqual(['fecharSubmenu', 'definirFila', 'responder']);
        expect(acoes[1].fila).toBe('contabil');
    });

    it('"0" volta ao menu principal; dígito inválido reapresenta o SUB-menu (o cliente está lá)', () => {
        const volta = decidir('0', { protocolo: 'P1', submenuAberto: '2' });
        expect(volta.map((a) => a.tipo)).toEqual(['fecharSubmenu', 'responder']);
        expect(volta[1].texto).toContain('1 - Recepção');
        const invalido = decidir('9', { protocolo: 'P1', submenuAberto: '2' });
        expect(invalido.map((a) => a.tipo)).toEqual(['responder']);
        expect(invalido[0].texto).toContain('0 - Voltar');
    });

    it('sub-menu com fila inválida é SANEADO; esvaziado, a opção volta a ser direta', () => {
        const c = resolverConfig({
            menu: [{ opcao: '1', fila: 'fiscal', rotulo: 'X', submenu: [{ opcao: '1', fila: 'marketing', rotulo: 'inválida' }] }],
        });
        expect(c.menu[0].submenu).toBeUndefined();
    });

    it('o executor do webhook conhece as duas ações novas — ação sem executor cai no chão em silêncio', () => {
        const rotasWebhook = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');
        expect(rotasWebhook).toMatch(/acao\.tipo === 'abrirSubmenu'/);
        expect(rotasWebhook).toMatch(/acao\.tipo === 'fecharSubmenu'/);
        // #menu e a escolha de fila zeram o estado do sub-menu junto.
        expect(rotasWebhook).toMatch(/fila: null, submenuAberto: null/);
        expect(rotasWebhook).toMatch(/fila: acao\.fila, submenuAberto: null/);
    });
});

describe('🖼️ imagem/gif tinha que APARECER sozinha, como na Ultra Fox — não atrás de clique', () => {
    // Paulo, 21/08, comparando print a print (Ultra Fox × SP Connect): lá o
    // comprovante fotografado já vinha na tela; aqui exigia "abrir anexo".
    // A mídia já é baixada da Meta pro NOSSO Storage assim que chega (F1 do
    // webhook, 16/08) — então mostrar sozinha é só puxar do bucket, não é
    // buscar de novo na Meta.
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('existe um efeito que chama verMidia sozinho pra imagem/figurinha', () => {
        expect(tela).toMatch(/useEffect\(\(\) => \{\s*mensagens\s*\.filter\(\(m\) => \(m\.tipo === 'image' \|\| m\.tipo === 'sticker'\)/);
        expect(tela).toMatch(/\.forEach\(\(m\) => \{ verMidia\(m\); \}\);/);
    });

    it("midiaCarregando virou MAPA (era um id só) — senão a 2ª imagem trava esperando a 1ª", () => {
        expect(tela).toMatch(/const \[midiaCarregando, setMidiaCarregando\] = useState<Record<string, boolean>>\(\{\}\)/);
        // O mutex de string único é exatamente o defeito que travaria o
        // carregamento automático de várias imagens ao mesmo tempo.
        expect(tela).not.toMatch(/const \[midiaCarregando, setMidiaCarregando\] = useState<string \| null>/);
    });
});

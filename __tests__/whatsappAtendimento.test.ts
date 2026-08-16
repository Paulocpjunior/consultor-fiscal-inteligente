// ============================================================================
// F3 do SP Connect — triagem, filas e automações (núcleo puro).
// Régua de paridade: os prints do bot atual (16/08).
// ============================================================================
import {
    FILAS_ATENDIMENTO, filaValida, filasVisiveis, conversaVisivel,
    configPadraoAtendimento, resolverConfig, dentroDoHorario,
    gerarProtocolo, renderMensagem, montarTextoMenu, interpretarEscolha,
    decidirAutomacao, papelValido, podeEncerrar, interpretarNota,
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
        expect(interpretarNota('5')).toBe(5);
        expect(interpretarNota(' 5 ')).toBe(5);
        expect(interpretarNota('5.')).toBe(5);
        expect(interpretarNota('nota 4')).toBe(4);
        expect(interpretarNota('3 estrelas')).toBe(3);
        expect(interpretarNota('0')).toBeNull();
        expect(interpretarNota('6')).toBeNull();
        expect(interpretarNota('10')).toBeNull();
        expect(interpretarNota('obrigado!')).toBeNull();
        expect(interpretarNota('nota 5 pelo carinho')).toBeNull();
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
    const cfg = { ...configPadraoAtendimento(), botAtivo: true };
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
        expect(comPesquisa.some((a: any) => a.texto?.includes('1 a 5'))).toBe(true);
        expect(comPesquisa[comPesquisa.length - 1]).toEqual({ tipo: 'marcarAguardandoAvaliacao' });
    });

    it('#menu reapresenta o menu em qualquer estado — é o cliente pedindo outro depto', () => {
        const acoes = decidirAutomacao({ conversa: { fila: 'fiscal', protocolo: '2077' }, textoMensagem: '#menu', config: cfg, agora: dentroDoExpediente });
        expect(acoes[0]).toEqual({ tipo: 'resetarTriagem' });
        expect(acoes[1].texto).toContain('1 - Recepção / Front Desk');
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

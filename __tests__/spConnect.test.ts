// ============================================================================
// Núcleo puro do SP Connect (inbox do WhatsApp) — janela, carimbos e rótulos.
// A CONTA da janela é do backend (webhook grava janela24hAte); aqui se prova
// só a LEITURA — recalcular na tela seria a segunda régua.
// ============================================================================
import {
    estadoJanela, carimboStatus, nomeExibicao, formatarNumeroBr,
    horaCurta, rotuloMidia, dataHoraSp, filtrarConversas, iniciais,
} from '../services/spConnect';

// Offsets EXPLÍCITOS (-03:00): a tela formata em America/Sao_Paulo por regra
// (a mesma do horario-acesso) — o teste não pode depender do fuso do runner.
const AGORA = new Date('2026-08-16T15:00:00-03:00');

describe('estadoJanela (24h)', () => {
    it('aberta mostra até quando; no dia seguinte diz "amanhã"', () => {
        const hoje = estadoJanela(new Date('2026-08-16T18:30:00-03:00').toISOString(), AGORA);
        expect(hoje.aberta).toBe(true);
        expect(hoje.rotulo).toContain('18:30');
        expect(hoje.rotulo).not.toContain('amanhã');

        const amanha = estadoJanela(new Date('2026-08-17T10:00:00-03:00').toISOString(), AGORA);
        expect(amanha.aberta).toBe(true);
        expect(amanha.rotulo).toContain('amanhã');
    });
    it('fechada e inexistente são estados DIFERENTES — os dois com o porquê', () => {
        const fechada = estadoJanela(new Date('2026-08-16T14:59:00-03:00').toISOString(), AGORA);
        expect(fechada.aberta).toBe(false);
        expect(fechada.rotulo).toContain('FECHADA');
        const nunca = estadoJanela(null, AGORA);
        expect(nunca.aberta).toBe(false);
        expect(nunca.rotulo).toContain('ainda não escreveu');
    });
});

describe('carimboStatus', () => {
    it('cada status tem símbolo e tom próprios; desconhecido não vira verde', () => {
        expect(carimboStatus('entregue')).toEqual({ simbolo: '✓✓', rotulo: 'entregue', tom: 'ok' });
        expect(carimboStatus('lido').tom).toBe('lido');
        expect(carimboStatus('falhou')).toMatchObject({ simbolo: '✗', tom: 'falha' });
        expect(carimboStatus('sei_la').tom).toBe('neutro');
        expect(carimboStatus(null).rotulo).toBe('sem status');
    });
});

describe('nome e número', () => {
    it('nome do perfil vence; sem nome, número FORMATADO (nunca vazio)', () => {
        expect(nomeExibicao({ nome: 'Ricardo Sócio', numero: '5511964440000' })).toBe('Ricardo Sócio');
        expect(nomeExibicao({ nome: null, numero: '5511964440000' })).toBe('+55 11 96444-0000');
        expect(nomeExibicao({ nome: '  ', numero: '551131551554' })).toBe('+55 11 3155-1554');
    });
    it('número fora do padrão BR sai CRU — esconder é pior que feio', () => {
        expect(formatarNumeroBr('4915112345678')).toBe('4915112345678');
    });
});

describe('horaCurta e mídia', () => {
    it('hoje só hora; outro dia leva a data junto — SEMPRE no fuso de SP', () => {
        expect(horaCurta(new Date('2026-08-16T09:05:00-03:00').toISOString(), AGORA)).toBe('09:05');
        expect(horaCurta(new Date('2026-08-14T09:05:00-03:00').toISOString(), AGORA)).toBe('14/08 09:05');
        expect(horaCurta('torto', AGORA)).toBe('');
    });
    it('dataHoraSp converte UTC → SP (o caso do painel 📡: 12:37Z é 09:37 em SP)', () => {
        // Regressão do defeito real de 16/08: o painel mostrava a hora do
        // navegador; o webhook grava UTC e a tela DEVE dizer a hora de SP.
        expect(dataHoraSp('2026-08-16T12:37:21.000Z')).toContain('09:37:21');
        expect(dataHoraSp(null)).toBe('');
    });
    it('mídia não baixada DIZ que ainda está na Meta — sumir com o anexo é o pior', () => {
        expect(rotuloMidia({ nomeArquivo: 'comprovante.pdf', mime: 'application/pdf', baixada: true }, 'document')).toBe('📎 comprovante.pdf');
        expect(rotuloMidia({ nomeArquivo: null, mime: 'audio/ogg', baixada: false }, 'audio')).toContain('não baixado');
        expect(rotuloMidia(null, 'text')).toBeNull();
    });
});

describe('filtrarConversas e iniciais', () => {
    const lista = [
        { numero: '5511997377599', nome: 'Paulocpjr', empresaId: null, fila: null, situacao: 'aberta', janela24hAte: null, ultimaMensagem: { resumo: 'teste', direcao: 'entrada', em: '' }, naoLidas: 1, atualizadoEm: null },
        { numero: '5511964440000', nome: 'Padaria Bela Massa', empresaId: 'e1', fila: 'fiscal', situacao: 'aberta', janela24hAte: null, ultimaMensagem: { resumo: 'guia recebida', direcao: 'entrada', em: '' }, naoLidas: 0, atualizadoEm: null },
    ] as any[];

    it('busca casa nome, número e resumo — e as abas filtram sem esconder o resto', () => {
        expect(filtrarConversas(lista, { busca: 'padaria', aba: 'todas' })).toHaveLength(1);
        expect(filtrarConversas(lista, { busca: '96444', aba: 'todas' })[0].nome).toBe('Padaria Bela Massa');
        expect(filtrarConversas(lista, { busca: 'guia', aba: 'todas' })).toHaveLength(1);
        expect(filtrarConversas(lista, { busca: '', aba: 'nao-lidas' })).toHaveLength(1);
        expect(filtrarConversas(lista, { busca: '', aba: 'recepcao' })[0].nome).toBe('Paulocpjr');
        // aba pode ser QUALQUER id de fila (F3) — 'recepcao' segue casando fila null (não triada)
        expect(filtrarConversas(lista, { busca: '', aba: 'fiscal' })[0].nome).toBe('Padaria Bela Massa');
        expect(filtrarConversas(lista, { busca: '', aba: 'juridico' })).toHaveLength(0);
        expect(filtrarConversas(lista, { busca: '', aba: 'todas' })).toHaveLength(2);
    });

    it('iniciais: nome vira 2 letras; sem nome, fim do número — nunca vazio', () => {
        expect(iniciais({ nome: 'Padaria Bela Massa', numero: 'x' })).toBe('PB');
        expect(iniciais({ nome: 'Paulocpjr', numero: 'x' })).toBe('P');
        expect(iniciais({ nome: null, numero: '5511997377599' })).toBe('99');
    });
});

// 🔍 Busca dentro da conversa (21/08 — pendência 🟡 do de-para: a busca só
// alcançava a LISTA; dentro da thread era rolar no dedo).
import { filtrarMensagensDaThread, MensagemInbox } from '../services/spConnect';

describe('filtrarMensagensDaThread', () => {
    const msg = (texto: string | null, nomeArquivo: string | null = null): MensagemInbox => ({
        id: Math.random().toString(36).slice(2), direcao: 'entrada', tipo: 'text', texto,
        midia: nomeArquivo ? { nomeArquivo, mime: null, baixada: true } : null,
        timestamp: null, statusEntrega: null, erroEntrega: null,
    });
    const thread = [
        msg('Segue o comprovante do pagamento'),
        msg('Você pode conferir?'),
        msg(null, 'Curriculo_Simone_2026.pdf'),
        msg('Obrigado!'),
    ];

    it('casa sem acento e sem caixa — "voce" acha "Você"', () => {
        expect(filtrarMensagensDaThread(thread, 'voce')).toHaveLength(1);
        expect(filtrarMensagensDaThread(thread, 'VOCÊ')).toHaveLength(1);
    });

    it('acha pelo NOME DO ARQUIVO do anexo — currículo se procura pelo nome', () => {
        expect(filtrarMensagensDaThread(thread, 'curriculo')[0].midia?.nomeArquivo).toContain('Simone');
    });

    it('termo vazio devolve TUDO — busca desligada não é filtro', () => {
        expect(filtrarMensagensDaThread(thread, '')).toHaveLength(4);
        expect(filtrarMensagensDaThread(thread, '   ')).toHaveLength(4);
    });

    it('sem resultado devolve vazio (a tela diz, em vez de mostrar tudo como se tivesse achado)', () => {
        expect(filtrarMensagensDaThread(thread, 'boleto')).toHaveLength(0);
    });
});

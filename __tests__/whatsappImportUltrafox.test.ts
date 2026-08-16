// ============================================================================
// Importador do backup da Ultra Fox — parser calibrável por cabeçalho,
// preview antes de gravar, linha ilegível CONTADA com motivo.
// ============================================================================
import {
    detectarDelimitador, interpretarCsv, interpretarContatosCsv,
    dataBrParaIso, interpretarConversaTxt, interpretarMensagensCsv,
    idMensagemImportada, prepararMensagensDoTxt,
} from '../sefaz-backend/whatsapp-import-ultrafox.js';

describe('CSV genérico', () => {
    it('detecta ; , e TAB (ler um delimitador só devolve zero linha em silêncio)', () => {
        expect(detectarDelimitador('a;b;c')).toBe(';');
        expect(detectarDelimitador('a,b,c')).toBe(',');
        expect(detectarDelimitador('a\tb\tc')).toBe('\t');
    });
    it('respeita aspas (vírgula dentro do campo não quebra a linha)', () => {
        const r = interpretarCsv('nome,telefone\n"Silva, João",11999990000');
        expect(r.linhas[0]).toEqual(['Silva, João', '11999990000']);
    });
});

describe('contatos', () => {
    it('casa colunas pelo TEXTO do cabeçalho e normaliza o número', () => {
        const csv = 'Nome do Cliente;Celular / WhatsApp;Empresa\nJuliana Gomes;(11) 96444-0000;ACME LTDA';
        const r = interpretarContatosCsv(csv);
        expect(r.contatos).toEqual([{ numero: '5511964440000', nome: 'Juliana Gomes', empresaNome: 'ACME LTDA' }]);
    });
    it('número ilegível vai CONTADO com o motivo — nunca some mudo', () => {
        const r = interpretarContatosCsv('nome,telefone\nSem Numero,abc\nOk,11964440000');
        expect(r.contatos).toHaveLength(1);
        expect(r.descartados[0].motivo).toContain('ilegível');
        expect(r.descartados[0].linha).toBe(2);
    });
    it('sem coluna de número reconhecida a resposta DIZ o cabeçalho que leu', () => {
        const r = interpretarContatosCsv('nome;email\nX;x@y.z');
        expect(r.contatos).toHaveLength(0);
        expect(r.avisos[0]).toContain('NÚMERO');
        expect(r.avisos[0]).toContain('nome · email');
    });
    it('duplicata no arquivo fica UMA vez (a contagem registra o fato)', () => {
        const r = interpretarContatosCsv('nome,fone\n,11964440000\nJu,11964440000');
        expect(r.contatos).toHaveLength(1);
        expect(r.contatos[0].nome).toBe('Ju');
        expect(r.contatos[0].duplicatasNoArquivo).toBe(1);
    });
    it('"nome da empresa" não rouba a coluna de nome do contato', () => {
        const r = interpretarContatosCsv('nome da empresa;nome;whatsapp\nACME;Ju;11964440000');
        expect(r.contatos[0]).toMatchObject({ nome: 'Ju', empresaNome: 'ACME' });
    });
});

describe('datas (SP, UTC-03:00 fixo)', () => {
    it('converte DD/MM/AAAA HH:MM e ilegível devolve null, NUNCA "agora"', () => {
        expect(dataBrParaIso('16/08/2026', '14:32')).toBe('2026-08-16T17:32:00.000Z');
        expect(dataBrParaIso('16/08/26', '14:32:05')).toBe('2026-08-16T17:32:05.000Z');
        expect(dataBrParaIso('ontem', '14:32')).toBeNull();
        expect(dataBrParaIso('16/08/2026', '')).toBeNull();
    });
});

describe('conversa .txt (formato de export do WhatsApp)', () => {
    const txt = [
        '16/08/2026 09:15 - Juliana Gomes: Bom dia! Preciso da guia',
        'do DAS de julho',
        '[16/08/2026, 09:17:30] SP Assessoria: Bom dia, Juliana!',
        '16/08/2026 09:18 - Juliana Gomes: Obrigada!',
        'Mensagens e ligações são protegidas com criptografia',
    ].join('\n');

    it('lê as mensagens, junta continuação multi-linha e lista os AUTORES', () => {
        const r = interpretarConversaTxt(txt);
        expect(r.mensagens).toHaveLength(3);
        expect(r.mensagens[0].texto).toBe('Bom dia! Preciso da guia\ndo DAS de julho');
        expect(r.autores.sort()).toEqual(['Juliana Gomes', 'SP Assessoria']);
    });
    it('a DIREÇÃO não é adivinhada: quem confirma diz quais autores são do escritório', () => {
        const { mensagens } = interpretarConversaTxt(txt);
        const docs = prepararMensagensDoTxt({ mensagens, numero: '5511964440000', autoresEscritorio: ['SP Assessoria'] });
        expect(docs.map((d) => d.direcao)).toEqual(['entrada', 'saida', 'entrada']);
        expect(docs[0].numero).toBe('5511964440000');
    });
});

describe('mensagens em CSV', () => {
    it('lê data junta ou separada e traduz a direção pelos rótulos comuns', () => {
        const csv = 'Data;Telefone;Tipo;Mensagem\n16/08/2026 09:15;11964440000;Recebida;Oi\n16/08/2026 09:16;11964440000;Enviada;Olá!';
        const r = interpretarMensagensCsv(csv);
        expect(r.mensagens).toHaveLength(2);
        expect(r.mensagens[0].direcao).toBe('entrada');
        expect(r.mensagens[1].direcao).toBe('saida');
    });
    it('data ilegível descarta CONTADO — nunca vira "agora"', () => {
        const r = interpretarMensagensCsv('data;numero;mensagem\nsem-data;11964440000;Oi');
        expect(r.mensagens).toHaveLength(0);
        expect(r.descartadas[0].motivo).toContain('data ilegível');
    });
    it('sem coluna de direção, avisa e assume ENTRADA (mensagem do cliente)', () => {
        const r = interpretarMensagensCsv('data;numero;mensagem\n16/08/2026 09:15;11964440000;Oi');
        expect(r.mensagens[0].direcao).toBe('entrada');
        expect(r.avisos[0]).toContain('ENTRADA');
    });
});

describe('idempotência', () => {
    it('o id é determinístico — reimportar o mesmo backup NÃO duplica', () => {
        const m = { numero: '5511964440000', em: '2026-08-16T12:00:00.000Z', direcao: 'entrada', texto: 'Oi' };
        expect(idMensagemImportada(m)).toBe(idMensagemImportada({ ...m }));
        expect(idMensagemImportada(m)).toMatch(/^uf_[0-9a-f]{40}$/);
        expect(idMensagemImportada({ ...m, texto: 'Oi!' })).not.toBe(idMensagemImportada(m));
    });
});

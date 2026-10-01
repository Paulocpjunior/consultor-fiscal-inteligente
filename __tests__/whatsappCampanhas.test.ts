// ============================================================================
// 📣 CAMPANHAS EM LOTE POR TEMPLATE (29/09) — item 1 da comparação com o
// Clerk Chat. Aviso de prazo para todas as empresas de um regime, com quem
// ficou de fora NOMEADO, opt-out que vale para sempre e MARKETING preso ao
// consentimento (LGPD).
// ============================================================================
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
    ehPedidoDeOptOut, validarCampanha, montarPublico, variaveisDoDestinatario, proximoLote, totaisDaCampanha,
    campanhaConcluida, resumoDaCampanha, textoDaMensagemDeCampanha, LOTE_CAMPANHA, MAX_DESTINATARIOS,
} from '../sefaz-backend/whatsapp-campanhas.js';
import { montarCatalogoEtiquetas } from '../sefaz-backend/whatsapp-etiquetas.js';

const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');
const catalogo = montarCatalogoEtiquetas([]);   // as etiquetas padrão: 'marketing' pede consentimento, 'cliente' não
const utility: any = { nome: 'aviso_das', idioma: 'pt_BR', categoria: 'UTILITY', variaveis: 2, corpo: 'Olá {{1}}, o DAS vence em {{2}}.' };
const marketing: any = { nome: 'promo', idioma: 'pt_BR', categoria: 'MARKETING', variaveis: 0, corpo: 'Promoção!' };

describe('opt-out — "PARAR" vale para sempre, frase longa não é opt-out', () => {
    it('reconhece as palavras, com ponto e maiúscula; ignora frase de contexto', () => {
        for (const t of ['PARAR', 'sair', 'Cancelar.', 'stop', 'Não quero receber']) expect(ehPedidoDeOptOut(t)).toBe(true);
        for (const t of ['quero parar de pagar o DAS', 'vou sair do simples?', '', null, 'ok']) expect(ehPedidoDeOptOut(t)).toBe(false);
    });
});

describe('validarCampanha — nome, template aprovado, variáveis contadas, público', () => {
    it('UTILITY para o regime Simples com 2 variáveis: ok', () => {
        const r = validarCampanha({ nome: 'DAS 10/2026', template: utility, variaveis: ['{empresa}', '20/10'], publico: { tipo: 'regime', regime: 'simples' } });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.campanha.publico).toEqual({ tipo: 'regime', regime: 'simples', etiqueta: null, numeros: null });
    });

    it('recusa: sem nome, variáveis a menos/vazias, categoria desconhecida, regime torto, lista vazia', () => {
        expect(validarCampanha({ nome: '', template: utility, variaveis: ['a', 'b'], publico: { tipo: 'regime', regime: 'simples' } }).ok).toBe(false);
        expect(validarCampanha({ nome: 'x', template: utility, variaveis: ['a'], publico: { tipo: 'regime', regime: 'simples' } }).ok).toBe(false);
        expect(validarCampanha({ nome: 'x', template: utility, variaveis: ['a', ' '], publico: { tipo: 'regime', regime: 'simples' } }).ok).toBe(false);
        expect(validarCampanha({ nome: 'x', template: { ...utility, categoria: 'AUTHENTICATION' }, variaveis: ['a', 'b'], publico: { tipo: 'regime', regime: 'simples' } }).ok).toBe(false);
        expect(validarCampanha({ nome: 'x', template: utility, variaveis: ['a', 'b'], publico: { tipo: 'regime', regime: 'mei' } }).ok).toBe(false);
        expect(validarCampanha({ nome: 'x', template: utility, variaveis: ['a', 'b'], publico: { tipo: 'numeros', numeros: [] } }).ok).toBe(false);
    });

    it('🚨 MARKETING só para ETIQUETA — regime/lista recusam com a LGPD no motivo', () => {
        const r = validarCampanha({ nome: 'x', template: marketing, variaveis: [], publico: { tipo: 'regime', regime: 'simples' } });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.erro).toMatch(/consentimento/);
        expect(validarCampanha({ nome: 'x', template: marketing, variaveis: [], publico: { tipo: 'etiqueta', etiqueta: 'marketing' } }).ok).toBe(true);
    });
});

describe('montarPublico — quem recebe e quem fica de fora, com o motivo', () => {
    const empresas = new Map([
        ['e1', { nome: 'HYPE CAFE LTDA', regime: 'simples' }],
        ['e2', { nome: 'LUCRO SA', regime: 'lucro' }],
    ]);
    const contatos = [
        { numero: '5511999990001', nomePerfil: 'Ana', empresaId: 'e1', etiquetas: ['cliente'] },
        { numero: '5511999990002', nomePerfil: 'Bia', empresaId: 'e2', etiquetas: ['cliente', 'marketing'], consentimentos: { marketing: { em: '2026-08-01' } } },
        { numero: '5511999990003', nomePerfil: 'Caio', empresaId: 'e1', etiquetas: ['marketing'] },                       // marketing SEM consentimento
        { numero: '5511999990004', nomePerfil: 'Dora', empresaId: 'e1', etiquetas: [], optOutCampanhas: { em: '2026-09-01' } },
        { numero: '11 99999-0001', nomePerfil: 'Ana de novo', empresaId: 'e1', etiquetas: [] },                             // mesmo número, outra grafia
        { numero: 'abc', nomePerfil: 'Torto', empresaId: 'e1', etiquetas: [] },
        { numero: '5511999990006', nomePerfil: 'Sem vínculo', empresaId: null, etiquetas: [] },
    ];
    const campanhaUtility: any = { template: utility, publico: { tipo: 'regime', regime: 'simples', etiqueta: null, numeros: null } };

    it('regime Simples: só quem está VINCULADO a empresa do regime; opt-out e número torto ficam de fora nomeados; repetido não duplica', () => {
        const r = montarPublico({ campanha: campanhaUtility, contatos, catalogoEtiquetas: catalogo, empresas });
        expect(r.destinatarios.map((d) => d.numero)).toEqual(['5511999990001', '5511999990003']);
        expect(r.destinatarios[0]).toMatchObject({ empresaNome: 'HYPE CAFE LTDA', nome: 'Ana', status: 'pendente', origem: 'regime' });
        expect(r.pulados).toEqual(expect.arrayContaining([
            expect.objectContaining({ numero: '5511999990004', motivo: 'opt-out' }),
            expect.objectContaining({ numero: 'abc', motivo: 'numero-invalido' }),
        ]));
        // "Sem vínculo" e a Bia (lucro) simplesmente não são do público — não são "pulados".
        expect(r.pulados.map((p) => p.numero)).not.toContain('5511999990006');
        expect(r.truncado).toBe(false);
    });

    it('🚨 etiqueta MARKETING: sem consentimento registrado fica de fora, com o motivo da LGPD', () => {
        const r = montarPublico({ campanha: { template: marketing, publico: { tipo: 'etiqueta', etiqueta: 'marketing', regime: null, numeros: null } } as any, contatos, catalogoEtiquetas: catalogo, empresas });
        expect(r.destinatarios.map((d) => d.numero)).toEqual(['5511999990002']);
        expect(r.pulados).toEqual([expect.objectContaining({ numero: '5511999990003', motivo: 'sem-consentimento' })]);
    });

    it('lista de números: normaliza, casa com o contato quando existe (nome/empresa), e respeita opt-out', () => {
        const r = montarPublico({
            campanha: { template: utility, publico: { tipo: 'numeros', numeros: ['(11) 99999-0001', '5511999990004', '11 3333-1234'], etiqueta: null, regime: null } } as any,
            contatos, catalogoEtiquetas: catalogo, empresas,
        });
        expect(r.destinatarios.map((d) => [d.numero, d.empresaNome])).toEqual([['5511999990001', 'HYPE CAFE LTDA'], ['551133331234', null]]);
        expect(r.pulados).toEqual([expect.objectContaining({ numero: '5511999990004', motivo: 'opt-out' })]);
    });

    it('acima do teto a lista é CORTADA e diz que cortou', () => {
        const muitos = Array.from({ length: MAX_DESTINATARIOS + 5 }, (_, i) => ({ numero: `5511${String(900000000 + i)}`, empresaId: 'e1', etiquetas: [] }));
        const r = montarPublico({ campanha: campanhaUtility, contatos: muitos, catalogoEtiquetas: catalogo, empresas });
        expect(r.destinatarios).toHaveLength(MAX_DESTINATARIOS);
        expect(r.truncado).toBe(true);
    });
});

describe('personalização, lote e totais', () => {
    it('{empresa}/{nome} viram o dado do destinatário; sem dado, o destinatário é pulado (nunca sai "{empresa}" no cliente)', () => {
        expect(variaveisDoDestinatario(['{empresa}', '20/10'], { empresaNome: 'HYPE CAFE', nome: 'Ana' })).toEqual({ ok: true, variaveis: ['HYPE CAFE', '20/10'] });
        expect(variaveisDoDestinatario(['Olá {nome}', '20/10'], { empresaNome: null, nome: null }).ok).toBe(false);
        expect(variaveisDoDestinatario(['{empresa}'], { empresaNome: '' }).ok).toBe(false);
    });

    it('proximoLote pega só pendentes, na ordem, até o tamanho; totais/concluída batem', () => {
        const ds = [
            { status: 'enviado' }, { status: 'pendente' }, { status: 'falhou' }, { status: 'pendente' }, { status: 'pulado' }, { status: 'pendente' },
        ] as any[];
        expect(proximoLote(ds, 2)).toEqual([1, 3]);
        expect(proximoLote(ds)).toEqual([1, 3, 5]);
        expect(totaisDaCampanha(ds)).toEqual({ total: 6, pendentes: 3, enviados: 1, falhas: 1, pulados: 1 });
        expect(campanhaConcluida(ds)).toBe(false);
        expect(campanhaConcluida(ds.filter((d) => d.status !== 'pendente'))).toBe(true);
        expect(LOTE_CAMPANHA).toBeGreaterThan(0);
    });

    it('resumoDaCampanha não carrega os destinatários; a linha da conversa mostra o corpo renderizado', () => {
        const r = resumoDaCampanha({ id: 'c1', nome: 'DAS', status: 'enviando', destinatarios: [{ status: 'enviado' }] as any, puladosNoPublico: [{ numero: 'x', motivo: 'opt-out' }] } as any);
        expect(r).not.toHaveProperty('destinatarios');
        expect(r.totais.enviados).toBe(1);
        expect(r.puladosNoPublico).toBe(1);
        expect(textoDaMensagemDeCampanha({ campanha: { nome: 'DAS' }, corpoRenderizado: 'Olá HYPE, o DAS vence em 20/10.' })).toBe('📣 Olá HYPE, o DAS vence em 20/10.');
        expect(textoDaMensagemDeCampanha({ campanha: { nome: 'DAS', template: { nome: 'aviso_das' } as any }, corpoRenderizado: null })).toMatch(/Campanha "DAS" \(template aviso_das\)/);
    });
});

describe('🚨 fiação — campanha que não registra na conversa e não respeita PARAR não entra', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const webhook = ler('sefaz-backend/whatsapp-webhook-routes.js');
    const tela = ler('components/SpConnect/index.tsx');

    it('rotas admin: listar, ler, criar (público montado no servidor a partir do template APROVADO), iniciar, pausar', () => {
        expect(rotas).toMatch(/router\.get\('\/campanhas', requireAdmin/);
        expect(rotas).toMatch(/router\.post\('\/campanhas', requireAdmin/);
        expect(rotas).toMatch(/router\.post\('\/campanhas\/:id\/iniciar', requireAdmin/);
        expect(rotas).toMatch(/router\.post\('\/campanhas\/:id\/pausar', requireAdmin/);
        const criar = rotas.slice(rotas.indexOf("router.post('/campanhas', requireAdmin"), rotas.indexOf("router.post('/campanhas/:id/iniciar'"));
        expect(criar).toMatch(/listarTemplatesAprovados\(\)/);
        expect(criar).toMatch(/montarPublico\(\{ campanha: v\.campanha, contatos, catalogoEtiquetas: catalogo, empresas, bloqueados \}\)/);
        expect(criar).toMatch(/status: 'rascunho'/);
        // Template com documento não sai em campanha (cada guia é um PDF).
        expect(criar).toMatch(/temDocumento/);
    });

    it('o lote envia por template, grava a linha na conversa de cada um, audita, e para no canal sem config', () => {
        const lote = rotas.slice(rotas.indexOf('async function enviarLoteDaCampanha'), rotas.indexOf('async function tickCampanhas'));
        expect(lote).toMatch(/variaveisDoDestinatario\(c\.variaveis \|\| \[\], d\)/);
        expect(lote).toMatch(/enviarTemplateWhatsapp\(\{ para: d\.numero, template: c\.template\.nome/);
        expect(lote).toMatch(/campanhaId: c\.id/);
        expect(lote).toMatch(/referencia: `campanha:\$\{c\.id\}`/);
        expect(lote).toMatch(/if \(envio\.configuracaoIncompleta\) break;/);
        expect(lote).toMatch(/campanhaConcluida\(destinatarios\)/);
        // O tick da agenda empurra as campanhas também.
        const tick = rotas.slice(rotas.indexOf("router.post('/agenda/tick'"), rotas.indexOf("router.get('/agenda/estado'"));
        expect(tick).toMatch(/tickCampanhas\(db, agora\)/);
    });

    it('🚫 o webhook carimba o opt-out e deixa nota; o público lê o carimbo', () => {
        expect(webhook).toMatch(/ehPedidoDeOptOut\(msg\.texto\)/);
        expect(webhook).toMatch(/optOutCampanhas: \{ em, texto/);
        expect(ler('sefaz-backend/whatsapp-campanhas.js')).toMatch(/c\.optOutCampanhas\?\.em/);
    });

    it('a tela: aba 📣 (admin), público por regime/etiqueta/lista, pulados com motivo, ▶ Iniciar com confirmação, estado do tick', () => {
        expect(tela).toMatch(/\['campanhas', '📣 Campanhas'\]/);
        expect(tela).toMatch(/cfgAba === 'campanhas'/);
        expect(tela).toMatch(/setCampPublicoTipo\('regime'\)/);
        expect(tela).toMatch(/setCampPublicoTipo\('etiqueta'\)/);
        // Confirmação pela caixa do APP (dentro do Teams window.confirm não abre — trava confirmacaoNoTeams).
        expect(tela).toMatch(/await pedirConfirmacao\(`Enviar "\$\{c\.nome\}" para/);
        expect(tela).toMatch(/Montar o público \(não envia\)/);
        expect(tela).toMatch(/campCriada\.pulados/);
    });

    it('as coleções novas têm dono no catálogo do banco (que mora no CFI — mesmo banco, um catálogo)', () => {
        if (!existsSync(join(raiz, 'sefaz-backend/catalogo-banco.js'))) return;
        const catalogoBanco = ler('sefaz-backend/catalogo-banco.js');
        expect(catalogoBanco).toMatch(/colecao: 'whatsapp_campanhas'/);
        expect(catalogoBanco).toMatch(/colecao: 'whatsapp_agendamentos'/);
    });
});

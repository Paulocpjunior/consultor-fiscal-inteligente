// ============================================================================
// 🚫 LISTA NEGRA DO SP CONNECT (01/10) — Paulo: "modal disponível somente
// para admins, para black list de usuários indesejados, spam, anúncio".
//
// O que se prova: a validação (número, motivo, observação obrigatória no
// "outro"), o conjunto/separação que o webhook usa, a leitura tolerante da
// resposta da Meta (block users), e a FIAÇÃO: bloqueado não entra (webhook
// descarta antes do banco/bot/aviso), não sai (responder, iniciar, agendar,
// campanha, guia recusam), some do inbox, e só admin mexe.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    validarBloqueio, numeroDeBloqueio, conjuntoDeBloqueados, separarBloqueadas, patchDeDescarte,
    montarPedidoBlockUsers, interpretarRespostaBlockUsers, notaDeBloqueio, notaDeDesbloqueio, resumoDoBloqueio,
    MOTIVOS_BLOQUEIO, COLECAO_BLOQUEIOS,
} from '../sefaz-backend/whatsapp-bloqueios.js';
import { montarPublico } from '../sefaz-backend/whatsapp-campanhas.js';

const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');
const AGORA = new Date('2026-10-01T12:00:00.000Z');

describe('validarBloqueio — número, motivo e o porquê', () => {
    it('aceita número com máscara (vira só dígitos), motivo da lista, observação opcional', () => {
        const r = validarBloqueio({ numero: '+55 (11) 99999-0000', motivo: 'spam', por: 'paulo@sp.com', agora: AGORA });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.bloqueio).toMatchObject({ numero: '5511999990000', motivo: 'spam', ativo: true, bloqueadoPor: 'paulo@sp.com', bloqueadoEm: AGORA.toISOString(), descartadas: 0, meta: null });
    });

    it('spam vem de fora do Brasil também: 8 a 15 dígitos, sem normalizar para BR', () => {
        expect(numeroDeBloqueio('+1 689 336 0048')).toBe('16893360048');
        expect(numeroDeBloqueio('123')).toBeNull();
        expect(numeroDeBloqueio('1234567890123456')).toBeNull();
    });

    it('recusa: motivo fora da lista; "outro" sem observação; observação longa', () => {
        expect(validarBloqueio({ numero: '5511999990000', motivo: 'chato' }).ok).toBe(false);
        expect(validarBloqueio({ numero: '5511999990000', motivo: 'outro' }).ok).toBe(false);
        expect(validarBloqueio({ numero: '5511999990000', motivo: 'outro', observacao: 'manda corrente' }).ok).toBe(true);
        expect(validarBloqueio({ numero: '5511999990000', motivo: 'spam', observacao: 'x'.repeat(301) }).ok).toBe(false);
        expect(MOTIVOS_BLOQUEIO.map((m) => m.id)).toEqual(['spam', 'anuncio', 'golpe', 'abuso', 'outro']);
    });
});

describe('o webhook: conjunto, separação e o contador do descarte', () => {
    it('só os ATIVOS entram no conjunto; a separação é por `de`', () => {
        const docs = [
            { data: () => ({ numero: '5511999990001', ativo: true }) },
            { data: () => ({ numero: '5511999990002', ativo: false }) },
            { numero: '5511999990003' },                                   // sem `ativo` = ativo
        ];
        const set = conjuntoDeBloqueados(docs);
        expect([...set]).toEqual(['5511999990001', '5511999990003']);
        const { livres, bloqueadas } = separarBloqueadas([{ de: '5511999990001', texto: 'compre' }, { de: '5511999990002' }, { de: '5511999990009' }] as any, set);
        expect(bloqueadas.map((m: any) => m.de)).toEqual(['5511999990001']);
        expect(livres.map((m: any) => m.de)).toEqual(['5511999990002', '5511999990009']);
    });

    it('o descarte guarda quando e o começo do texto (80 chars) — ou o tipo da mídia', () => {
        expect(patchDeDescarte({ texto: 'x'.repeat(100) }, AGORA)).toEqual({ ultimaTentativaEm: AGORA.toISOString(), ultimoTexto: 'x'.repeat(80) });
        expect(patchDeDescarte({ texto: '', tipo: 'image' }, AGORA).ultimoTexto).toBe('[image]');
    });
});

describe('a Meta (block users) — payload e leitura tolerante', () => {
    it('payload no leiaute da Cloud API', () => {
        expect(montarPedidoBlockUsers(['5511999990000'])).toEqual({ messaging_product: 'whatsapp', block_users: [{ user: '5511999990000' }] });
    });

    it('sucesso lista os feitos; falha parcial vem nomeada; erro da Graph vem com o detalhe', () => {
        expect(interpretarRespostaBlockUsers(200, { block_users: { added_users: [{ input: '5511999990000', wa_id: '5511999990000' }], failed_users: [] } }))
            .toEqual({ ok: true, feitos: ['5511999990000'], falhas: [], erro: null });
        const parcial = interpretarRespostaBlockUsers(200, { block_users: { added_users: [], failed_users: [{ input: '5511999990000', errors: [{ message: 'user has not messaged in last 24h' }] }] } });
        expect(parcial.ok).toBe(false);
        expect(parcial.erro).toMatch(/5511999990000: user has not messaged/);
        expect(interpretarRespostaBlockUsers(400, { error: { message: 'Unsupported post request', code: 100 } })).toMatchObject({ ok: false, erro: 'Unsupported post request', code: 100 });
        expect(interpretarRespostaBlockUsers(200, { block_users: { removed_users: [{ input: '5511999990000' }] } }, { remover: true }).feitos).toEqual(['5511999990000']);
    });
});

describe('notas e resumo', () => {
    it('a nota diz quem, por quê e o caminho de volta; o resumo traz o rótulo', () => {
        expect(notaDeBloqueio({ motivo: 'anuncio', por: 'paulo@sp.com', observacao: 'vende curso' })).toMatch(/BLOQUEADO por paulo \(Anúncio \/ propaganda: vende curso\).*🚫 Bloqueios/);
        expect(notaDeDesbloqueio({ por: 'ana@sp.com' })).toMatch(/DESBLOQUEADO por ana/);
        expect(resumoDoBloqueio({ numero: '5511999990000', motivo: 'golpe', descartadas: '3' } as any)).toMatchObject({ motivoRotulo: 'Golpe / phishing', descartadas: 3, ativo: true });
    });
});

describe('🚫 fiação — bloqueio que não fecha as três portas é etiqueta, não bloqueio', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const webhook = ler('sefaz-backend/whatsapp-webhook-routes.js');
    const tela = ler('components/SpConnect/index.tsx');

    it('ENTRADA: o webhook descarta ANTES de gravar, do bot e do aviso — e só o contador anda; ligação e pedido de retorno também', () => {
        const i = webhook.indexOf('const bloqueados = await lerBloqueados(db);');
        expect(i).toBeGreaterThan(-1);
        const depois = webhook.slice(i);
        expect(depois.indexOf('ev.mensagens = sep.livres;')).toBeLessThan(depois.indexOf('await gravarMensagemRecebida(db, msg, catalogo)'));
        expect(depois).toMatch(/descartadas: admin\.firestore\.FieldValue\.increment\(1\)/);
        expect(depois).toMatch(/if \(bloqueados\.has\(String\(c\.conversaId\)\)\) continue;/);
        expect(depois).toMatch(/pr\.numero && bloqueados\.has\(pr\.numero\)/);
        // Cache: o webhook não bate no banco a cada mensagem.
        expect(webhook).toMatch(/CACHE_BLOQUEIOS_MS/);
    });

    it('SAÍDA: responder, iniciar conversa, agendar, campanha e guia (/enviar) recusam nomeado', () => {
        const ocorrencias = (rotas.match(/RECUSA_BLOQUEADO/g) || []).length;
        expect(ocorrencias).toBeGreaterThanOrEqual(5);   // a const + 4 portas no mínimo
        for (const rota of ["router.post('/enviar'", "router.post('/conversas/iniciar'", "router.post('/conversas/:numero/responder'", "router.post('/conversas/:numero/agendamentos'"]) {
            const ini = rotas.indexOf(rota);
            expect(ini).toBeGreaterThan(-1);
            expect(rotas.slice(ini, ini + 2500)).toMatch(/estaBloqueado\(/);
        }
        expect(rotas).toMatch(/montarPublico\(\{ campanha: v\.campanha, contatos, catalogoEtiquetas: catalogo, empresas, bloqueados \}\)/);
        const r = montarPublico({
            campanha: { template: { nome: 't', idioma: 'pt_BR', categoria: 'UTILITY' }, publico: { tipo: 'numeros', numeros: ['5511999990000', '5511999990001'] } } as any,
            contatos: [], bloqueados: new Set(['5511999990001']),
        });
        expect(r.destinatarios.map((d) => d.numero)).toEqual(['5511999990000']);
        expect(r.pulados).toEqual([expect.objectContaining({ numero: '5511999990001', motivo: 'bloqueado' })]);
    });

    it('INBOX: conversa bloqueada some da lista; o bloqueio fecha a conversa e deixa nota; desbloquear reabre', () => {
        expect(rotas).toMatch(/docsConversas = docsConversas\.filter\(\(d\) => !\(d\.data\(\) \|\| \{\}\)\.bloqueada\)/);
        const criar = rotas.slice(rotas.indexOf("router.post('/bloqueios', requireAdmin"), rotas.indexOf("router.delete('/bloqueios/:numero'"));
        expect(criar).toMatch(/bloqueada: true/);
        expect(criar).toMatch(/notaDeBloqueio\(/);
        expect(criar).toMatch(/bloquearNaMeta\(\[b\.numero\]\)/);
        // A resposta da Meta é GRAVADA, não só logada — e o local vale com ou sem ela.
        expect(criar).toMatch(/meta = \{ ok: Boolean\(r\.ok\), erro:/);
        const tirar = rotas.slice(rotas.indexOf("router.delete('/bloqueios/:numero'"), rotas.indexOf('export default router'));
        expect(tirar).toMatch(/bloqueada: false/);
        expect(tirar).toMatch(/notaDeDesbloqueio\(/);
    });

    it('SÓ ADMIN: as três rotas e o modal', () => {
        expect(rotas).toMatch(/router\.get\('\/bloqueios', requireAdmin/);
        expect(rotas).toMatch(/router\.post\('\/bloqueios', requireAdmin/);
        expect(rotas).toMatch(/router\.delete\('\/bloqueios\/:numero', requireAdmin/);
        expect(tela).toMatch(/\{bloqAberto && ehAdmin && \(/);
        expect(tela).toMatch(/\{ehAdmin && \(\s*<button onClick=\{\(\) => abrirBloqueios\(''\)\}/);
        expect(tela).toMatch(/\{ehAdmin && sel\.canal !== 'instagram' && \(/);
        // Confirmação pela caixa do app (dentro do Teams não há window.confirm).
        expect(tela).toMatch(/await pedirConfirmacao\(\s*`Bloquear \$\{bloqNumero\.trim\(\)\}\?/);
        // O que a Meta respondeu aparece para quem bloqueou.
        expect(tela).toMatch(/A Meta não confirmou/);
        expect(COLECAO_BLOQUEIOS).toBe('whatsapp_bloqueios');
    });
});

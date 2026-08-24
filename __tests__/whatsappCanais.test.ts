// ============================================================================
// Segundo número / segunda WABA — "deixar o app apto" (Paulo, 16/08).
// O que estes testes protegem: (1) com UM número o app se comporta como
// antes; (2) a entrada roteia pela FONTE (phone_number_id da Meta); (3)
// número desconhecido não vira conversa do canal padrão; (4) o TOKEN nunca
// entra no cadastro.
// ============================================================================
import {
    CANAL_PADRAO_ID, canalDoEnv, normalizarCanalCadastrado, montarCatalogoCanais,
    canalDoEvento, canalDaConversa, credenciaisDoCanal, validarCanal,
} from '../sefaz-backend/whatsapp-canais.js';

const ENV = {
    WHATSAPP_PHONE_NUMBER_ID: '111', WHATSAPP_CLOUD_TOKEN: 'tok1',
    WHATSAPP_WABA_ID: '1289687319936644', WHATSAPP_ROTULO: 'Escritório',
};

describe('com UM número, nada muda', () => {
    it('o canal do env é o padrão e vem pronto', () => {
        const c = canalDoEnv(ENV);
        expect(c).toMatchObject({ id: CANAL_PADRAO_ID, phoneNumberId: '111', origem: 'env', pronto: true });
    });
    it('sem canal extra cadastrado, o catálogo tem só ele e NÃO é multi-canal (seletor seria clique a mais)', () => {
        const cat = montarCatalogoCanais({ env: ENV, cadastrados: [] });
        expect(cat.canais).toHaveLength(1);
        expect(cat.multiCanal).toBe(false);
        expect(cat.padraoId).toBe(CANAL_PADRAO_ID);
    });
    it('sem credencial, o canal diz que NÃO está pronto (em vez de fingir que existe)', () => {
        expect(canalDoEnv({}).pronto).toBe(false);
    });
});

describe('segundo número', () => {
    const extra = { id: 'rh', dados: { rotulo: 'RH', phoneNumberId: '222', envToken: 'WHATSAPP_CLOUD_TOKEN_RH' } };

    it('entra no catálogo e liga o modo multi-canal', () => {
        const cat = montarCatalogoCanais({ env: ENV, cadastrados: [extra] });
        expect(cat.canais.map((c: any) => c.id)).toEqual(['principal', 'rh']);
        expect(cat.multiCanal).toBe(true);
    });

    it('canal repetindo o MESMO número vira CONFLITO nomeado — dois canais no mesmo número roteariam ao acaso', () => {
        const cat = montarCatalogoCanais({
            env: ENV,
            cadastrados: [extra, { id: 'clone', dados: { rotulo: 'Clone', phoneNumberId: '111', envToken: 'X_TOKEN' } }],
        });
        expect(cat.canais.map((c: any) => c.id)).toEqual(['principal', 'rh']);
        expect(cat.conflitos[0]).toMatchObject({ id: 'clone', phoneNumberId: '111' });
    });

    it('normalizar preserva ativo/rótulo e responde pelo cadastro', () => {
        const c = normalizarCanalCadastrado('rh', { rotulo: 'RH', phoneNumberId: '222', envToken: 'T', ativo: false });
        expect(c).toMatchObject({ id: 'rh', ativo: false, origem: 'cadastro', pronto: true });
    });
});

describe('roteamento da ENTRADA — pela fonte, nunca por dedução', () => {
    const cat = montarCatalogoCanais({
        env: ENV, cadastrados: [{ id: 'rh', dados: { rotulo: 'RH', phoneNumberId: '222', envToken: 'T' } }],
    });

    it('o phone_number_id do payload decide o canal', () => {
        expect(canalDoEvento(cat, '111').canalId).toBe('principal');
        expect(canalDoEvento(cat, '222').canalId).toBe('rh');
    });

    it('evento SEM phone_number_id cai no padrão — e isso é fato enquanto só há um número', () => {
        const r = canalDoEvento(cat, null);
        expect(r.canalId).toBe('principal');
        expect(r.conhecido).toBe(true);
        expect(r.motivo).toContain('sem phone_number_id');
    });

    it('número DESCONHECIDO não vira conversa do padrão — misturaria dois números na mesma caixa', () => {
        const r = canalDoEvento(cat, '999');
        expect(r.canalId).toBeNull();
        expect(r.conhecido).toBe(false);
        expect(r.motivo).toContain('não está cadastrado');
    });

    it('a SAÍDA usa o canal da conversa (o mesmo por onde o cliente falou)', () => {
        expect(canalDaConversa(cat, { canalId: 'rh' })?.id).toBe('rh');
        // conversa antiga, sem carimbo: o padrão — só havia ele
        expect(canalDaConversa(cat, {})?.id).toBe('principal');
        // canal que sumiu do catálogo não deixa a saída sem rumo
        expect(canalDaConversa(cat, { canalId: 'apagado' })?.id).toBe('principal');
    });
});

describe('credenciais e cadastro — o token NUNCA entra no banco', () => {
    it('o valor do token vem do ENV; o cadastro guarda só o NOME da variável', () => {
        const cat = montarCatalogoCanais({ env: ENV, cadastrados: [{ id: 'rh', dados: { rotulo: 'RH', phoneNumberId: '222', envToken: 'TOKEN_RH' } }] });
        const rh = cat.canais.find((c: any) => c.id === 'rh');
        const cred = credenciaisDoCanal(rh, { ...ENV, TOKEN_RH: 'tok2' });
        expect(cred.pronto).toBe(true);
        expect(cred.cfg?.token).toBe('tok2');
        // O objeto do canal (que a tela recebe) não carrega segredo nenhum.
        expect(JSON.stringify(rh)).not.toContain('tok2');
    });

    it('faltando a env no Cloud Run, a resposta DIZ qual variável falta', () => {
        const cat = montarCatalogoCanais({ env: ENV, cadastrados: [{ id: 'rh', dados: { rotulo: 'RH', phoneNumberId: '222', envToken: 'TOKEN_RH' } }] });
        const cred = credenciaisDoCanal(cat.canais.find((c: any) => c.id === 'rh'), ENV);
        expect(cred.pronto).toBe(false);
        expect(cred.faltas.join(' ')).toContain('TOKEN_RH');
    });

    it('cadastro recusa id do padrão, número torto e — o mais importante — o TOKEN colado no lugar do nome', () => {
        // phone_number_id da Meta é um número longo (o do painel), não 3 dígitos.
        const PNID = '778234567890123';
        expect(validarCanal({ id: 'principal', phoneNumberId: PNID, rotulo: 'X', envToken: 'TOKEN_X' }).ok).toBe(false);
        expect(validarCanal({ id: 'rh', phoneNumberId: 'abc', rotulo: 'RH', envToken: 'TOKEN_RH' }).ok).toBe(false);
        expect(validarCanal({ id: 'rh', phoneNumberId: PNID, rotulo: '', envToken: 'TOKEN_RH' }).ok).toBe(false);
        const colouToken = validarCanal({
            id: 'rh', phoneNumberId: PNID, rotulo: 'RH',
            envToken: 'EAAG1234567890abcdefghijklmnop',
        });
        expect(colouToken.ok).toBe(false);
        expect((colouToken as any).erros.join(' ')).toContain('valor fica só no Cloud Run');
        expect(validarCanal({ id: 'rh', phoneNumberId: PNID, rotulo: 'RH', envToken: 'WHATSAPP_CLOUD_TOKEN_2' }).ok).toBe(true);
    });
});

// ─── 🚨 A resposta sai pelo MESMO número em que o cliente falou (22/08) ─────
// Na véspera do 2º número (o fixo 3155-1554) entrar: TODOS os envios usavam o
// número padrão do env — responder uma conversa do canal 2 abriria OUTRA
// conversa no cliente, vinda do número principal. `cfgDeEnvioDaConversa` é o
// dono; /responder, /anexo, avisos, pesquisa e o BOT passam por ele.
describe('cfgDeEnvioDaConversa — o canal de SAÍDA é o da conversa', () => {
    const { cfgDeEnvioDaConversa } = require('../sefaz-backend/whatsapp-canais.js');
    const dbCom = (doc: { exists: boolean; id?: string; dados?: Record<string, unknown> }) => ({
        collection: () => ({
            doc: () => ({
                get: async () => ({ exists: doc.exists, id: doc.id, data: () => doc.dados }),
            }),
        }),
    });

    it('conversa do número padrão (canalId ausente ou "principal") usa o env de sempre', async () => {
        expect(await cfgDeEnvioDaConversa(dbCom({ exists: false }), {})).toEqual({ cfg: null });
        expect(await cfgDeEnvioDaConversa(dbCom({ exists: false }), { canalId: 'principal' })).toEqual({ cfg: null });
    });

    it('conversa de canal cadastrado responde com as credenciais DELE', async () => {
        const db = dbCom({ exists: true, id: 'linha-1554', dados: { rotulo: 'Linha 1554', phoneNumberId: '111222333', envToken: 'TOKEN_TESTE_CANAL' } });
        const r = await cfgDeEnvioDaConversa(db, { canalId: 'linha-1554' }, { TOKEN_TESTE_CANAL: 'tok-do-canal' });
        expect(r.erro).toBeUndefined();
        expect(r.cfg).toMatchObject({ token: 'tok-do-canal', phoneNumberId: '111222333' });
    });

    it('canal sumido ou incompleto é RECUSA nomeada — mandar por OUTRO número em silêncio é o defeito', async () => {
        const sumido = await cfgDeEnvioDaConversa(dbCom({ exists: false }), { canalId: 'linha-x' });
        expect(sumido.erro).toContain('não está mais cadastrado');
        const semToken = await cfgDeEnvioDaConversa(
            dbCom({ exists: true, id: 'linha-1554', dados: { rotulo: 'Linha 1554', phoneNumberId: '111222333', envToken: 'TOKEN_QUE_NAO_EXISTE' } }),
            { canalId: 'linha-1554' }, {},
        );
        expect(semToken.erro).toContain('incompleto');
    });

    it('fiação: os caminhos de ENVIO passam pelo dono (responder, anexo, avisos, pesquisa e bot)', () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const rotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
        // responder + aviso de transferência + pesquisa + anexo = 4 chamadas.
        expect((rotas.match(/cfgDeEnvioDaConversa\(/g) || []).length).toBeGreaterThanOrEqual(4);
        const webhook = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');
        // bot + agradecimento da avaliação = 2 chamadas; e as saídas do bot
        // carregam o depsEnvio (responder do bot e imagem de fila).
        expect((webhook.match(/cfgDeEnvioDaConversa\(/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(webhook).toContain("enviarTextoLivre({ para: msg.de, texto: acao.texto }, depsEnvio)");
        expect(webhook).toContain("link: acao.url }, depsEnvio)");
    });
});

// ═══ 📱 ATIVAR o número na Cloud API (Paulo, 24/08, no 3155-1554) ═══════════
// A Meta disse, no próprio painel, ao tentar concluir a verificação em duas
// etapas: "A conta não existe na API de Nuvem. Use /register API para criar
// uma conta primeiro." Número APROVADO (nome de exibição) ainda não está no
// WhatsApp — a busca responde "este número não está no WhatsApp" e ele não
// recebe mensagem nenhuma. O painel não faz esse passo; só a API faz.
describe('registro do número na Cloud API', () => {
    const fs2 = require('fs') as typeof import('fs');
    const path2 = require('path') as typeof import('path');
    const ler = (p: string) => fs2.readFileSync(path2.join(process.cwd(), p), 'utf8');
    const cloud = ler('sefaz-backend/whatsapp-cloud.js');
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const tela = ler('components/SpConnect/index.tsx');

    it('chama o /register com o PIN de 6 dígitos', () => {
        expect(cloud).toMatch(/\$\{numeroId\}\/register/);
        expect(cloud).toMatch(/messaging_product: 'whatsapp', pin: codigo/);
        expect(cloud).toMatch(/test\(codigo\)/);
    });

    it('🔒 o PIN NÃO é guardado nem cai no log', () => {
        const rota = rotas.slice(rotas.indexOf("router.post('/canais/:id/registrar'"));
        // Até o INÍCIO da próxima rota — cortar no primeiro `});` pararia
        // dentro do primeiro `res.json({...})` e o teste passaria por engano.
        const corpo = rota.slice(0, rota.indexOf("router.post('/canais'"));
        // Nada de gravar em coleção…
        expect(corpo).not.toMatch(/\.set\(|\.add\(|\.update\(/);
        // …e o log leva a recusa da Meta, nunca o pin.
        expect(corpo).toMatch(/console\.warn\('\[whatsapp\/registrar\] recusa da Meta:/);
        expect(corpo).not.toMatch(/console\.\w+\([^)]*pin/i);
    });

    it('é ação de ADMIN e recusa canal sem credencial', () => {
        expect(rotas).toMatch(/router\.post\('\/canais\/:id\/registrar', requireAdmin/);
        const rota = rotas.slice(rotas.indexOf("router.post('/canais/:id/registrar'"));
        expect(rota.slice(0, 1800)).toMatch(/cred\.pronto/);
    });

    it('a tela pede o PIN, confirma antes e manda guardá-lo no cofre', () => {
        expect(tela).toMatch(/Ativar na Cloud API/);
        expect(tela).toMatch(/Anote o PIN no cofre de senhas/);
        expect(tela).toMatch(/PIN \(6 dígitos\)/);
    });
});

// 🔬 24/08: número cadastrado, ATIVADO na Cloud API, e o cliente continuava
// vendo "não está no WhatsApp". Deduzir dali é chute — o app do WhatsApp
// CACHEIA esse veredito. Quem responde é a Meta.
describe('sonda do número na Meta', () => {
    const fs3 = require('fs') as typeof import('fs');
    const path3 = require('path') as typeof import('path');
    const ler2 = (p: string) => fs3.readFileSync(path3.join(process.cwd(), p), 'utf8');
    const cloud2 = ler2('sefaz-backend/whatsapp-cloud.js');
    const rotas2 = ler2('sefaz-backend/whatsapp-routes.js');
    const tela2 = ler2('components/SpConnect/index.tsx');

    it('pergunta os campos que separam "propagando" de "falta um passo"', () => {
        expect(cloud2).toMatch(/code_verification_status/);
        expect(cloud2).toMatch(/platform_type/);
    });

    it('é LEITURA pura — a rota não grava nada', () => {
        const rota = rotas2.slice(rotas2.indexOf("router.get('/canais/:id/status'"));
        const corpo = rota.slice(0, rota.indexOf('// 📱 ATIVAR'));
        expect(corpo).not.toMatch(/\.set\(|\.add\(|\.update\(/);
    });

    it('a tela mostra o termo CRU da Meta (para o suporte achar) e diz o que fazer', () => {
        expect(tela2).toMatch(/Conferir na Meta/);
        expect(tela2).toMatch(/status: \$\{n\.status\}/);
        expect(tela2).toMatch(/é cache do app/);
        expect(tela2).toMatch(/Enquanto não estiver CONNECTED/);
    });
});

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

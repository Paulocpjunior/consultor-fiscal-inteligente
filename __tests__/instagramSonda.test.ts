/**
 * Sonda de DM do Instagram (Paulo, 18/08: "Conseguimos linkar as DM do nosso
 * Instagram?").
 *
 * O token do WhatsApp foi concedido só pras permissões DO WHATSAPP — Mensagens
 * do Instagram é outro produto da Graph API. Esta sonda pergunta com o MESMO
 * token e RELATA, sem linkar nada. A régua que mais importa aqui é a mesma da
 * sonda de chamada: **achar a conta não é o mesmo que "pronto para
 * mensagens"** — são permissões diferentes, e o veredito não pode prometer o
 * que não foi testado.
 */
import {
    interpretarSondaInstagram, concluirSondaInstagram,
    CANDIDATOS_SONDA, SOBRE_RESTRINGIR_ATENDENTES,
} from '../sefaz-backend/instagram-sonda';

describe('interpretarSondaInstagram — candidato "token" (controle)', () => {
    it('200 com id reconhecível é token-ok', () => {
        const r = interpretarSondaInstagram('token', 200, { id: '123', name: 'SP Assessoria' });
        expect(r.situacao).toBe('token-ok');
        expect(r.motivo).toContain('SP Assessoria');
    });

    it('200 sem id é nao-reconhecido, com o cru junto', () => {
        const r = interpretarSondaInstagram('token', 200, { estranho: true });
        expect(r.situacao).toBe('nao-reconhecido');
        expect(r.bruto).toEqual({ estranho: true });
    });
});

describe('interpretarSondaInstagram — candidato "paginas"', () => {
    it('achou Página COM Instagram vinculado → conta-encontrada, com pagina e instagram', () => {
        const r = interpretarSondaInstagram('paginas', 200, {
            data: [{ id: 'pg1', name: 'SP Assessoria Contábil', instagram_business_account: { id: 'ig1', username: 'spassessoria' } }],
        });
        expect(r.situacao).toBe('conta-encontrada');
        expect(r.pagina).toEqual({ id: 'pg1', nome: 'SP Assessoria Contábil' });
        expect(r.instagram).toEqual({ id: 'ig1', username: 'spassessoria' });
        expect(r.motivo).toContain('@spassessoria');
    });

    it('Instagram sem username exibe o id no lugar (nunca campo vazio)', () => {
        const r = interpretarSondaInstagram('paginas', 200, {
            data: [{ id: 'pg1', name: 'SP', instagram_business_account: { id: 'ig1' } }],
        });
        expect(r.instagram).toEqual({ id: 'ig1', username: null });
        expect(r.motivo).toContain('@ig1');
    });

    it('páginas existem, NENHUMA com Instagram → pagina-sem-instagram, listando os nomes', () => {
        const r = interpretarSondaInstagram('paginas', 200, {
            data: [{ id: 'pg1', name: 'Página A' }, { id: 'pg2', name: 'Página B' }],
        });
        expect(r.situacao).toBe('pagina-sem-instagram');
        expect(r.motivo).toContain('Página A');
        expect(r.motivo).toContain('Página B');
        expect(r.acao).toMatch(/Meta Business Suite/i);
    });

    it('lista vazia → sem-pagina, com a ação apontando pro Business Manager', () => {
        const r = interpretarSondaInstagram('paginas', 200, { data: [] });
        expect(r.situacao).toBe('sem-pagina');
        expect(r.acao).toMatch(/Business Manager/i);
    });

    it('forma inesperada (sem "data") → nao-reconhecido, nunca afirmando "sem página"', () => {
        const r = interpretarSondaInstagram('paginas', 200, { algo: 'diferente' });
        expect(r.situacao).toBe('nao-reconhecido');
    });
});

describe('🚨 indeterminado nunca vira uma afirmação negativa — mesma régua da sonda de chamada', () => {
    it('sem resposta (rede caiu) é indeterminado', () => {
        expect(interpretarSondaInstagram('paginas', null, null).situacao).toBe('indeterminado');
        expect(interpretarSondaInstagram('token', null, null).situacao).toBe('indeterminado');
    });

    it('401/403 é sem-permissao, e a ação explica que é ESPERADO (token é só do WhatsApp)', () => {
        const r = interpretarSondaInstagram('paginas', 403, { error: { message: 'faltou escopo' } });
        expect(r.situacao).toBe('sem-permissao');
        expect(r.acao).toMatch(/concedido só pro WhatsApp/);
    });

    it('erro >=400 fora de 401/403 é indeterminado, não "sem página"', () => {
        const r = interpretarSondaInstagram('paginas', 500, { error: { message: 'oops' } });
        expect(r.situacao).toBe('indeterminado');
    });
});

describe('concluirSondaInstagram', () => {
    const candidato = (id: string, extra: any) => ({ candidato: id, rotulo: id, hipotese: '', ...extra });

    it('conta-encontrada MANDA — e a ação diz que isso NÃO prova mensagem', () => {
        const resultados = [
            candidato('token', { situacao: 'token-ok', motivo: 'ok' }),
            candidato('paginas', {
                situacao: 'conta-encontrada', motivo: 'achou',
                pagina: { id: 'pg1', nome: 'SP' }, instagram: { id: 'ig1', username: 'spassessoria' },
            }),
        ];
        const c = concluirSondaInstagram(resultados);
        expect(c.veredito).toBe('conta-encontrada');
        expect(c.instagram?.username).toBe('spassessoria');
        // 🚨 A trava que mais importa: achar a conta não é "pronto pra mensagem".
        expect(c.acao).toMatch(/não prova MENSAGEM|permissão de MENSAGEM/);
    });

    it('sem-pagina e pagina-sem-instagram passam direto o motivo/ação do candidato "paginas"', () => {
        const c1 = concluirSondaInstagram([candidato('paginas', { situacao: 'sem-pagina', motivo: 'nenhuma página', acao: 'vá no Business Manager' })]);
        expect(c1.veredito).toBe('sem-pagina');
        const c2 = concluirSondaInstagram([candidato('paginas', { situacao: 'pagina-sem-instagram', motivo: 'sem IG', acao: 'vincule no Business Suite' })]);
        expect(c2.veredito).toBe('pagina-sem-instagram');
    });

    it('paginas indeterminado + token sem-permissao → veredito sem-permissao', () => {
        const resultados = [
            candidato('token', { situacao: 'sem-permissao', motivo: 'token não alcança', acao: 'ação x' }),
            candidato('paginas', { situacao: 'indeterminado', motivo: 'rede' }),
        ];
        expect(concluirSondaInstagram(resultados).veredito).toBe('sem-permissao');
    });

    it('nada conclusivo → indeterminado, nunca uma afirmação negativa', () => {
        const resultados = [
            candidato('token', { situacao: 'indeterminado', motivo: 'rede' }),
            candidato('paginas', { situacao: 'indeterminado', motivo: 'rede' }),
        ];
        expect(concluirSondaInstagram(resultados).veredito).toBe('indeterminado');
    });

    it('lista vazia não explode', () => {
        expect(concluirSondaInstagram([]).veredito).toBe('indeterminado');
        expect(concluirSondaInstagram(undefined as any).veredito).toBe('indeterminado');
    });
});

describe('o resto da resposta', () => {
    it('CANDIDATOS_SONDA tem os dois caminhos, com hipótese escrita (não código mudo)', () => {
        expect(CANDIDATOS_SONDA.map((c: any) => c.id)).toEqual(['token', 'paginas']);
        CANDIDATOS_SONDA.forEach((c: any) => expect(c.hipotese.length).toBeGreaterThan(10));
    });

    it('SOBRE_RESTRINGIR_ATENDENTES responde a segunda metade da pergunta do Paulo, sem depender da sonda', () => {
        expect(SOBRE_RESTRINGIR_ATENDENTES.texto).toMatch(/fila/i);
    });
});

describe('🚨 a sonda NÃO linka nada', () => {
    it('o núcleo não tem nenhuma escrita na Meta (POST/DELETE) nem no banco', () => {
        // Mesma prova do `whatsapp-chamadas.js`: o handler que CONSULTA não
        // pode escrever. Aqui o custo de escrever por engano é vincular a
        // conta errada ou tentar assinar um webhook sem ninguém ter decidido.
        const fonte = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'sefaz-backend/instagram-sonda.js'), 'utf8');
        expect(fonte).not.toMatch(/method:\s*['"](POST|DELETE|PUT|PATCH)['"]/);
        expect(fonte).not.toMatch(/\.set\(|\.update\(|\.doc\(/);
    });
});

// ============================================================================
// 🚨 ROTA SEM BOTÃO NÃO É FUNCIONALIDADE (família do rito de fechamento do
// EFD-Reinf que subiu sem tela, e do card CFOP que não levava ao CFOP).
// ============================================================================
describe('a tela do Connect chama a sonda — não é rota morta', () => {
    const rotas = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');
    const servico = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'services/spConnectService.ts'), 'utf8');

    it('a rota existe e é admin-only, GET (nunca ação por engano)', () => {
        expect(rotas).toMatch(/router\.get\('\/instagram\/sondar', requireAdmin/);
    });

    it('o serviço chama a MESMA URL da rota', () => {
        expect(servico).toMatch(/\/api\/admin\/whatsapp\/instagram\/sondar/);
    });

    it('a tela tem a aba, o botão e usa o serviço — não uma cópia da lógica', () => {
        expect(tela).toMatch(/'instagram'.*'📷 Instagram'/);
        expect(tela).toMatch(/rodarSondaIg/);
        expect(tela).toMatch(/sondarInstagram\(\)/);
    });
});

// ============================================================================
// CONSULTA DE PRAZO MUNICIPAL — proposta COM FONTE, nunca escrita direta.
//
// Paulo, 11/08: *"consulta mensal pelo Gemini é PROPOSTA COM FONTE, nunca
// escrita direta: o app mostra a DIFERENÇA contra o catálogo e humano confirma
// — data de pagamento não muda sozinha, e modelo com busca reduz o chute mas
// pode citar blog no lugar do ato"*.
//
// O que estes testes protegem é a diferença entre CONSULTAR e ACREDITAR.
// ============================================================================
import {
    montarPromptPrazoMunicipal, interpretarPropostaPrazo, ehFonteOficial,
} from '../sefaz-backend/prazo-municipal-consulta.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FONTE_OFICIAL = { uri: 'https://legislacao.prefeitura.sp.gov.br/leis/lei-13701', title: 'Lei 13.701' };
const FONTE_BLOG = { uri: 'https://blogcontabil.com.br/iss-sao-paulo', title: 'Blog Contábil' };
const RESP = JSON.stringify({
    diaVencimento: 10, mesesApos: 1,
    baseLegal: 'Lei Municipal 13.701/2003, art. 20', observacao: '',
});

describe('🚨 proposta SEM FONTE é chute — e chute aqui é multa', () => {
    it('sem grounding, a consulta é RECUSADA e manda ao site da prefeitura', () => {
        // O modelo responderia um prazo inventado com a mesma confiança de um
        // certo. É por isso que a ausência de fonte derruba a proposta INTEIRA,
        // e não vira só um aviso ao lado do número.
        const r = interpretarPropostaPrazo({ texto: RESP, fontes: [] });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/NENHUMA fonte/);
        expect(r.proposta).toBeUndefined();
    });
});

describe('🚨 dia ilegível NÃO vira default', () => {
    it.each([
        ['nulo', JSON.stringify({ diaVencimento: null, baseLegal: '' })],
        ['fora da faixa', JSON.stringify({ diaVencimento: 45, baseLegal: 'x' })],
        ['texto solto', 'o ISS de São Paulo vence dia 10'],
    ])('%s ⇒ recusa, não proposta', (_caso, texto) => {
        const r = interpretarPropostaPrazo({ texto, fontes: [FONTE_OFICIAL] });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/não recebe chute|não devolveu um dia/);
    });

    it('e a recusa PRESERVA as fontes — elas continuam sendo o caminho', () => {
        const r = interpretarPropostaPrazo({ texto: 'não sei', fontes: [FONTE_OFICIAL] });
        expect(r.fontes).toHaveLength(1);
    });
});

describe('fonte não oficial vai MARCADA, não escondida', () => {
    it('só blog ⇒ proposta sai, com o aviso de conferir na prefeitura', () => {
        // Esconder a proposta seria perder trabalho bom; escondê-la do aviso
        // seria pior — o modelo cita o que acha, e quem decide é quem lê.
        const r = interpretarPropostaPrazo({ texto: RESP, fontes: [FONTE_BLOG] });
        expect(r.ok).toBe(true);
        expect(r.fontes[0].oficial).toBe(false);
        expect(r.avisos.join(' ')).toMatch(/Nenhuma fonte oficial/);
    });

    it('.gov.br conta como oficial; domínio parecido, não', () => {
        expect(ehFonteOficial('https://prefeitura.sp.gov.br/x')).toBe(true);
        expect(ehFonteOficial('https://camara.leg.br/lei')).toBe(true);
        expect(ehFonteOficial('https://gov.br.exemplo.com/x')).toBe(false);
        expect(ehFonteOficial('https://blog.com/gov.br')).toBe(false);
    });

    it('sem a norma na resposta, avisa que o cadastro vai EXIGIR a base legal', () => {
        const semNorma = JSON.stringify({ diaVencimento: 10, baseLegal: '' });
        const r = interpretarPropostaPrazo({ texto: semNorma, fontes: [FONTE_OFICIAL] });
        expect(r.ok).toBe(true);
        expect(r.avisos.join(' ')).toMatch(/EXIGE a base legal/);
    });
});

describe('o que o humano confirma é a DIFERENÇA, não o número solto', () => {
    const atual = { diaVencimento: 20, mesesApos: 1 };

    it('mostra o que mudaria e manda cadastrar VIGÊNCIA NOVA', () => {
        const r = interpretarPropostaPrazo({ texto: RESP, fontes: [FONTE_OFICIAL], cadastroAtual: atual });
        expect(r.diferenca!.mudou).toBe(true);
        expect(r.diferenca!.campos.join(' ')).toMatch(/dia 20 → 10/);
        // Editar a vigência antiga reescreveria o passado: a competência
        // anterior tem que continuar saindo com a regra que valia nela.
        expect(r.diferenca!.acao).toMatch(/VIGÊNCIA NOVA/);
    });

    it('consulta que BATE com o cadastro diz "nada a fazer"', () => {
        const r = interpretarPropostaPrazo({
            texto: RESP, fontes: [FONTE_OFICIAL], cadastroAtual: { diaVencimento: 10, mesesApos: 1 },
        });
        expect(r.diferenca!.mudou).toBe(false);
        expect(r.diferenca!.acao).toMatch(/Nada a fazer/);
    });
});

describe('o pedido já pede a NORMA — senão a consulta se gasta à toa', () => {
    it('pede JSON, pede lei/decreto e PROÍBE estimativa', () => {
        const p = montarPromptPrazoMunicipal({ municipioNome: 'Jundiaí', uf: 'SP', codMunIBGE: '3525904' });
        expect(p).toMatch(/Jundiaí/);
        expect(p).toMatch(/3525904/);
        expect(p).toMatch(/lei\/decreto municipal/);
        expect(p).toMatch(/NÃO estime/);
    });
});

describe('a consulta NUNCA grava — quem grava é o cadastro, com dono', () => {
    it('a rota de consulta não escreve no Firestore', () => {
        const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/prazos-municipais-routes.js'), 'utf8');
        // Recorta SÓ este handler — o `/desativar` vem logo depois e grava.
        const ini = rota.indexOf("router.post('/consultar'");
        const fim = rota.indexOf('router.post(', ini + 10);
        const consulta = rota.slice(ini, fim > 0 ? fim : undefined);
        expect(consulta).toMatch(/interpretarPropostaPrazo/);
        // Escrita só existe no POST de cadastro, que é outro handler.
        expect(consulta).not.toMatch(/\.set\(/);
        expect(consulta).not.toMatch(/\.update\(/);
    });
});

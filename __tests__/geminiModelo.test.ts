// ============================================================================
// GEMINI 3.7 — pinar PERGUNTANDO, nunca chutando o ID.
//
// Paulo, 15/08: *"pedi para você atualizar p a versão 3.7"*.
//
// O que estes testes protegem não é o número: é a diferença entre PINAR e
// APOSTAR. Escrever 'gemini-3.7-pro' na mão derruba a IA do escritório inteiro
// no dia em que o nome real for outro — e derruba CALADO, no deploy.
// ============================================================================
import {
    escolherModeloDaFamilia, resolverModelosGemini, versaoAtendeAlvo,
    normalizarNomeModelo, FAMILIA_ALVO_GEMINI, ALIAS_PRO, ALIAS_FLASH,
} from '../sefaz-backend/gemini-modelo.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const m = (name: string, acoes: string[] = ['generateContent']) => ({ name, supportedActions: acoes });

const CONTA_COM_37 = [
    m('models/gemini-2.5-pro'),
    m('models/gemini-3.7-pro'),
    m('models/gemini-3.7-pro-preview-11-20'),
    m('models/gemini-3.7-flash'),
    m('models/gemini-3.7-flash-lite'),
    m('models/text-embedding-004', ['embedContent']),
];

describe('o alvo é a família 3.7', () => {
    it('pina o Pro e o Flash da 3.7 quando a API os lista', () => {
        const r = resolverModelosGemini({ modelos: CONTA_COM_37 });
        expect(r.familiaAlvo).toBe('3.7');
        expect(r.pro.modelo).toBe('gemini-3.7-pro');
        expect(r.flash.modelo).toBe('gemini-3.7-flash');
        expect(r.pro.origem).toBe('familia-alvo');
        expect(r.alvoEncontrado).toBe(true);
    });

    it('GA vence preview — nome estável antes do datado', () => {
        expect(escolherModeloDaFamilia(CONTA_COM_37, { familia: '3.7', tipo: 'pro' }).modelo)
            .toBe('gemini-3.7-pro');
    });

    it('🚨 `-lite` NÃO ocupa a vaga do Flash', () => {
        // Outro degrau de preço/qualidade. O roteador Pro×Flash manda prompt de
        // trabalho ao Flash — cair no lite rebaixaria o app em silêncio.
        const soLite = [m('models/gemini-3.7-flash-lite')];
        expect(escolherModeloDaFamilia(soLite, { familia: '3.7', tipo: 'flash' }).modelo).toBeNull();
    });

    it('modelo que não gera conteúdo fica de fora', () => {
        const emb = [m('models/gemini-3.7-pro-embedding', ['embedContent'])];
        expect(escolherModeloDaFamilia(emb, { familia: '3.7', tipo: 'pro' }).modelo).toBeNull();
    });

    it('a família casa com FRONTEIRA — 3.7 não é 3.70 nem 13.7', () => {
        const parecidos = [m('models/gemini-3.70-pro'), m('models/gemini-13.7-pro')];
        expect(escolherModeloDaFamilia(parecidos, { familia: '3.7', tipo: 'pro' }).modelo).toBeNull();
    });
});

describe('🚨 sem a lista, NÃO se inventa o ID', () => {
    it('lista vazia cai no alias e DIZ que não conferiu o alvo', () => {
        const r = resolverModelosGemini({ modelos: null });
        expect(r.pro.modelo).toBe(ALIAS_PRO);
        expect(r.flash.modelo).toBe(ALIAS_FLASH);
        expect(r.pro.origem).toBe('alias-sem-lista');
        expect(r.pro.motivo).toMatch(/não foi conferido/i);
        // O que NÃO pode acontecer: o app pedir um nome que ninguém viu existir.
        expect(r.pro.modelo).not.toMatch(/3\.7/);
    });

    it('conta sem a 3.7 continua funcionando no alias, com o motivo nomeado', () => {
        const r = resolverModelosGemini({ modelos: [m('models/gemini-2.5-pro'), m('models/gemini-2.5-flash')] });
        expect(r.pro.modelo).toBe(ALIAS_PRO);
        expect(r.pro.origem).toBe('alias-fallback');
        expect(r.pro.motivo).toMatch(/não lista nenhum modelo PRO da família 3\.7/i);
        expect(r.pro.motivo).toMatch(/sem deploy/);
        expect(r.alvoEncontrado).toBe(false);
    });
});

describe('o env do operador vence a regra automática', () => {
    it('pino à mão não é sobrescrito nem quando a 3.7 existe', () => {
        const r = resolverModelosGemini({ modelos: CONTA_COM_37, envPro: 'gemini-2.5-pro' });
        expect(r.pro.modelo).toBe('gemini-2.5-pro');
        expect(r.pro.origem).toBe('env');
        expect(r.flash.modelo).toBe('gemini-3.7-flash'); // o outro segue a regra
    });
});

describe('"estamos no 3.7?" se responde pelo que a API DEVOLVEU', () => {
    it('modelVersion da família alvo confirma, mesmo via alias', () => {
        expect(versaoAtendeAlvo('gemini-3.7-pro')).toBe(true);
        expect(versaoAtendeAlvo('gemini-2.5-pro')).toBe(false);
    });

    it('sem resposta não se afirma NADA — nem sim, nem não', () => {
        // Falha de sonda virando "false" leria como "estamos atrasados", e
        // alguém iria pinar por engano um modelo que já estava certo.
        expect(versaoAtendeAlvo('')).toBeNull();
        expect(versaoAtendeAlvo(null as any)).toBeNull();
    });

    it('normaliza o prefixo models/', () => {
        expect(normalizarNomeModelo('models/gemini-3.7-pro')).toBe('gemini-3.7-pro');
    });
});

describe('o servidor usa o resolvedor — não uma constante escrita à mão', () => {
    const server = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

    it('server.js importa e chama resolverModelosGemini', () => {
        expect(server).toMatch(/resolverModelosGemini/);
        expect(server).toMatch(/gemini-modelo\.js/);
    });

    it('🚨 nenhum ID da família alvo escrito à mão no código', () => {
        // A trava real: varredura por COMPORTAMENTO. Se alguém "simplificar"
        // trocando o resolvedor por uma constante, o app volta a apostar num
        // nome que ninguém viu responder — e cai calado no deploy.
        const semComentarios = server
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        const cravados = semComentarios.match(/['"`]gemini-\d+\.\d+[a-z0-9-]*['"`]/gi) || [];
        expect(cravados).toEqual([]);
    });

    it('a família alvo mora no módulo, não espalhada', () => {
        expect(FAMILIA_ALVO_GEMINI).toBe('3.7');
    });

    it('🚨 nenhum router tem a SEGUNDA CÓPIA da escolha de modelo', () => {
        // Esta cópia existia e já tinha divergido: a rota de parecer jurídico
        // lia `GEMINI_MODEL_PRO` caindo no alias do FLASH — o caso mais
        // analítico do app saindo no modelo barato, calado. Varredura por
        // COMPORTAMENTO (quem lê o env), nunca lista de arquivos.
        const dono = 'sefaz-backend/gemini-modelo.js';
        const arquivos = require('child_process')
            .execSync('grep -rl "process.env.GEMINI_MODEL" sefaz-backend components services server.js || true',
                { cwd: join(__dirname, '..'), encoding: 'utf8' })
            .split('\n').map((s: string) => s.trim()).filter(Boolean)
            .filter((f: string) => f !== dono && f !== 'server.js'); // server.js é quem resolve
        expect(arquivos).toEqual([]);
    });
});

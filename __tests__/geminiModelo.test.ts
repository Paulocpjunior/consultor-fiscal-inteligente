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

    it('🚨 O CASO REAL DA CONTA (print 16/08): Flash no 3.7, Pro no 3.1', () => {
        // O seletor do Gemini do Paulo mostra, na MESMA lista: "3.5 Flash Lite",
        // "3.7 Flash" e "3.1 Pro". As linhas NÃO andam no mesmo número — e era
        // isso que fazia o app procurar um "3.7 Pro" inexistente e concluir,
        // errado, que "a família 3.7 não aparece para esta conta".
        const contaReal = [
            m('models/gemini-3.5-flash-lite'),
            m('models/gemini-3.7-flash'),
            m('models/gemini-3.1-pro'),
        ];
        const r = resolverModelosGemini({ modelos: contaReal });
        expect(r.flash.modelo).toBe('gemini-3.7-flash');
        expect(r.flash.atingiuPiso).toBe(true);
        // O Pro pina no mais novo DELE, e o app DIZ que a linha está atrás —
        // em vez de fingir que não achou nada.
        expect(r.pro.modelo).toBe('gemini-3.1-pro');
        expect(r.pro.atingiuPiso).toBe(false);
        // E o roteador volta a ter efeito: dois modelos DIFERENTES.
        expect(r.pro.modelo).not.toBe(r.flash.modelo);
    });

    it('dentro da mesma linha, o mais novo vence', () => {
        const versoes = [m('models/gemini-2.5-pro'), m('models/gemini-3.1-pro'), m('models/gemini-1.5-pro')];
        expect(escolherModeloDaFamilia(versoes, { familia: '3.7', tipo: 'pro' }).modelo).toBe('gemini-3.1-pro');
    });

    it('modelo sem versão no nome não entra — não dá para dizer se é novo', () => {
        expect(escolherModeloDaFamilia([m('models/gemini-pro')], { familia: '3.7', tipo: 'pro' }).modelo).toBeNull();
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

    it('🚨 conta atrás do piso PINA NO MAIS NOVO — não volta pro alias', () => {
        // Premissa corrigida em 16/08: ficar no alias quando existe um modelo
        // mais novo listado é abrir mão de escolher. O piso serve para DIZER
        // que a linha está atrás, não para desistir dela.
        const r = resolverModelosGemini({ modelos: [m('models/gemini-2.5-pro'), m('models/gemini-2.5-flash')] });
        expect(r.pro.modelo).toBe('gemini-2.5-pro');
        expect(r.pro.origem).toBe('familia-alvo');
        expect(r.pro.atingiuPiso).toBe(false);
        expect(r.pro.motivo).toMatch(/não andam no mesmo número/);
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

// ═══ O PRINT DE PRODUÇÃO (15/08) DERRUBOU O PRÓPRIO PAINEL ══════════════════
//
// Paulo abriu o ⚙️ Config Admin e a tela mostrou, LADO A LADO:
//   ⚠ A família 3.7 ainda não aparece para esta conta — o app segue no alias.
//   ✓ gemini-flash-latest → gemini-3.7-flash · na família alvo
//   ✓ gemini-flash-latest → gemini-3.7-flash · na família alvo
//
// O cabeçalho dizia que NÃO estamos na 3.7 enquanto as duas sondas mostravam a
// conta sendo atendida POR ELA. Eu reproduzi, no meu próprio painel, a
// armadilha que este projeto mais pagou.
describe('🚨 quem responde "estamos no 3.7?" é a SONDA, não a listagem', () => {
    const { vereditoDaFamilia, conferirRoteador } = require('../sefaz-backend/gemini-modelo.js');

    it('o caso REAL do print: fora da listagem, mas ATENDIDA pela família', () => {
        const v = vereditoDaFamilia(
            [{ modelo: 'gemini-flash-latest', modelVersion: 'gemini-3.7-flash', naFamiliaAlvo: true },
             { modelo: 'gemini-flash-latest', modelVersion: 'gemini-3.7-flash', naFamiliaAlvo: true }],
            false, // a listagem NÃO trouxe a família
        );
        expect(v.situacao).toBe('atendida');
        expect(v.cor).toBe('ok');
        expect(v.texto).toMatch(/Estamos na família 3\.7/);
        // E explica a aparente contradição em vez de escondê-la.
        expect(v.texto).toMatch(/quem responde é o resultado, não a listagem/);
    });

    it('atendida E listada: sem a ressalva, que aí não há o que explicar', () => {
        const v = vereditoDaFamilia([{ modelVersion: 'gemini-3.7-pro', naFamiliaAlvo: true }], true);
        expect(v.situacao).toBe('atendida');
        expect(v.texto).not.toMatch(/listagem/);
    });

    it('versão fora da família é ÂMBAR e diz quem respondeu', () => {
        const v = vereditoDaFamilia([{ modelVersion: 'gemini-2.5-flash', naFamiliaAlvo: false }], false);
        expect(v.situacao).toBe('fora');
        expect(v.texto).toMatch(/gemini-2\.5-flash/);
    });

    it('🚨 sonda que não respondeu NÃO vira "não estamos"', () => {
        // Rede que piscou não é veredito — mesma régua do versaoAtendeAlvo.
        const v = vereditoDaFamilia([{ modelVersion: null, naFamiliaAlvo: null }], false);
        expect(v.situacao).toBe('indeterminado');
        expect(v.cor).toBe('neutro');
    });

    it('metade dentro, metade fora ⇒ PARCIAL, não verde', () => {
        const v = vereditoDaFamilia([
            { modelo: 'a', modelVersion: 'gemini-3.7-pro', naFamiliaAlvo: true },
            { modelo: 'b', modelVersion: 'gemini-2.5-flash', naFamiliaAlvo: false },
        ], false);
        expect(v.situacao).toBe('parcial');
        expect(v.cor).toBe('atencao');
    });
});

describe('🚨 o roteador Pro×Flash vira ENFEITE quando os dois são iguais', () => {
    const { conferirRoteador } = require('../sefaz-backend/gemini-modelo.js');

    it('o caso REAL do print: GEMINI_MODEL_PRO apontando pro alias do FLASH', () => {
        // Com os dois iguais, anexo, prompt longo e parecer jurídico — o caso
        // mais analítico do app — caem no modelo barato, e nada dizia isso.
        const r = conferirRoteador({ pro: { modelo: 'gemini-flash-latest' }, flash: { modelo: 'gemini-flash-latest' } });
        expect(r.colidiu).toBe(true);
        expect(r.aviso).toMatch(/roteador Pro×Flash está sem efeito/);
        expect(r.aviso).toMatch(/parecer jurídico caem no modelo barato/);
        // E diz ONDE se corrige.
        expect(r.aviso).toMatch(/GEMINI_MODEL_PRO no Cloud Run/);
    });

    it('modelos diferentes não acusam nada', () => {
        expect(conferirRoteador({ pro: { modelo: 'gemini-pro-latest' }, flash: { modelo: 'gemini-flash-latest' } }).colidiu)
            .toBe(false);
    });

    it('sem modelo dos dois lados não inventa acusação', () => {
        expect(conferirRoteador({ pro: null, flash: null }).colidiu).toBe(false);
    });
});

describe('a rota e a tela levam o veredito da sonda', () => {
    const { readFileSync: rf } = require('fs');
    const { join: jn } = require('path');
    it('a rota devolve veredito + roteador, e separa a LISTAGEM do resultado', () => {
        const s = rf(jn(__dirname, '..', 'server.js'), 'utf8');
        expect(s).toMatch(/vereditoDaFamilia\(\[pro, flash\]/);
        expect(s).toMatch(/conferirRoteador\(/);
        expect(s).toMatch(/listadaNaConta/);
    });
    it('o painel lê o veredito, não a flag da listagem', () => {
        const s = rf(jn(__dirname, '..', 'components/ConfigAdminModal.tsx'), 'utf8');
        expect(s).toMatch(/geminiVersao\.veredito\?\.texto/);
        expect(s).toMatch(/geminiVersao\.roteador\?\.colidiu/);
        expect(s).not.toMatch(/geminiVersao\.alvoEncontrado/);
    });
});

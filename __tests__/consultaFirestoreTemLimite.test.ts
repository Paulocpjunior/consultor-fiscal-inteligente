/**
 * 🚨 CONSULTA SEM `limit` É NEGADA PELA REGRA — e a recusa vira lista VAZIA.
 *
 * ═══ O CASO (10/09, DISTRIBUIDORA DE BANANAS ELS) ═══════════════════════════
 *
 * Paulo, no modal 🔗 Correlação de CFOP → 🧠 Por fornecedor: *"quando eu informo
 * o CFOP não grava"*. Ele escolhia o POSTO BORDO, origem 5656, escrevia 1407,
 * clicava em **Criar parâmetro** — o campo LIMPAVA e a lista continuava dizendo
 * **"Parâmetros ativos (0)"**, sem erro nenhum na tela.
 *
 * O parâmetro ERA GRAVADO. Quem falhava era a LEITURA de volta:
 * `lerParametrosCfop` consultava `cfop_parametros` **sem `limit`**, e
 * `firestore.rules` libera o `list` daquela coleção só com
 * `request.query.limit <= 2000` — sem limite a regra responde *"Missing or
 * insufficient permissions"*, que o `catch { return [] }` transformava em
 * "esta empresa não tem parâmetro".
 *
 * ⚠️ O FATO JÁ ESTAVA ESCRITO NESTA CASA, EM DOIS COMENTÁRIOS, e nunca tinha
 * virado trava (o vício de 13/08 — *regra escrita não é regra travada*):
 *   · `services/giaStService.ts` — *"fbLimit(500) obrigatório: firestore.rules
 *     só permite list com request.query.limit <= 500 — sem limit a regra NEGA"*;
 *   · `services/firestorePaginate.ts` — *"se passar do cap a query INTEIRA é
 *     negada (permission-denied) e o caller engole no catch → tela vazia
 *     silenciosa (bug 'Empresas elegiveis (0)')"*.
 *
 * ⚠️ E A VARREDURA VALE MAIS QUE A CORREÇÃO: medindo o repo inteiro, os
 * violadores eram TRÊS — `cfop_parametros` (o caso do Paulo), `contadores` (o
 * catálogo aparecia vazio) e `retencao_parametros` (a sugestão de retenção
 * nunca aparecia, e ninguém tinha como saber que ela deveria). Corrigir só o
 * que o print mostrou fecharia a INSTÂNCIA e deixaria a CLASSE aberta.
 *
 * ═══ A ASSINATURA ══════════════════════════════════════════════════════════
 *
 * Ela resolve a CONSTRUÇÃO da consulta, não a linha do `getDocs`: o limite quase
 * sempre é passado onde a query é montada (`const q = query(..., fbLimit(500))`
 * ou `constraints.push(fbLimit(max))`), e olhar só a chamada acusaria 18 lugares
 * dos quais 15 estão CERTOS. Alarme sobre código certo é o jeito conhecido de a
 * equipe desligar a trava.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const RAIZ = resolve(__dirname, '..');

/**
 * Quem PODE consultar sem limite na própria linha: `fetchAllDocs` é o dono da
 * paginação e empurra `fbLimit(batchSize)` para dentro de `constraints` na
 * linha de cima. Exceção DECLARADA com o motivo, nunca assinatura afrouxada.
 */
const PERMITIDO: Record<string, string> = {
    'services/firestorePaginate.ts':
        'é o DONO da paginação — ele mesmo faz constraints.push(fbLimit(batchSize)).',
};

function arquivos(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git', 'coverage', '__tests__'].includes(nome)) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) arquivos(p, out);
        else if (/\.tsx?$/.test(nome) && !/\.d\.ts$/.test(nome)) out.push(p);
    }
    return out;
}

/** Recorta o argumento de uma chamada, contando parênteses. */
function trechoBalanceado(fonte: string, abre: number): string {
    let profundidade = 0;
    for (let i = abre; i < fonte.length; i++) {
        if (fonte[i] === '(') profundidade++;
        else if (fonte[i] === ')') {
            profundidade--;
            if (profundidade === 0) return fonte.slice(abre, i + 1);
        }
    }
    return fonte.slice(abre);
}

const TEM_LIMITE = /\b(fbLimit|limit)\s*\(/;

/** Onde a variável `nome` recebe uma `query(...)` — todas as atribuições. */
function janelasDaVariavel(fonte: string, nome: string): string[] {
    const out: string[] = [];
    const re = new RegExp(`\\b${nome}\\s*(?::[^=;]+)?=\\s*`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte))) {
        const depois = fonte.slice(m.index + m[0].length);
        // `x = cond ? query(...) : query(...)` também entra: pega até o `;`.
        const fim = depois.indexOf(';');
        out.push(fim === -1 ? depois.slice(0, 600) : depois.slice(0, fim));
    }
    return out;
}

/**
 * O trecho carrega o limite? Direto, ou pelo array que ele espalha.
 *
 * ⚠️ A resolução do spread precisa valer TAMBÉM depois de resolver a variável
 * (`const q = query(col, ...constraints)` com `constraints.push(fbLimit(lim))`
 * lá em cima). A 1ª versão só olhava o spread INLINE e acusou duas consultas
 * CERTAS do `nfseSpCapturadasService` — alarme sobre código certo é o jeito
 * conhecido de a equipe desligar a trava.
 */
function janelaTemLimite(fonte: string, trecho: string): boolean {
    if (TEM_LIMITE.test(trecho)) return true;
    for (const m of trecho.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) {
        const nome = m[1];
        if (new RegExp(`${nome}\\.push\\([^)]*(fbLimit|limit)\\s*\\(`).test(fonte)) return true;
        const declara = janelasDaVariavel(fonte, nome);
        if (declara.length && declara.every(j => TEM_LIMITE.test(j))) return true;
    }
    return false;
}

function consultasSemLimite(fonte: string): string[] {
    const achados: string[] = [];
    let i = 0;
    while ((i = fonte.indexOf('getDocs(', i)) !== -1) {
        const arg = trechoBalanceado(fonte, i + 'getDocs'.length);
        i += arg.length;
        if (TEM_LIMITE.test(arg)) continue;

        const miolo = arg.slice(1, -1).trim();

        // `getDocs(q)` — o limite mora onde `q` foi montado.
        if (/^[A-Za-z_$][\w$]*$/.test(miolo)) {
            const janelas = janelasDaVariavel(fonte, miolo);
            if (janelas.length && janelas.every(j => janelaTemLimite(fonte, j))) continue;
            achados.push(`getDocs(${miolo}) — a query de \`${miolo}\` é montada sem limit`);
            continue;
        }

        // `getDocs(query(col, ...constraints))` — o limite pode ser empurrado
        // no array antes da chamada.
        if (janelaTemLimite(fonte, miolo)) continue;

        achados.push(miolo.replace(/\s+/g, ' ').slice(0, 110));
    }
    return achados;
}

describe('toda consulta de lista carrega o `limit` que a regra exige', () => {
    const alvos = [...arquivos(join(RAIZ, 'services')), ...arquivos(join(RAIZ, 'components'))];

    it('a varredura tem o que ler (senão o verde não prova nada)', () => {
        expect(alvos.length).toBeGreaterThan(50);
        const comGetDocs = alvos.filter(f => readFileSync(f, 'utf8').includes('getDocs('));
        expect(comGetDocs.length).toBeGreaterThan(10);
    });

    it('nenhum `getDocs` sai sem limite — sem ele a regra NEGA e o catch vira lista vazia', () => {
        const violacoes: string[] = [];
        for (const f of alvos) {
            const rel = relative(RAIZ, f).replace(/\\/g, '/');
            if (PERMITIDO[rel]) continue;
            for (const a of consultasSemLimite(readFileSync(f, 'utf8'))) {
                violacoes.push(`${rel}: ${a}`);
            }
        }
        expect(violacoes).toEqual([]);
    });

    it('as coleções corrigidas em 10/09 leem com o teto da própria regra', () => {
        const cfop = readFileSync(join(RAIZ, 'services/cfopEscrituradoService.ts'), 'utf8');
        expect(cfop).toMatch(/LIMITE_LIST_PARAMETROS = 2000/);
        expect(cfop).toMatch(/fetchAllDocs\(/);
        const retencao = readFileSync(join(RAIZ, 'services/retencaoParametroService.ts'), 'utf8');
        expect(retencao).toMatch(/LIMITE_LIST = 2000/);
        const contadores = readFileSync(join(RAIZ, 'services/contadoresService.ts'), 'utf8');
        expect(contadores).toMatch(/batchSize: 500/);
    });

    it('cada teto casa com o que `firestore.rules` de fato permite', () => {
        // A régua é a FONTE, nunca a minha memória: o cap sai do arquivo de
        // rules que vai ao ar. Regra que muda sem o leitor mudar volta a negar.
        const rules = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');
        const capDe = (colecao: string): number => {
            const i = rules.indexOf(`match /${colecao}/{`);
            expect(i).toBeGreaterThan(-1);
            const bloco = rules.slice(i, i + 1200);
            const m = bloco.match(/allow list:[^;]*request\.query\.limit\s*<=\s*(\d+)/);
            expect(m).toBeTruthy();
            return Number(m![1]);
        };
        expect(capDe('cfop_parametros')).toBe(2000);
        expect(capDe('retencao_parametros')).toBe(2000);
        expect(capDe('contadores')).toBe(500);
    });

    it('a falha de LEITURA do cérebro não vira "não há parâmetro"', () => {
        // O `catch { return [] }` calado era metade do defeito: no painel a
        // pessoa lia "não gravou" e no `.FML` o arquivo saía pela régua
        // automática. O erro tem que atravessar até quem MOSTRA.
        const svc = readFileSync(join(RAIZ, 'services/cfopEscrituradoService.ts'), 'utf8');
        expect(svc).toMatch(/erro:\s*e\?\.message/);
        expect(svc).toMatch(/LeituraParametrosCfop/);

        const painel = readFileSync(join(RAIZ, 'components/CfopCerebroPainel.tsx'), 'utf8');
        expect(painel).toMatch(/setAvisoLeitura\(r\.erro\)/);
        expect(painel).toMatch(/avisoLeitura &&/);

        const sage = readFileSync(join(RAIZ, 'components/xml/XmlExportarIobSage.tsx'), 'utf8');
        expect(sage).toMatch(/avisoParametrosCfop\(leituraCerebro\.erro\)/);
        expect(sage).toMatch(/\{avisoCerebro\}/);
    });
});

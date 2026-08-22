// ============================================================================
// 🚨 CAMPO QUE O GERADOR LÊ E NINGUÉM PODE PREENCHER — a varredura existia
// como SCRIPT e nunca foi LIGADA
//
// O eixo nasceu em 17/08 com o `IND_NAT_PJ`: o gerador do EFD-Contribuições
// lia `dadosFiscais.indNatPJ`, e esse campo **não existia em tela nenhuma nem
// na whitelist do backend** — caía no `'00'` SEMPRE, que declara *"sociedade
// empresária em geral"*, inclusive na igreja do caso de 18/08. É a "rota sem
// botão" (13/08) na versão CAMPO.
//
// O cruzamento virou script naquele dia e achou mais três (`icmsCodRec`,
// `icmsDiaVencimento`, `regimeApuracaoPisCofins`) — mas **o script não ficou
// no repo**. O que sobrou foi um teste citando o `indNatPJ` **pelo NOME**, que
// é a "trava escrita como LISTA" (13/08): cobre o campo que alguém lembrou.
//
// 🔴 **E havia o oitavo esperando**: `dadosFiscais.gerarInventario`, lido pelo
// **Bloco H**. Sem ele na whitelist, `inventarioExigido` virava na prática
// *"só em dezembro"* — e a empresa que precisa apresentar o inventário em
// outro mês (mudança de regime, encerramento, exigência estadual) não tinha
// como fazer o bloco sair. **A ausência de um bloco é silenciosa**: o PVA só
// reclama do que ESTÁ no arquivo.
//
// 📌 REGRA QUE FICA: **trava escrita não é trava ligada**, e varredura por
// LISTA envelhece no primeiro campo novo — em silêncio.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const RAIZ = join(__dirname, '..');

/** A whitelist do backend — o que a rota do modal aceita gravar. */
function whitelist(): Set<string> {
    const src = readFileSync(join(RAIZ, 'sefaz-backend/empresa-status-routes.js'), 'utf8');
    const m = /CAMPOS_DADOS_FISCAIS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
    if (!m) throw new Error('CAMPOS_DADOS_FISCAIS não encontrada — a varredura ficaria vazia, e vazia ela passa sempre.');
    return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}

function arquivosJs(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) { arquivosJs(caminho, out); continue; }
        if (nome.endsWith('.js')) out.push(caminho);
    }
    return out;
}

/** `dadosFiscais.X` lido no backend (prosa fora — menção não é leitura). */
function camposLidos(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const arquivo of arquivosJs(join(RAIZ, 'sefaz-backend'))) {
        const codigo = readFileSync(arquivo, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // ⚠️ A assinatura NÃO aceita o `)` entre o objeto e o campo, e isso é
        // decisão: `resolverNaturezaAtividade(empresa?.dadosFiscais || {}).natureza`
        // lê o RESULTADO da função, não um campo do cadastro — a versão larga
        // acusava `natureza` como campo órfão, alarme sobre código certo. A
        // conta dos dois padrões é a mesma menos esse caso.
        for (const m of codigo.matchAll(/dadosFiscais\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) {
            const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
            const lista = out.get(m[1]) || [];
            if (!lista.includes(rel)) lista.push(rel);
            out.set(m[1], lista);
        }
    }
    return out;
}

/**
 * ⚠️ Exceção se declara COM o motivo, nunca apagando a assinatura. Todas aqui
 * são campos que o BACKEND escreve sozinho (carimbo) ou fallback de um campo
 * cuja casa real é outra — nenhuma delas é "campo que alguém deveria digitar".
 */
const FORA_DA_WHITELIST_COM_MOTIVO: Record<string, string> = {
    autoPreenchidoEm: 'carimbo do auto-preenchimento — quem escreve é o backend, não o modal',
    autoPreenchidoPor: 'carimbo do auto-preenchimento — quem escreve é o backend, não o modal',
    municipioAutoPreenchidoEm: 'carimbo do auto-preenchimento do município — escrito pelo backend',
    municipioAutoPreenchidoPor: 'carimbo do auto-preenchimento do município — escrito pelo backend',
    municipio: 'NOME do município, preenchido pelo backend a partir do codMunIBGE (que está na whitelist)',
    regimePadrao: 'fallback: a casa real é o campo TOP-LEVEL da empresa, gravado pelas telas do Lucro',
    motInv: 'fallback: o motivo do inventário vem por `dados.inventarioMotInv`, da aba própria do bloco H',
};

describe('🚨 campo que o backend LÊ tem onde ser preenchido', () => {
    it('a varredura enxerga a whitelist e os leitores (vazia, ela passa sempre)', () => {
        expect(whitelist().size).toBeGreaterThan(20);
        expect(camposLidos().size).toBeGreaterThan(10);
    });

    it('nenhum campo é lido sem estar na whitelist ou declarado COM o motivo', () => {
        const white = whitelist();
        const orfaos: string[] = [];
        for (const [campo, arquivos] of camposLidos()) {
            if (white.has(campo)) continue;
            if (FORA_DA_WHITELIST_COM_MOTIVO[campo]) continue;
            // `$` e afins: artefato de template literal, não é campo.
            if (!/^[a-z][A-Za-z0-9]*$/.test(campo)) continue;
            orfaos.push(`${campo}  (lido em ${arquivos.join(', ')})`);
        }
        if (orfaos.length) {
            throw new Error(
                '\n\n🚧 CAMPO LIDO PELO BACKEND SEM CAMINHO PARA SER PREENCHIDO\n\n'
                + orfaos.map((x) => `  · ${x}`).join('\n')
                + '\n\nFora da whitelist de `empresa-status-routes.js` o modal diz "salvo" e NADA\n'
                + 'persiste — então o gerador cai no default para sempre, calado. Foi assim que o\n'
                + 'IND_NAT_PJ declarou "sociedade empresária" para uma igreja, e que o Bloco H\n'
                + 'passou a sair só em dezembro.\n\n'
                + 'Ou o campo entra na whitelist E no modal (regra do #382, no MESMO PR), ou ele\n'
                + 'é declarado em FORA_DA_WHITELIST_COM_MOTIVO — com o motivo escrito.\n',
            );
        }
    });

    it('toda exceção declarada tem motivo escrito', () => {
        for (const [campo, motivo] of Object.entries(FORA_DA_WHITELIST_COM_MOTIVO)) {
            expect({ campo, ok: motivo.trim().length >= 20 }).toEqual({ campo, ok: true });
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A OUTRA METADE: estar na whitelist não basta — precisa de TELA. Whitelist
// sem campo no modal é a mesma "rota sem botão", um passo adiante.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 o campo do Bloco H ganhou os DOIS lados', () => {
    it('gerarInventario está na whitelist E no modal', () => {
        expect(whitelist().has('gerarInventario')).toBe(true);
        expect(readFileSync(join(RAIZ, 'components/EmpresaDadosFiscaisModal.tsx'), 'utf8'))
            .toContain("handleField('gerarInventario'");
    });

    // ⚠️ E ele não muda o que o app se RECUSA a fazer: o bloco continua saindo
    // vazio com aviso enquanto ninguém informar a contagem. Quantidade de
    // inventário não se estima — foi o Bloco H inteiro zerado de 06/08.
    it('a tela diz que o bloco sai VAZIO enquanto não houver contagem', () => {
        const src = readFileSync(join(RAIZ, 'components/EmpresaDadosFiscaisModal.tsx'), 'utf8');
        const bloco = src.slice(src.indexOf("handleField('gerarInventario'"));
        expect(bloco.slice(0, 1600)).toMatch(/vazio com aviso/);
    });
});

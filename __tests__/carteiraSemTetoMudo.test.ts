// ============================================================================
// 🚨 A CARTEIRA ERA CORTADA EM 500 VÍNCULOS — EM SILÊNCIO
//
// Paulo, 27/08, com o print: *"todas as empresas estavam com responsáveis, hoje
// fui ver tinha 21 sem. Quando coloco a atribuição, ele indica que já
// responsável, mas não sai desse STATUS"*.
//
// ═══ OS DOIS SINTOMAS ERAM O MESMO DEFEITO ══════════════════════════════════
//
// A leitura era `getDocs(query(collection(db,'carteiras'), fbLimit(500)))`. Com
// 420 empresas e principal + backup, a carteira passou de 500 vínculos — e os
// que ficaram fora da página não voltavam: a empresa aparecia como "Sem
// responsável".
//
// E é por isso que atribuir dizia "já atende": a conferência de duplicata
// consulta por `where(empresaId, colaboradorUid)`, e ESSA consulta acha o
// vínculo, porque não passa pela página cortada. O vínculo EXISTIA; quem não o
// via era a lista. Como o handler só recarregava quando o vínculo NÃO existia,
// a linha continuava "Sem responsável" — e a única saída que sobra para quem
// não vê efeito é repetir o clique (a família do "Já importado" sem estado,
// 14/08).
//
// ⚠️ A SEGUNDA CÓPIA ERA PIOR: o mesmo teto estava em `getCarteiraScope`, que
// decide QUAIS EMPRESAS O COLABORADOR ENXERGA na Central de XMLs. Ali o vínculo
// fora da página faz a empresa SUMIR da visão dele, parecendo falha de captura.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// ⚠️ O teste importa o NÚCLEO PURO: a casca puxa o `firebaseConfig`, que usa
// `import.meta.env` e não carrega no jest — régua em módulo que o teste não
// carrega é régua sem prova (a lição do E116 e do E250).
import { TETO_VINCULOS, avisoDeTruncamento } from '../services/carteiraVinculosNucleo';

const RAIZ = join(__dirname, '..');
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const DONO = 'services/carteiraVinculosNucleo.ts';
const LEITORES = ['services/carteiraService.ts', 'services/xmlFiscalService.ts'];

describe('🚨 ninguém lê a carteira com teto mudo', () => {
    it.each(LEITORES)('%s pergunta ao dono', (rel) => {
        // Os dois call sites levam parâmetro de tipo
        // (`lerTodosOsVinculos<VinculoCarteira>(`), então a assinatura casa o
        // nome, não o parêntese logo depois.
        expect(fonte(rel)).toMatch(/lerTodosOsVinculos\s*[<(]/);
    });

    // A assinatura é ESTREITA de propósito: `fbLimit` sozinho casa com dezenas
    // de consultas legítimas (uma tela que mostra 20 linhas DEVE limitar). O
    // que não pode é limitar a leitura da COLEÇÃO INTEIRA de vínculos.
    it.each(LEITORES)('%s não tem mais o corte de 500 na coleção', (rel) => {
        const src = fonte(rel);
        const corte = src.match(/collection\(\s*db\s*,\s*['"`]carteiras['"`]\s*\)[^)]*fbLimit\(/);
        expect({ rel, corte: corte?.[0] || null }).toEqual({ rel, corte: null });
        expect(src).not.toMatch(/COLLECTION\s*\)\s*,\s*fbLimit\(/);
    });

    // 🚨 O TETO NOVO NÃO É SILÊNCIO. Ele existe (leitura sem teto nenhum é um
    // laço infinito esperando um banco torto) — o que mudou é que ele AVISA.
    it('o teto novo é de outra ordem de grandeza, e ele fala', () => {
        expect(TETO_VINCULOS).toBeGreaterThanOrEqual(20000);
        expect(avisoDeTruncamento({ vinculos: [], truncado: true, total: TETO_VINCULOS }))
            .toMatch(/cortada/);
        // Alarme sobre lista completa é o que ensina a equipe a ignorar o aviso.
        expect(avisoDeTruncamento({ vinculos: [], truncado: false, total: 10 })).toBeNull();
        expect(avisoDeTruncamento(null)).toBeNull();
    });

    // E a frase diz a CONSEQUÊNCIA: sem isso, "lista cortada" não explica por
    // que uma empresa apareceu sem responsável — e a pessoa reatribui à toa.
    it('o aviso diz que reatribuir não resolve', () => {
        const t = avisoDeTruncamento({ vinculos: [], truncado: true, total: 1 }) || '';
        expect(t).toMatch(/Sem responsável/);
        expect(t).toMatch(/não corrige nada/);
    });
});

describe('🚨 atribuir recarrega SEMPRE — inclusive quando já existia', () => {
    const src = fonte('components/Carteira/index.tsx');

    // O `if (!r.jaExistia) await carregar()` partia de "já existia ⇒ a tela já
    // mostra", que é falso justamente quando a lista está desatualizada — o
    // caso real de 27/08.
    it('o `carregar()` não é condicionado ao jaExistia', () => {
        expect(src).not.toMatch(/if\s*\(\s*!r\.jaExistia\s*\)\s*await\s+carregar\(\)/);
        expect(src).toMatch(/await carregar\(\);/);
    });

    // A frase deixou de afirmar só "já atende": ela DIZ que a lista estava
    // desatualizada e foi recarregada, senão quem lê continua sem entender por
    // que o status não mudava.
    it('a frase do "já existia" explica o que aconteceu', () => {
        expect(src).toMatch(/já atendia/);
        expect(src).toMatch(/lista estava desatualizada e foi recarregada/);
    });
});

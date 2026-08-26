/**
 * Catálogo do banco (Sistema → Banco de dados, dev-only — Paulo 30/07):
 * toda coleção com dono; órfãs e sem-uso detectadas; delta de crescimento.
 */
// @ts-expect-error — modulo .js puro
import { CATALOGO_BANCO, catalogarColecoes, calcularDeltas } from '../sefaz-backend/catalogo-banco.js';

describe('catálogo do banco', () => {
    it('sem coleção duplicada e todo item com grupo + funcionalidade', () => {
        const nomes = CATALOGO_BANCO.map((c: any) => c.colecao);
        expect(new Set(nomes).size).toBe(nomes.length);
        for (const c of CATALOGO_BANCO) {
            expect(c.colecao).toMatch(/^[a-z0-9_]+$/);
            expect(c.grupo.length).toBeGreaterThan(2);
            expect(c.funcionalidade.length).toBeGreaterThan(5);
        }
    });

    it('cobre as coleções-núcleo do app', () => {
        const nomes = new Set(CATALOGO_BANCO.map((c: any) => c.colecao));
        for (const core of ['documentos_fiscais', 'sefaz_state', 'simples_empresas', 'lucro_empresas', 'users', 'impostos_enviados']) {
            expect(nomes.has(core)).toBe(true);
        }
    });

    it('catalogarColecoes separa: existentes, órfãs e catalogadas sem uso', () => {
        const reais = ['documentos_fiscais', 'users', 'colecao_misteriosa_x'];
        const r = catalogarColecoes(reais);
        expect(r.linhas.map((l: any) => l.colecao).sort()).toEqual(['documentos_fiscais', 'users']);
        expect(r.foraDoCatalogo).toEqual(['colecao_misteriosa_x']);
        expect(r.catalogadasSemUso).toContain('sefaz_state');
        expect(r.catalogadasSemUso).not.toContain('users');
    });

    it('calcularDeltas: diferença quando há snapshot; null quando coleção é nova', () => {
        const deltas = calcularDeltas({ a: 100, b: 50 }, { a: 130, b: 50, c: 7 });
        expect(deltas).toEqual({ a: 30, b: 0, c: null });
        expect(calcularDeltas(null, { a: 5 })).toEqual({ a: null });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 COLEÇÃO SEM DONO DECLARADO — a regra existia e só o painel denunciava
//
// A regra é de 31/07: *"toda feature nova que criar coleção adiciona a linha
// aqui no MESMO PR"*, e o painel Sistema→Banco acusa a órfã. Só que o painel
// acusa em TEMPO DE EXECUÇÃO e é dev-only — sete coleções viveram invisíveis
// (cursor e lock do CT-e, estado do ABRASF, as duas auditorias da DCTFWeb, a
// sonda do PGDAS e o log de bloqueio por horário).
//
// Coleção sem dono declarado é coleção que ninguém sabe explicar daqui a três
// meses. Esta varredura fecha a CLASSE: `.collection('x')` no backend sem linha
// no catálogo quebra a build.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 toda coleção do backend tem dono no catálogo', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { readdirSync, readFileSync, statSync } = require('fs');
    const { join } = require('path');
    const REPO = join(__dirname, '..');
    const RAIZ = join(REPO, 'sefaz-backend');
    // 🚨 O `server.js` da RAIZ também abre coleção (o histórico de envios de DAS
    // mora lá) e a 1ª versão desta varredura NÃO o lia — trava escrita como
    // lista só cobre o que EU LEMBREI (13/08). Ele entra pelo nome.

    /**
     * Nomes que aparecem em `.collection(...)` e NÃO são coleção de verdade —
     * exceção declarada COM o motivo, nunca afrouxando a varredura.
     */
    const NAO_E_COLECAO: Record<string, string> = {};

    function varrer(dir: string, out: string[] = []): string[] {
        for (const nome of readdirSync(dir)) {
            if (nome.startsWith('.') || nome === 'node_modules') continue;
            const p = join(dir, nome);
            if (statSync(p).isDirectory()) varrer(p, out);
            else if (nome.endsWith('.js') && !nome.endsWith('.d.ts')) out.push(p);
        }
        return out;
    }

    /** Fontes do frontend — coleção que só a tela usa também é coleção. */
    function varrerFront(dir: string, out: string[] = []): string[] {
        for (const nome of readdirSync(dir)) {
            if (nome.startsWith('.') || nome === 'node_modules') continue;
            const p = join(dir, nome);
            if (statSync(p).isDirectory()) varrerFront(p, out);
            else if (/\.(ts|tsx)$/.test(nome) && !nome.endsWith('.d.ts')) out.push(p);
        }
        return out;
    }

    /**
     * ⚠️ AS DUAS DIREÇÕES LEEM CÓDIGO, NUNCA PROSA — e este dono é único.
     *
     * A ida nasceu lendo o arquivo INTEIRO, comentário incluído, e por isso
     * acusava `lucro_fichas` como "coleção fora do catálogo": os dois
     * orquestradores do SPED têm um comentário citando
     * `db.collection('lucro_fichas')` justamente para DIZER que ela não
     * existe. A varredura mandava catalogar o fantasma que a outra varredura
     * mandava apagar — duas travas brigando sobre o mesmo fato.
     *
     * 🚨 E COMER COMENTÁRIO DE BLOCO COM `/\*[\s\S]*?\*\//` É PERIGOSO, medido:
     * um `/*` dentro de string faz o casamento atravessar o arquivo, e no
     * `server.js` ele engoliu **105 KB de 157** — levando junto a coleção
     * `das_envios_cliente`, que está lá em `.collection(...)`. Alarme falso que
     * aparece justamente quando está tudo certo é o jeito conhecido de a equipe
     * desligar a trava.
     *
     * Saem só: comentário de LINHA e as linhas de bloco que começam com `*` (o
     * estilo desta casa). Basta — a prosa que enganou as duas direções mora em
     * comentário de linha.
     */
    const semProsa = (s: string) => s.split('\n')
        .map((l) => (/^\s*\*/.test(l) ? '' : l.replace(/\/\/.*$/, '')))
        .join('\n');

    /**
     * As coleções que ESTE arquivo cita — usada pela IDA.
     *
     * Escrita uma vez de propósito: se a ida ("usada sem catálogo") e a volta
     * ("catalogada sem uso") discordassem sobre o que é *citar uma coleção*,
     * uma delas acusaria o que a outra aceita, no mesmo repo.
     */
    function colecoesCitadas(src: string): string[] {
        return [
            ...[...src.matchAll(/\.collection\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]),
            ...[...src.matchAll(/\.doc\(\s*['"]([a-z][A-Za-z0-9_]{4,})\/[^'"]+['"]/g)].map((m) => m[1]),
            ...[...src.matchAll(/(?:_DOC|_PATH)\s*=\s*['"]([a-z][A-Za-z0-9_]{4,})\/[^'"]+['"]/g)].map((m) => m[1]),
        ];
    }

    it('nenhuma coleção usada fica fora do catálogo', () => {
        const catalogadas = new Set(CATALOGO_BANCO.map((c: any) => c.colecao));
        const fora: string[] = [];
        for (const arq of [...varrer(RAIZ), join(REPO, 'server.js')]) {
            if (arq.endsWith('catalogo-banco.js')) continue;
            const src = semProsa(readFileSync(arq, 'utf8'));
            // Duas formas de citar a coleção: `.collection('x')` e o CAMINHO
            // `'x/doc'` — a segunda é como o cofre de e-mail guarda o estado
            // (`const STATE_DOC = 'sefaz_xml_email_state/estado'`), e ela
            // escapava da 1ª versão desta varredura.
            //
            // ⚠️ A 2ª forma é reconhecida por assinatura ESTREITA — `.doc('x/y')`
            // ou uma constante `*_DOC`/`*_PATH` — porque a versão larga acusava
            // `application/json` e prefixo de rota. Teste que grita sem motivo é
            // teste desligado.
            const citadas = colecoesCitadas(src);
            for (const nome of citadas) {
                if (catalogadas.has(nome) || NAO_E_COLECAO[nome]) continue;
                const rel = arq.replace(`${join(__dirname, '..')}/`, '');
                const linha = `${nome}  (${rel})`;
                if (!fora.includes(linha)) fora.push(linha);
            }
        }
        if (fora.length) {
            throw new Error(
                '\n\n🚧 COLEÇÃO FORA DO CATÁLOGO\n\n'
                + fora.map((x) => `  · ${x}`).join('\n')
                + '\n\nToda coleção precisa de dono declarado em `catalogo-banco.js` — é o "controle\n'
                + 'acirrado" do Paulo (30/07). Sem a linha, ninguém sabe explicar a coleção daqui a\n'
                + 'três meses, e o painel Sistema→Banco só acusa para quem o abre.\n\n'
                + 'Adicione a linha no MESMO PR que cria a coleção.\n',
            );
        }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 E A VOLTA: COLEÇÃO CATALOGADA QUE NINGUÉM ESCREVE É FANTASMA
    //
    // A varredura acima fechava UMA direção. A outra ficou aberta, e tinha um
    // fantasma esperando: **`lucro_fichas`**, que o catálogo declarava e que
    // NÃO EXISTE — a ficha do Lucro é EMBUTIDA no documento da empresa
    // (`fichaFinanceira[]`). Foi ela que deixou o saldo de IPI em 0,00 até
    // 19/08: a leitura consultava `db.collection('lucro_fichas')` e a query
    // voltava vazia SEMPRE, indistinguível de "não tem saldo".
    //
    // Corrigido o leitor, a linha do catálogo ficou — descrevendo uma coleção
    // que nunca existiu. É a MESMA família do `tipoTributacao` (26/08): campo
    // que só existe no lugar que o declara. E o painel Sistema→Banco já sabia
    // dizer "catalogada sem uso" — só que em tempo de EXECUÇÃO e só para quem
    // o abre, que é dev-only. Trava escrita não é trava ligada.
    //
    // ⚠️ E ELA LÊ CÓDIGO, NUNCA PROSA — medido: os dois orquestradores do SPED
    // têm comentários DIZENDO que `lucro_fichas` não existe, e a primeira
    // versão desta varredura contou o comentário como prova de que existe. É a
    // decisão que a varredura de régua única já tinha tomado (22/08).
    // ═══════════════════════════════════════════════════════════════════════
    it('nenhuma coleção catalogada é fantasma', () => {
        // ⚠️ A VOLTA NÃO USA `colecoesCitadas` — e isso foi MEDIDO, não
        // suposto. A ida EXTRAI o nome de um padrão (`.collection('x')`);
        // aqui eu já TENHO o nome e só preciso saber se ele aparece. Usar a
        // extração da ida acusou SEIS coleções que existem, porque metade do
        // backend nomeia a coleção por CONSTANTE — `const COL_MSGS =
        // 'cofre_email_mensagens'` e depois `.collection(COL_MSGS)`. Trava que
        // grita sobre código certo é trava que a equipe desliga.
        const fontes = [
            ...varrer(RAIZ), join(REPO, 'server.js'),
            ...varrerFront(join(REPO, 'components')), ...varrerFront(join(REPO, 'services')),
        ];
        const codigo = fontes
            .filter((f) => !f.endsWith('catalogo-banco.js'))
            .map((f) => semProsa(readFileSync(f, 'utf8')))
            .join('\n')
            // As rules também declaram a coleção — `match /x/{id}` é produção,
            // e é por lá que aparece a coleção que só o frontend usa.
            + '\n' + semProsa(readFileSync(join(REPO, 'firestore.rules'), 'utf8'));

        const fantasmas = CATALOGO_BANCO
            .map((c: any) => c.colecao)
            // Citada como STRING (`'x'`, `"x"`) ou como caminho nas rules (`/x/`).
            .filter((nome: string) => !new RegExp(`['"/]${nome}['"/]`).test(codigo));

        if (fantasmas.length) {
            throw new Error(
                '\n\n🚧 COLEÇÃO CATALOGADA QUE NINGUÉM ESCREVE\n\n'
                + fantasmas.map((x: string) => `  · ${x}`).join('\n')
                + '\n\nO catálogo declara estas coleções e NENHUM ponto do app as abre. Coleção\n'
                + 'fantasma faz o painel Sistema→Banco prometer um dado que não existe — e\n'
                + 'quem for procurá-lo conclui que o app está quebrado.\n\n'
                + 'Foi assim que `lucro_fichas` sobreviveu: a ficha do Lucro é EMBUTIDA no\n'
                + 'documento da empresa, e a consulta à coleção voltava vazia SEMPRE —\n'
                + 'indistinguível de "não tem saldo" (o IPI em 0,00 até 19/08).\n\n'
                + 'Ou a coleção passa a existir, ou a linha sai do catálogo.\n',
            );
        }
        expect(fantasmas).toEqual([]);
    });
});

// ============================================================================
// COLEÇÃO DE MOVIMENTO NÃO SE LÊ INTEIRA NO NAVEGADOR.
//
// Paulo, 14/08: *"não carregamos nenhuma informação do banco de dados até que o
// colaborador ative a empresa, ganhamos tempo e agilidade"*.
//
// O caso que originou: toda entrada no Painel Simples chamava `getAllNotas`, que
// é `fetchAllDocs('simples_notas', [])` — **todas as notas de TODAS as empresas
// da casa**. Quem ia mexer em UMA empresa pagava a espera de ~400. Depois que a
// carga virou por empresa, aquela função ficou órfã e foi REMOVIDA: função
// exportada que lê a coleção inteira, parada e sem dono, é a que a próxima
// pessoa acha primeiro quando precisa de notas — e o problema volta sem ninguém
// perceber que voltou.
//
// ═══ O QUE ESTA TRAVA SEPARA ════════════════════════════════════════════════
//
// **Cadastro** (empresas, usuários, carteira) é leve, muda devagar e é o que a
// BUSCA precisa para a pessoa escolher — ler inteiro é legítimo, e é o que faz
// o seletor funcionar sem servidor no meio.
//
// **Movimento** (notas, documentos fiscais, capturas, erros) cresce com o mês e
// com o cliente. Ler inteiro no navegador é pagar a carteira toda para usar uma
// empresa — e não existe tela que precise disso: toda leitura de movimento tem
// um recorte (empresa, competência, período).
//
// A trava é VARREDURA: percorre `services/` atrás de leitura SEM filtro nas
// coleções de movimento. Filtro é `where(...)`/`orderBy+limit` — o que a torna
// um recorte, não um despejo.
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');

/**
 * Coleções que crescem com o movimento. Coleção NOVA de movimento entra aqui no
 * MESMO PR que a cria — é a mesma regra dos `TOTAIS_VIGIADOS` da auditoria do
 * SPED e das `REGUAS_VIGIADAS`.
 */
const COLECOES_DE_MOVIMENTO = [
    'simples_notas',
    'documentos_fiscais',
    'xml_capturas',
    'xml_erros',
];

/**
 * Tira comentários antes de varrer.
 *
 * A primeira versão desta trava acusou os PRÓPRIOS comentários que citam a
 * chamada removida para explicar por que ela saiu — é a segunda vez no mesmo
 * dia que uma varredura minha mira na prosa em vez do código (a outra foi a do
 * "Já importado"). Teste que grita sem motivo é teste que alguém desliga, e
 * documentação que dispara alarme ensina a apagar documentação.
 */
function semComentarios(fonte: string): string {
    return fonte
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

function varrerServices(dir: string): string[] {
    const out: string[] = [];
    for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) out.push(...varrerServices(caminho));
        else if (nome.endsWith('.ts') && !nome.endsWith('.d.ts')) out.push(caminho);
    }
    return out;
}

interface Leitura {
    arquivo: string;
    colecao: string;
    trecho: string;
    temFiltro: boolean;
}

/** Toda chamada a `fetchAllDocs('<coleção>', ...)` dentro de services/. */
function leiturasDeMovimento(fonte: string, arquivo: string): Leitura[] {
    const achados: Leitura[] = [];
    for (const colecao of COLECOES_DE_MOVIMENTO) {
        const re = new RegExp(`fetchAllDocs\\(\\s*'${colecao}'`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(fonte)) !== null) {
            // A janela cobre os argumentos da chamada — é lá que o filtro mora.
            const trecho = fonte.slice(m.index, m.index + 400);
            const args = trecho.slice(0, trecho.indexOf(')') + 1);
            const janela = trecho.slice(0, 300);
            achados.push({
                arquivo: arquivo.replace(RAIZ + '/', ''),
                colecao,
                trecho: args,
                temFiltro: /where\s*\(|orderBy\s*\(|fbLimit\s*\(|limit\s*\(/.test(janela),
            });
        }
    }
    return achados;
}

const arquivos = varrerServices(join(RAIZ, 'services'));
const leituras = arquivos.flatMap((f) => leiturasDeMovimento(semComentarios(readFileSync(f, 'utf8')), f));

describe('a varredura enxerga o que deve enxergar', () => {
    it('acha as leituras de movimento que existem — senão não prova nada', () => {
        // Guarda da própria trava: uma varredura que não casa com nada passa em
        // silêncio para sempre e vira decoração.
        expect(leituras.length).toBeGreaterThan(0);
        expect(leituras.some((l) => l.colecao === 'simples_notas')).toBe(true);
    });
});

describe('coleção de MOVIMENTO só se lê com recorte', () => {
    it.each(leituras.map((l) => [`${l.arquivo} · ${l.colecao}`, l] as const))(
        '%s', (_nome, leitura) => {
            expect(leitura.temFiltro).toBe(true);
        });
});

describe('a função que lia TUDO não pode voltar', () => {
    const simples = readFileSync(join(RAIZ, 'services/simplesNacionalService.ts'), 'utf8');

    it('`getAllNotas` foi removida, e o arquivo diz por quê', () => {
        // Sem a explicação, daqui a três meses alguém a recria "porque faltava".
        expect(simples).not.toMatch(/export const getAllNotas/);
        expect(simples).toMatch(/getAllNotas` FOI REMOVIDA/);
    });

    it('o que ficou no lugar é por EMPRESA, e consulta filtrado', () => {
        expect(simples).toMatch(/export const getNotasDaEmpresa/);
        expect(simples).toMatch(/where\('empresaId', '==', id\)/);
    });
});

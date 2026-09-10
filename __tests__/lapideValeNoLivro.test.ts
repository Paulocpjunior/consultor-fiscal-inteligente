// ============================================================================
// 🚨 A LÁPIDE VALIA NA LISTAGEM E **NÃO** NO ARQUIVO FISCAL
//
// A retirada por lápide está no ar desde 03/09 (Paulo: *"lancei uma nota da
// J.P. PISSATO na empresa SILVIO FREIRE … como resolver?"*), e o mata-burro
// daquele dia diz que *"`_deleted` já é filtrado por toda a listagem"*.
// Verdade para a LISTAGEM — e FALSO para o SPED.
//
// Medido em 10/09, ao conferir o alcance da correção de número: os DOIS
// orquestradores liam `documentos_fiscais` sem olhar a lápide (o do
// EFD-Contribuições não olhava nem o `_merged_into`), e o crédito de PIS/COFINS
// também não. Ou seja: **a nota tirada do livro continuava saindo no arquivo
// entregue à Receita** — a "régua que só escreve" pela ponta do LIVRO.
//
// ⚠️ A TRIAGEM VEIO ANTES DA CORREÇÃO (a régua de 07/09): 20 arquivos consultam
// `documentos_fiscais` sem olhar a lápide, e **5 eram reais**. Os outros 15 são
// importadores (escrevem) ou perguntam sobre CAPTURA — e ali o documento
// retirado **ainda prova que a captura funcionou**, então filtrá-lo faria o
// cliente parecer descoberto por causa de uma correção de digitação.
//
// A trava é por VARREDURA, e a exceção se declara COM O MOTIVO: arquivo novo
// que consulte a coleção cai aqui e ALGUÉM decide de que lado ele está.
// ============================================================================
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const BACKEND = join(__dirname, '..', 'sefaz-backend');

/**
 * Quem pode consultar `documentos_fiscais` sem olhar a lápide — e por quê.
 * Sem o motivo escrito, a exceção envelhece dizendo que cobre algo que já não
 * existe (a lição das exceções órfãs do túnel de datas, 02/09).
 */
const SEM_LAPIDE_COM_MOTIVO: Record<string, string> = {
    // ── ESCREVEM: a lápide é do LEITOR, não de quem grava ──────────────────
    'xml-importer.js': 'importa/atualiza documento — e já trata a lápide travando reimportação (14/08)',
    'nfse-sp-importer.js': 'importador do WS legado do portal de SP — escreve',
    'nfse-sp-csv-importer.js': 'importador do CSV do portal de SP — escreve',
    'nfse-barueri-csv-importer.js': 'importador do CSV do portal de Barueri — escreve',
    'nfts-sp-importer.js': 'importador de NFTS — escreve',
    'sefaz-sp-nfce-orchestrator.js': 'captura de NFC-e — escreve',
    'sefaz-sp-nfce-routes.js': 'grava o cancelamento de NFC-e na chave — escreve',
    'cancelamento-gravacao.js': 'grava o cancelamento confirmado pela SEFAZ — escreve',
    'backfill-cst-itens.js': 'reprocessa o XML guardado para completar campos de item — não decide livro',

    // ── PERGUNTAM SOBRE CAPTURA: o documento retirado ainda PROVA que a
    //    captura funcionou, e escondê-lo faria o cliente parecer descoberto ──
    'cobertura-saida-routes.js': 'prova de cobertura da SAÍDA — a nota retirada continua provando a captura',
    'conferencia-chaves-routes.js': 'conferência por chaves (migração) — o documento existe e é isso que se confere',
    'prova-captura-routes.js': 'prova de captura contra a SEFAZ — pergunta se o documento CHEGOU',
    'manifesto-orchestrator.js': 'manifestação (Ciência) à SEFAZ — o documento existe lá, independentemente do nosso livro',
    'docs-sem-dono.js': 'documentos sem empresa — diagnóstico de captura',
    'diagnostico-docs-fiscais-routes.js': 'diagnóstico do acervo — ver o documento retirado é o ponto',
    'notificacoes-orchestrator.js': 'resumo diário de CAPTURA — a nota retirada foi capturada',
    'xml-download-routes.js': 'baixa o XML guardado — o arquivo existe',
    'cofre-sharepoint-arquivo.js': 'arquiva o XML no SharePoint — o arquivo existe',
};

const OLHA_A_LAPIDE = /docContaNoLivro|docRetiradoDoAcervo|_deleted|_merged_into/;
/**
 * 🐛 A 1ª VERSÃO DESTA TRAVA NÃO GRITOU QUANDO DEVIA — pega na prova por
 * reversão: trocando `filter(docContaNoLivro)` por `filter(() => true)` no
 * orquestrador ela continuava VERDE, porque o **import** do dono seguia lá e
 * ela lia a MENÇÃO do nome, não a CHAMADA. Trava que não grita quando devia é
 * pior que trava nenhuma: ela dá sensação de cobertura (a lição do
 * `dtsNaoPrometeFantasma`, 22/08). A linha de import sai antes da leitura.
 */
const semImports = (fonte: string): string => fonte
    .split('\n')
    .filter(l => !/^\s*(import|export)\s.*from\s/.test(l) && !/^\s{4}\w+,?\s*$/.test(l))
    .join('\n');

function arquivosQueConsultam(): string[] {
    return readdirSync(BACKEND)
        .filter(f => f.endsWith('.js'))
        .filter(f => readFileSync(join(BACKEND, f), 'utf8').includes("collection('documentos_fiscais')"));
}

describe('MATA-BURRO: a lápide vale no LIVRO, não só na listagem', () => {
    it('todo leitor de documentos_fiscais olha a lápide — ou declara por quê não', () => {
        const semTrava = arquivosQueConsultam().filter(f =>
            !OLHA_A_LAPIDE.test(semImports(readFileSync(join(BACKEND, f), 'utf8')))
            && !(f in SEM_LAPIDE_COM_MOTIVO));
        expect(semTrava).toEqual([]);
    });

    it('quem monta ARQUIVO FISCAL ou IMPOSTO passa pelo DONO, nunca por filtro à mão', () => {
        // 🚨 OPT-IN de propósito (a régua de 07/09): estes são os que a lápide
        // DECIDE. Filtro à mão espalhado foi justamente o que deixou o
        // EFD-Contribuições passar — alguém escreveu `_deleted` em 40 lugares e
        // esqueceu no arquivo que vai à Receita.
        const QUEM_DECIDE_LIVRO = [
            'sped-fiscal-orchestrator.js',      // EFD ICMS/IPI
            'sped-contrib-orchestrator.js',     // EFD-Contribuições
            'pis-cofins-credito-routes.js',     // crédito de PIS/COFINS
            'sped-fiscal-routes.js',            // conferência CFI × SPED
            'nfts-routes.js',                   // declaração de serviços tomados
        ];
        const semDono = QUEM_DECIDE_LIVRO.filter(f =>
            // A CHAMADA, nunca a menção: `filter(docContaNoLivro)` ou `docRetiradoDoAcervo(`.
            !/docContaNoLivro\s*\)|docContaNoLivro\s*\(|docRetiradoDoAcervo\s*\(/
                .test(semImports(readFileSync(join(BACKEND, f), 'utf8'))));
        expect(semDono).toEqual([]);
    });

    it('a varredura tem o que ler — glob quebrado passaria verde sem provar nada', () => {
        expect(arquivosQueConsultam().length).toBeGreaterThan(20);
    });

    it('toda exceção declarada ainda CONSULTA a coleção — exceção órfã mente', () => {
        const consultam = new Set(arquivosQueConsultam());
        const orfas = Object.keys(SEM_LAPIDE_COM_MOTIVO).filter(f => !consultam.has(f));
        expect(orfas).toEqual([]);
    });

    it('toda exceção diz o MOTIVO', () => {
        const semMotivo = Object.entries(SEM_LAPIDE_COM_MOTIVO)
            .filter(([, m]) => String(m).trim().length < 20)
            .map(([f]) => f);
        expect(semMotivo).toEqual([]);
    });
});

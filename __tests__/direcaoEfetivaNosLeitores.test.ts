/**
 * 🚨 A DIREÇÃO DE UM DOCUMENTO CAPTURADO SAI DA RÉGUA, NUNCA DO CAMPO GRAVADO.
 *
 * O campo `direcao` MENTE num caso que este escritório tem às dezenas por mês:
 * a **nota própria de entrada** (RICMS/SP art. 136 — compra de produtor rural,
 * importação). Ela é emitida PELA EMPRESA com `tpNF=0`, então o importer a
 * grava como `'saida'` e só o backfill do sync-cron a vira. Quem responde é
 * `direcaoEfetivaDoc`, que lê o `tpNF`.
 *
 * A classe já mordeu SEIS vezes (31/07 no Exportar SAGE, 22/08 no SPED das duas
 * famílias, no `.FML`, no preflight, nos relatórios e na Central de Documentos)
 * e em 22/08 ficou escrito que **restavam ~60 leituras cruas NÃO triadas**. Esta
 * varredura fecha a CLASSE: a lista de exceções é por ARQUIVO e cada uma carrega
 * o MOTIVO — arquivo novo que leia o campo cru quebra a build.
 *
 * ⚠️ NEM TODA LEITURA CRUA É DEFEITO, e é por isso que a lista existe em vez de
 * uma proibição seca: alarme sobre código certo é o jeito conhecido de a equipe
 * desligar a trava. São legítimos o DONO da régua, o ESCRITOR (quem decide a
 * direção na gravação), o campo DIGITADO pela pessoa, o FILTRO que ela escolhe,
 * a linha JÁ AGREGADA de relatório, o diagnóstico da própria forma crua e o
 * domínio de MENSAGEM (WhatsApp/Connect), que é outro assunto com o mesmo nome.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const RAIZ = resolve(__dirname, '..');
const PASTAS = ['sefaz-backend', 'services', 'components'];

/** Casa a leitura do campo `direcao` de um objeto: `x.direcao ===` / `!==`. */
const LEITURA_CRUA = /\.direcao\s*[!=]==/;

/**
 * Arquivos onde a leitura crua é LEGÍTIMA, cada um com o motivo.
 * Entrada nova aqui exige a razão escrita — exceção sem motivo envelhece
 * dizendo que cobre algo que já não existe (a lição do túnel de datas, 02/09).
 */
const PERMITIDO: Record<string, string> = {
    // ── O DONO da régua: é aqui que o `tpNF` é lido e a direção decidida.
    'sefaz-backend/xml-metadata-helper.js': 'dono de direcaoEfetivaDoc/ehNotaPropriaDeEntrada',
    'sefaz-backend/participante-doc-helper.js': 'dono de ladoDaContraparte/ehEmissaoPropriaDoc — o laço da nota própria vem na linha seguinte',

    // ── O ESCRITOR: ele DECIDE a direção na gravação; não há o que reler.
    'sefaz-backend/xml-importer.js': 'escritor — compara dono x dono no dedup da posse',
    'services/xmlParserService.ts': 'escritor — a direção é o que o import acabou de decidir',
    'sefaz-backend/nfse-barueri-csv-importer.js': 'escritor do CSV municipal; NFS-e não tem tpNF',

    // ── DIGITADO: a direção é o que a PESSOA escolheu no formulário.
    'services/notaDigitada.ts': 'lançamento manual — a direção é digitada, não capturada',

    // ── FILTRO/EXIBIÇÃO: a direção é a escolha de quem olha, ou já foi
    //    resolvida a montante e a linha só mostra E/S.
    'services/xmlDocumentosFilter.ts': 'filters.direcao é a escolha da pessoa',
    'services/nfseSpCapturadasService.ts': 'filtros.direcao é a escolha da pessoa; NFS-e não tem tpNF',
    'services/retencoesNfseAnalyzer.ts': 'linha já agregada, vocabulário próprio (Recebida/Emitida)',
    'components/Relatorios/index.tsx': 'linha já agregada pelo backend',
    'components/AnaliseRetencoesNfseSP.tsx': 'linha já agregada',
    'components/xml/XmlDocumentosList.tsx': 'exibição da linha já normalizada por getView',
    'components/xml/XmlNfseSpCsv.tsx': 'escolha da pessoa na importação',
    'components/xml/XmlExportarIobSage.tsx': 'exibição do recorte já filtrado',
    'components/xml/XmlDashboard.tsx': 'contagem de exibição',

    // ── JÁ TEM O LAÇO da nota própria na mesma expressão.
    'sefaz-backend/rotina-fiscal-routes.js': 'lê com `&& !propriaEntrada` na mesma linha',
    'sefaz-backend/dipam-routes.js': 'lê com `&& !propriaEntrada` na mesma linha',
    'sefaz-backend/dipam-store.js': 'lê com `|| tpNF === 0` na mesma linha',
    'sefaz-backend/dipam-produtor-rural.js': 'lê com `!n.notaPropria` na mesma linha',

    // ── DIAGNÓSTICO da própria forma crua: o campo É o objeto da medição.
    'sefaz-backend/health-consolidado-routes.js': 'conta documentos SEM direção gravada',
    'sefaz-backend/prova-captura.js': 'contagem de captura, não decide livro',

    // ── Exceção declarada em 22/08.
    'services/iobSageExportService.ts': 'procura uma nota com chave para derivar a UF — a própria entrada carrega a MESMA UF',
    'sefaz-backend/manifesto-orchestrator.js': 'manifestação é de nota de TERCEIRO; a própria entrada não se manifesta',

    // ── Domínio de MENSAGEM (WhatsApp/Connect): mesmo nome, outro assunto.
    'sefaz-backend/whatsapp-webhook-routes.js': 'direção de MENSAGEM',
    'sefaz-backend/whatsapp-relatorio.js': 'direção de MENSAGEM',
    'sefaz-backend/whatsapp-routes.js': 'direção de MENSAGEM',
    'sefaz-backend/whatsapp-chamadas.js': 'direção de MENSAGEM',
    'sefaz-backend/whatsapp-sharepoint-arquivo.js': 'direção de MENSAGEM',
    'services/notificacaoConnect.ts': 'direção de MENSAGEM',
    'components/SpConnect/index.tsx': 'direção de MENSAGEM',
};

function varrer(dir: string, acc: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        const full = join(dir, nome);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (nome === 'node_modules' || nome === '__tests__') continue;
            varrer(full, acc);
        } else if (/\.(js|ts|tsx)$/.test(nome) && !/\.d\.ts$/.test(nome)) {
            acc.push(full);
        }
    }
    return acc;
}

/** Tira comentário de LINHA: a varredura lê CÓDIGO, nunca a prosa que o explica. */
function semComentario(src: string): string {
    return src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

const arquivos = PASTAS.flatMap((p) => varrer(join(RAIZ, p)));

const acusados = new Map<string, number>();
for (const full of arquivos) {
    const rel = relative(RAIZ, full).replace(/\\/g, '/');
    const linhas = semComentario(readFileSync(full, 'utf-8')).split('\n');
    const n = linhas.filter((l) => LEITURA_CRUA.test(l)).length;
    if (n) acusados.set(rel, n);
}

describe('a direção de documento capturado sai da régua, nunca do campo gravado', () => {
    it('lê um número plausível de arquivos (guarda contra silêncio falso)', () => {
        // Glob quebrado passaria VERDE sem ler nada — a doença que esta casa
        // persegue desde 22/08, agora dentro da própria trava.
        expect(arquivos.length).toBeGreaterThan(300);
    });

    it('nenhum leitor NOVO decide direção pelo campo cru', () => {
        const novos = [...acusados.keys()].filter((f) => !PERMITIDO[f]);
        if (novos.length) {
            throw new Error(
                'Leitor NOVO decidindo direção pelo campo gravado:\n'
                + novos.map((f) => `  · ${f} (${acusados.get(f)}x)`).join('\n')
                + '\n\nO campo `direcao` MENTE na nota própria de entrada (art. 136):'
                + '\nela é emitida pela empresa com tpNF=0 e fica gravada como "saida".'
                + '\nQuem responde é `direcaoEfetivaDoc` do xml-metadata-helper.'
                + '\n\nSe a leitura for legítima (dono, escritor, campo digitado, filtro'
                + '\nda pessoa, linha já agregada, diagnóstico ou direção de MENSAGEM),'
                + '\ndeclare o arquivo em PERMITIDO COM O MOTIVO escrito.',
            );
        }
        expect(novos).toEqual([]);
    });

    it('toda exceção declarada AINDA casa a assinatura (exceção órfã não envelhece)', () => {
        const orfas = Object.keys(PERMITIDO).filter((f) => !acusados.has(f));
        if (orfas.length) {
            throw new Error(
                'Exceção declarada que já não casa a assinatura:\n'
                + orfas.map((f) => `  · ${f} — ${PERMITIDO[f]}`).join('\n')
                + '\n\nO arquivo parou de ler o campo cru (ou sumiu). Tire-o de'
                + '\nPERMITIDO: exceção órfã envelhece dizendo que cobre algo que'
                + '\njá não existe, e a próxima leitura crua entra por baixo dela.',
            );
        }
        expect(orfas).toEqual([]);
    });

    it('os cinco leitores corrigidos passaram a chamar a régua', () => {
        const alvos = [
            'sefaz-backend/rotina-fiscal.js',
            'sefaz-backend/iss-carteira.js',
            'sefaz-backend/reinf-retencoes-pj.js',
            'sefaz-backend/sped-selecao-documentos.js',
            'services/issSpApuracao.ts',
        ];
        for (const rel of alvos) {
            const src = semComentario(readFileSync(join(RAIZ, rel), 'utf-8'));
            // A CHAMADA, nunca a menção do nome: varredura que lê o import passa
            // verde com a régua desligada (a lição da lápide, 10/09).
            expect(src).toMatch(/direcaoEfetivaDoc\s*\(/);
            expect(acusados.has(rel)).toBe(false);
        }
    });
});

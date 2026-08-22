// ============================================================================
// 🚨 "CANCELADA" TINHA SEIS RÉGUAS — e o campo cru MENTE.
//
// Paulo, 17/08, fechando a MV LIDER 639 (07/2026): a aba 🚫 Canceladas/Faltantes
// dizia **"✓ numeração contínua · 0 cancelada(s)"** enquanto ele estava vendo
// notas canceladas em vermelho na outra tela. Fui conferir a régua e achei o
// que estava por baixo.
//
// O CANCELAMENTO CHEGA POR EVENTO (110111) — e nesse caminho o campo `status`
// do documento continua 'autorizado'. Por isso a régua da LEITURA existe desde
// 11/08 (`docCancelado`: status OU cStat legado 101/151 OU evento 110111 com
// 135/155). O caso que a criou foi ESTE MESMO CLIENTE, a MV LIDER 639.
//
// Só que ela tinha sido aplicada no CÁLCULO e não em todo o resto:
//
//   · NFeStatusCell            selo 🟢 Vigente numa nota cancelada
//   · XmlDocumentosList (PDF)  cancelada somada no "valor líquido"
//   · iobSageExportService     situação 0 no .FML ⇒ o SAGE escritura de volta
//   · rotina-fiscal            helper `cancelado` próprio
//   · sped-contrib-blocos      C/D/F pulavam por `status`; o BLOCO A não pulava
//                              nada ⇒ NFS-e cancelada DECLARADA à Receita
//
// A pior delas é a última: arquivo entregue declarando documento que não existe
// mais. E as seis passavam por teste verde, porque cada uma fazia exatamente o
// que o próprio teste mandava.
//
// REGRA QUE FICA: quem pergunta "esta nota está cancelada?" chama `docCancelado`.
// Ler `status === 'cancelado'` é a segunda cópia, e ela envelhece EM SILÊNCIO —
// só aparece quando o cancelamento vem por evento, que é o caminho normal.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { docCancelado } from '../sefaz-backend/xml-metadata-helper.js';

const RAIZ = join(__dirname, '..');
const PASTAS = ['components', 'services', 'sefaz-backend'];
const EXTENSOES = ['.ts', '.tsx', '.js'];

/**
 * Onde ler o campo cru é LEGÍTIMO, com o motivo escrito.
 * Exceção se declara aqui — nunca apagando a varredura.
 */
const PERMITIDO: Record<string, string> = {
    // É a régua. O campo cru é um dos três sinais que ela combina.
    'sefaz-backend/xml-metadata-helper.js': 'é o arquivo DONO da régua',
    // Grava o campo a partir do XML — escrita, não leitura de situação.
    'sefaz-backend/xml-importer.js': 'ESCREVE o status a partir do protocolo/evento',
    // Parcelamento tem status próprio ('inadimplente'/'cancelado') e nada tem a
    // ver com cancelamento de documento fiscal.
    'services/nfpProCloudPdf.ts': 'status de PARCELAMENTO, outro domínio',

    // ── TAREFA cancelada não é DOCUMENTO cancelado ──────────────────────────
    'components/Tarefas.tsx': 'status de TAREFA, outro domínio',
    'sefaz-backend/tarefas-orchestrator.js': 'status de TAREFA, outro domínio',
    'sefaz-backend/envio-imposto.js': 'status de TAREFA (baixa da obrigação), outro domínio',
    'sefaz-backend/prazos-municipais-routes.js': 'status de TAREFA, outro domínio',

    // ── NFS-e: o cancelamento vem NO PRÓPRIO STATUS, não por evento ─────────
    //
    // É esta a razão de o campo cru mentir na NF-e e não aqui: o cancelamento
    // da NF-e chega como EVENTO 110111 e o `status` fica 'autorizado'. A NFS-e
    // (ADN e portal) não tem esse caminho — quem informa o cancelamento é o
    // próprio documento. Ler o campo ali é ler a fonte, não uma segunda régua.
    'sefaz-backend/nfse-nacional-orchestrator.js': 'NFS-e: cancelamento vem no próprio status, não por evento',
    'components/NfseNacional/index.tsx': 'NFS-e: cancelamento vem no próprio status, não por evento',
    'services/danfseGenerator.ts': 'NFS-e: cancelamento vem no próprio status, não por evento',
};

/**
 * Exceções da varredura da LISTA de rótulos, com o motivo escrito.
 *
 * ⚠️ Nenhuma delas é "cansei de consertar": ou o rótulo é ESCRITO ali (a fonte
 * diz o cancelamento), ou o domínio é outro, ou a leitura é de DIAGNÓSTICO e
 * não entra em conta de imposto.
 */
const PERMITIDO_LISTA: Record<string, string> = {
    'sefaz-backend/xml-metadata-helper.js': 'é o arquivo DONO da régua',
    'sefaz-backend/xml-importer.js': 'ESCREVE o status a partir do protocolo/evento',
    'sefaz-backend/reconferir-cancelamento.js': 'ESCREVE a situação a partir da resposta da SEFAZ',
    'sefaz-backend/conferencia-chaves-routes.js': 'lê a resposta da SEFAZ, não o campo do documento',
    'sefaz-backend/nfse-sp-csv-parser.js': 'NFS-e: o cancelamento vem no próprio documento',
    'sefaz-backend/nfse-sp-csv-importer.js': 'NFS-e: idem, e aqui é ESCRITA',
    'sefaz-backend/dctfweb-insumos.js': 'NFS-e tomada: o campo não mente (não há evento)',
    'sefaz-backend/sped-bloco-e-st.js': 'honra o `situacao` DERIVADO, ao lado de docCancelado',
    'sefaz-backend/sped-difal-c197.js': 'idem — o docCancelado vem antes',
    'sefaz-backend/prova-captura.js': 'diagnóstico de captura, não entra em conta de imposto',
    'sefaz-backend/migracao-prontidao.js': 'diagnóstico da fila de migração',
    'sefaz-backend/rotina-fiscal-routes.js': 'contagem do painel, não é apuração',
    'sefaz-backend/manifesto-orchestrator.js': 'decide MANIFESTAÇÃO pelo status conhecido do documento',
    'sefaz-backend/iss-carteira.js': 'ISS: só NFS-e, e nela o cancelamento vem no próprio status',
    'services/issSpApuracao.ts': 'ISS: só NFS-e, e nela o cancelamento vem no próprio status',
    'sefaz-backend/reinf-retencoes-pj.js': 'NFS-e tomada (R-4020): o campo não mente',
    'sefaz-backend/reinf-servicos-tomados.js': 'NFS-e tomada (R-2010): o campo não mente',
    'sefaz-backend/fila-migracao-routes.js': 'diagnóstico da fila de migração',
    'services/sageReportService.ts': 'DECLARAÇÃO de tipo (union), não leitura de documento',
    'sefaz-backend/rotina-fiscal.js': 'status de TAREFA, outro domínio',
};

function varrer(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (nome === 'node_modules' || nome === 'dist' || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p, out);
        else if (EXTENSOES.some((e) => nome.endsWith(e))) out.push(p);
    }
    return out;
}

describe('🚨 a régua de "cancelada" mora num lugar só', () => {
    it('ninguém decide cancelamento pelo campo cru', () => {
        const infratores: string[] = [];
        for (const pasta of PASTAS) {
            for (const arquivo of varrer(join(RAIZ, pasta))) {
                const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
                if (PERMITIDO[rel]) continue;
                const linhas = readFileSync(arquivo, 'utf8').split('\n');
                linhas.forEach((linha, i) => {
                    // Comentário citando o defeito é documentação, não código.
                    const semComentario = linha.replace(/\/\/.*$/, '');
                    if (/status\s*===?\s*['"]cancelad[ao]['"]/.test(semComentario)) {
                        infratores.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 90)}`);
                    }
                });
            }
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 SEGUNDA RÉGUA DE CANCELAMENTO\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nUse a régua:\n'
                + "  import { docCancelado } from 'sefaz-backend/xml-metadata-helper.js'\n\n"
                + 'O campo `status` MENTE quando o cancelamento chega por EVENTO (110111), que é\n'
                + 'como ele chega: o campo fica "autorizado" e a nota já não existe. Foi assim que\n'
                + 'a MV LIDER 639 contou nota cancelada no faturamento (11/08) e que, em 17/08, a\n'
                + 'NFS-e cancelada ia DECLARADA no EFD-Contribuições.\n\n'
                + 'Se a leitura for legítima (outro domínio, ou escrita do campo), declare o\n'
                + 'arquivo em PERMITIDO COM o motivo — nunca apague a varredura.\n',
            );
        }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 A SEGUNDA FORMA DA MESMA CÓPIA — a que a varredura NÃO via (21/08)
    //
    // A varredura acima pega `status === 'cancelado'`. Metade das cópias não
    // se escreve assim: elas montam uma LISTA de rótulos
    // (['cancelado','cancelada','denegado','inutilizado']) e perguntam com
    // `.includes`/`Set.has`. É a MESMA régua duplicada, com outra roupa — e
    // ela estava viva em quatro lugares onde muda DINHEIRO: o FUNRURAL/DIPAM
    // (imposto sobre nota cancelada), o DIFAL de aquisição e a rota dele, e o
    // índice do CIAP (que decide quanto do crédito do imobilizado entra no mês).
    // ═══════════════════════════════════════════════════════════════════════
    it('nem pela LISTA de rótulos — a cópia com outra roupa', () => {
        const infratores: string[] = [];
        for (const pasta of PASTAS) {
            for (const arquivo of varrer(join(RAIZ, pasta))) {
                const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
                if (PERMITIDO[rel] || PERMITIDO_LISTA[rel]) continue;
                const linhas = readFileSync(arquivo, 'utf8').split('\n');
                linhas.forEach((linha, i) => {
                    const semComentario = linha.replace(/\/\/.*$/, '');
                    // A assinatura é LITERAL: 'cancelado' e 'denegado' na mesma
                    // lista. Régua parecida não conta (falso positivo em teste
                    // que bloqueia build vira teste desligado).
                    if (/'cancelad[ao]'/.test(semComentario) && /'denegad[ao]'/.test(semComentario)) {
                        infratores.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 90)}`);
                    }
                });
            }
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 SEGUNDA RÉGUA DE CANCELAMENTO (pela LISTA de rótulos)\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nA lista parece mais completa que `status === "cancelado"` e erra pelo MESMO\n'
                + 'motivo: nenhum desses rótulos aparece quando o cancelamento chega por EVENTO.\n'
                + "Use `docCancelado` — ela já trata denegado e inutilizado como 'não conta no livro'.\n"
                + 'Exceção legítima se declara em PERMITIDO_LISTA COM o motivo.\n',
            );
        }
    });

    it('e os leitores que importam a régua continuam importando', () => {
        const exigido = [
            'components/xml/NFeStatusCell.tsx',
            'components/xml/XmlDocumentosList.tsx',
            'services/iobSageExportService.ts',
            'sefaz-backend/rotina-fiscal.js',
            'sefaz-backend/sped-contrib-blocos.js',
            'services/relatoriosAgregacoes.ts',
        ];
        for (const rel of exigido) {
            const fonte = readFileSync(join(RAIZ, rel), 'utf8');
            expect({ rel, importa: /import \{[^}]*docCancelado/.test(fonte) })
                .toEqual({ rel, importa: true });
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O QUE A CÓPIA PELA LISTA CUSTAVA — imposto sobre nota que não existe mais
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 cancelada por EVENTO não gera imposto', () => {
    const canceladaPorEvento = {
        status: 'autorizado',
        eventos: [{ tpEvento: '110111', cStat: '135' }],
    };

    it('FUNRURAL/DIPAM: nota cancelada sai da conta (não é operação)', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { classificarNota } = require('../sefaz-backend/dipam-produtor-rural.js');
        const r = classificarNota({
            ...canceladaPorEvento,
            direcao: 'entrada',
            cnpjEmit: '12345678901', xNomeEmit: 'PRODUTOR RURAL',
            valorTotal: 10000,
            itens: [{ cfop: '1101', vProd: 10000, NCM: '08039000' }],
        });
        expect(r.funrural.aplica).toBe(false);
        expect(r.dipam.aplica).toBe(false);
    });

    it('DIFAL de aquisição: compra cancelada não gera imposto a pagar', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { montarDifalMensal } = require('../sefaz-backend/difal-aquisicao.js');
        const compra = (over: any = {}) => ({
            direcao: 'entrada', competencia: '2026-07',
            chave: '31260702235305000108550010000348531000385216',
            ufEmit: 'MG', cnpjEmit: '02235305000108',
            totais: { vNF: 1000 },
            itens: [{ cfop: '6556', vProd: 1000, vBC: 1000, vICMS: 120, aliqIcms: 12 }],
            ...over,
        });
        const empresa = { cnpj: '31947349000169', uf: 'SP' };
        const viva = montarDifalMensal({ docs: [compra({ status: 'autorizado' })], empresa });
        expect(viva.linhas.length).toBe(1);

        const cancelada = montarDifalMensal({
            docs: [compra(canceladaPorEvento)], empresa,
        });
        expect(cancelada.linhas).toEqual([]);
    });

    it('CIAP: saída cancelada não entra no índice (ele decide o crédito do mês)', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { classificarSaidasCiap } = require('../sefaz-backend/sped-bloco-g.js');
        const r = classificarSaidasCiap([
            { ...canceladaPorEvento, direcao: 'saida', valorTotal: 5000, valores: { icms: 900 } },
            { status: 'autorizado', direcao: 'saida', valorTotal: 1000, valores: { icms: 180 } },
        ]);
        expect(r.total).toBe(1000);
        expect(r.tributadasEExportacao).toBe(1000);
    });
});

describe('a régua responde o que o campo cru não responde', () => {
    it('cancelamento por EVENTO conta, mesmo com status autorizado', () => {
        const doc = {
            status: 'autorizado',
            eventos: [{ tpEvento: '110111', cStat: '135' }],
        };
        expect(doc.status === 'cancelado').toBe(false);   // o que as cópias viam
        expect(docCancelado(doc)).toBe(true);             // o que é verdade
    });

    it('cancelamento HOMOLOGADO FORA DE PRAZO (155) também', () => {
        expect(docCancelado({ status: 'autorizado', eventos: [{ tpEvento: '110111', cStat: '155' }] })).toBe(true);
    });

    it('evento de REJEIÇÃO não cancela — alarme falso é pior que silêncio', () => {
        expect(docCancelado({ status: 'autorizado', eventos: [{ tpEvento: '110111', cStat: '573' }] })).toBe(false);
    });

    it('CC-e não cancela', () => {
        expect(docCancelado({ status: 'autorizado', eventos: [{ tpEvento: '110110', cStat: '135' }] })).toBe(false);
    });

    it('nota vigente continua vigente', () => {
        expect(docCancelado({ status: 'autorizado', eventos: [] })).toBe(false);
    });
});

describe('🚨 o EFD-Contribuições não declara documento cancelado', () => {
    it('NFS-e cancelada por evento fica FORA do bloco A', () => {
        const { buildBlocoA } = require('../sefaz-backend/sped-contrib-blocos.js');
        const empresa = { cnpj: '20385150000100', nome: 'MV LIDER' };
        const viva = {
            tipo: 'NFSe', direcao: 'saida', numero: '1', dataEmissao: '2026-07-10',
            cnpjDest: '00621930000162', valorTotal: 1000, status: 'autorizado',
        };
        const cancelada = {
            ...viva, numero: '2', valorTotal: 9999,
            status: 'autorizado',                                   // o campo MENTE
            eventos: [{ tpEvento: '110111', cStat: '135' }],
        };
        const linhas: string[] = buildBlocoA({ empresa, notas: [viva, cancelada], regimeApuracao: '2' });
        const a100 = linhas.filter((l) => l.startsWith('|A100|'));
        expect(a100).toHaveLength(1);
        expect(a100[0]).toContain('1000,00');
        expect(linhas.join('\n')).not.toContain('9999,00');
    });

    it('e um bloco A que fica sem nota nenhuma se declara VAZIO, não cheio', () => {
        const { buildBlocoA } = require('../sefaz-backend/sped-contrib-blocos.js');
        const linhas: string[] = buildBlocoA({
            empresa: { cnpj: '20385150000100' },
            notas: [{ tipo: 'NFSe', direcao: 'saida', numero: '2', valorTotal: 10, status: 'cancelado' }],
            regimeApuracao: '2',
        });
        // IND_MOV=1 (sem dados). Declarar 0 com bloco vazio é o que a auditoria
        // de saída acusa como 'bloco-vazio-declarado-cheio'.
        expect(linhas[0].trim()).toBe('|A001|1|');
    });
});

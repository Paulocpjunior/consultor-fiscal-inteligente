// ============================================================================
// MATA-BURRO: RÉGUA FISCAL MORA NUM LUGAR SÓ.
//
// Paulo, 12/08/2026: *"a maioria das situações de hoje são brechas e buracos
// seus. Não dá p passar por isso mais"*. Ele estava certo, e o que ele pediu foi
// a trava — não a promessa: *"finalizou uma tarefa, deu certo, passa o laço,
// carimba com o mata-burro e vai"*.
//
// ═══ A CLASSE DE DEFEITO QUE ESTE TESTE MATA ════════════════════════════════
//
// Quase todo defeito achado em 12/08 tem a MESMA causa: uma SEGUNDA CÓPIA de
// uma regra que já existia. Não é falta de conhecimento — a regra estava
// escrita, às vezes por mim mesmo, às vezes no CLAUDE.md:
//
//   · R-2055 descartava produtor por contar dígitos, enquanto o 🌾 honrava o
//     cadastro (Com. CAT 45/2008 — regra que eu tinha documentado 7 dias antes);
//   · o modal de CFOP tinha uma "réplica simplificada da lógica do backend" e
//     exibia 1405, CFOP que não existe, enquanto o arquivo gravava 1403;
//   · `services/cfopConferencia.ts` tinha os sufixos copiados, e a cópia se
//     declarava "espelho" — espelho é a segunda cópia com outro nome;
//   · `FiscalObligationsDashboard.tsx` reescreveu as fronteiras de prazo, que
//     JÁ tinham sido unificadas em 07/08 por terem divergido antes;
//   · a versão do app irmão morava em quatro arquivos e o bump escrevia dois —
//     dois deploys caíram no mesmo dia.
//
// Régua copiada não fica igual: fica PARECIDA. E parecida é pior que diferente,
// porque ninguém desconfia.
//
// ═══ COMO ESTE TESTE FUNCIONA, E POR QUE ELE NÃO VIRA RUÍDO ═════════════════
//
// Ele varre APENAS código de produção (`components/`, `services/`,
// `sefaz-backend/`) procurando ASSINATURAS LITERAIS de cada régua fora do
// arquivo DONO. Três decisões deliberadas:
//
//  1. **Assinatura literal, não semântica.** Nada de "parece uma régua": só
//     acusa quem escreveu o mesmo array/mapa/fronteira. Falso positivo em teste
//     que bloqueia build vira teste desligado.
//  2. **Testes ficam FORA da varredura.** Reproduzir a régua num teste é
//     legítimo — foi assim que a divergência do CFOP foi provada em número
//     (`cfopCorrelacaoTelaXArquivo.test.ts` guarda a cópia antiga de propósito).
//  3. **A falha ENSINA.** A mensagem diz o dono, de onde importar e qual caso
//     real custou — mata-burro que não diz o caminho vira obstáculo.
//
// ═══ REGRA PERMANENTE ═══════════════════════════════════════════════════════
//
// Núcleo fiscal novo (tabela, fronteira, de-para, família de código) entra em
// REGUAS_VIGIADAS **no mesmo PR** que o cria. É a mesma regra dos
// TOTAIS_VIGIADOS da auditoria de saída do SPED.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const RAIZ = join(__dirname, '..');
const PASTAS_DE_PRODUCAO = ['components', 'services', 'sefaz-backend'];
const EXTENSOES = ['.ts', '.tsx', '.js'];

interface Regua {
    /** Como a régua se chama para quem lê a falha. */
    nome: string;
    /** O arquivo que É a régua. Único lugar onde a assinatura pode aparecer. */
    dono: string;
    /** Como importar — a falha precisa dizer o caminho, não só o problema. */
    comoUsar: string;
    /** O caso real que custou. Sem ele, a trava vira burocracia. */
    porque: string;
    /** Trechos literais que só existem em quem reimplementa a régua. */
    assinaturas: RegExp[];
    /** Arquivos que podem conter a assinatura por motivo declarado. */
    permitido?: string[];
}

const REGUAS_VIGIADAS: Regua[] = [
    {
        nome: 'O CÉREBRO do CFOP — parâmetro por fornecedor, com vigência',
        dono: 'sefaz-backend/cfop-cerebro.js',
        comoUsar: "import { parametroAplicavel, sugerirParametro } from 'sefaz-backend/cfop-cerebro.js'",
        porque: 'Paulo, 18/08: a decisão humana numa nota vira parâmetro para as próximas. A régua tem TRÊS '
            + 'partes que não podem divergir: a chave (fornecedor + CFOP de origem, o mais específico vence), '
            + 'a VIGÊNCIA (não retroage — mês já entregue não muda de CFOP sozinho) e a PRECEDÊNCIA (a decisão '
            + 'naquela NF vence o parâmetro). Uma segunda cópia faria a tela mostrar um CFOP e o SPED gravar '
            + 'outro — e num parâmetro o erro se multiplica por todas as notas do fornecedor.',
        assinaturas: [
            /function parametroAplicavel\s*\(/,
            /function sugerirParametro\s*\(/,
        ],
    },
    {
        nome: 'De quem é o documento — quando reatribuir é conserto e quando é roubo',
        dono: 'sefaz-backend/documento-posse.js',
        comoUsar: "import { decidirPosseDocumento, ehParteDoDocumento } from 'sefaz-backend/documento-posse.js'",
        porque: 'KROYA × GOLDLOG (Paulo, 17/08): a MESMA NF-e é saída de uma e entrada da outra, e as duas '
            + 'são clientes da casa. Como o id do documento é a CHAVE, uma chave só comporta um dono — e o '
            + 'importer, achando a chave com empresaId diferente, REATRIBUÍA. Com as duas capturando, a nota '
            + 'trocava de dona a cada rodada e o livro de quem perdeu ficava a menor EM SILÊNCIO. A régua '
            + 'existe em DOIS caminhos (o importer e a mensagem da importação manual): a segunda cópia faria '
            + 'a tela dizer "corrija na origem" enquanto o backend deixa passar.',
        // ⚠️ A SITUAÇÃO ('contraparte-legitima') NÃO é assinatura: todo CONSUMIDOR
        // legítimo compara com ela, e vigiar a string faria a trava acusar quem
        // está usando a régua direito. Assinatura é a IMPLEMENTAÇÃO — teste que
        // grita sem motivo é teste desligado.
        assinaturas: [
            /function decidirPosseDocumento\s*\(/,
            /function ehParteDoDocumento\s*\(/,
        ],
    },
    {
        nome: 'Quem atende cada fila do menu do bot (fila órfã)',
        dono: 'sefaz-backend/whatsapp-atendimento.js',
        comoUsar: "import { coberturaDasFilas } from 'sefaz-backend/whatsapp-atendimento.js'",
        porque: 'O bot MOVE a conversa para a fila que o cliente escolheu, e dali em diante quem enxerga '
            + 'é só quem atende aquela fila. Sem vínculo, o cliente é encaminhado para um lugar sem dono '
            + 'e fica esperando — e ele não tem como perceber. A pergunta aparece em pelo menos dois '
            + 'lugares (a chave do alcance e a tela de atendentes) e vai aparecer no relatório de '
            + 'atendimento; duas contagens divergindo fariam uma tela dizer que está tudo coberto '
            + 'enquanto a outra acusa fila vazia.',
        assinaturas: [
            /function coberturaDasFilas\s*\(/,
        ],
    },
    {
        nome: 'De quem é a mensagem que falhou (nossa × da outra plataforma)',
        dono: 'sefaz-backend/whatsapp-webhook.js',
        comoUsar: "import { saiuPorOutraPlataforma } from 'sefaz-backend/whatsapp-webhook.js'",
        porque: 'Print do Paulo em 17/08 (conversa da Agatha): a falha de mídia apareceu num balão que a '
            + 'própria tela rotulava "mensagem enviada por outra plataforma" — e a linha de baixo mandava '
            + 'o colaborador converter um PDF que ele nunca enviou. Eram DUAS réguas pro mesmo fato, e '
            + 'elas se contradiziam no MESMO balão: a tela decidia por conta própria (saída + sem '
            + 'conteúdo) e o backend não decidia nada. Enquanto os dois apps ficarem assinados na WABA, '
            + 'a Meta manda o status de TODA mensagem do número para todos — então esta pergunta aparece '
            + 'em toda tela que mostrar entrega, e a resposta tem que ser uma só.',
        assinaturas: [
            /function saiuPorOutraPlataforma\s*\(/,
            // A cópia que existia: "é saída, não tem texto e não tem mídia ⇒ é de outro app".
            /enviada por outra plataforma \(a Meta não compartilha o texto\)/,
        ],
        permitido: [
            // A TELA imprime a frase — ela é o texto que o usuário lê, e quem
            // DECIDE se ela aparece é o núcleo, importado logo acima.
            'components/SpConnect/index.tsx',
        ],
    },
    {
        nome: 'Débito já enviado ao cliente nesta competência (barra a cobrança em dobro)',
        dono: 'sefaz-backend/debito-ja-enviado.js',
        comoUsar: "import { conferirDebitosJaEnviados } from 'sefaz-backend/debito-ja-enviado.js'",
        porque: 'Paulo autorizou em 17/08 ("barrar o segundo envio do mesmo débito") depois do caso HYPE. '
            + 'O risco é ESTRUTURAL: receita previdenciária não tem guia avulsa, então o 1082 só sai no '
            + 'DARF unificado, que carrega PIS/COFINS de novo — em todo cliente com folha E faturamento '
            + 'existe um caminho de cobrança dobrada. A unidade é o DÉBITO, não a guia, e uma segunda '
            + 'cópia desta régua faria uma tela liberar o que a outra barra — com o erro aparecendo só '
            + 'na conta do cliente.',
        assinaturas: [
            /function conferirDebitosJaEnviados\s*\(/,
            /function canalProvaEnvio\s*\(/,
            /new Set\(\['email-graph', 'whatsapp-api'\]\)/,
        ],
    },
    {
        nome: 'De quem é cada débito do DARF da DCTFWeb (código de receita → departamento)',
        dono: 'sefaz-backend/darf-departamentos.js',
        comoUsar: "import { separarDarfPorDepartamento } from 'sefaz-backend/darf-departamentos.js'",
        porque: 'Paulo, 17/08 (HYPE CAFE 07/2026, "ERRO GRAVÍSSIMO"): ia enviar o DARF de PIS/COFINS ao '
            + 'cliente e, "por desencargo", abriu o PDF — dentro vinha o 1082 (CONTR PREV DESCONTA '
            + 'SEGURADO), que é do DP/Folha. Se o DP mandar a guia dele, o cliente paga o mesmo débito '
            + 'DUAS VEZES. A DCTFWeb é UMA declaração do CNPJ alimentada por TRÊS departamentos, então '
            + 'este de-para vale em toda tela que envia guia; uma segunda cópia divergindo faria uma '
            + 'tela liberar o que a outra barra, e o erro só aparece na conta do cliente.',
        assinaturas: [
            // Código de receita da DCTFWeb classificado fora do módulo dono.
            /1082\s*:\s*\{/,
            /function departamentoPelaDescricao\s*\(/,
            /function separarDarfPorDepartamento\s*\(/,
        ],
    },
    {
        nome: 'Direção do documento (o tpNF decide quando a empresa é a emitente)',
        dono: 'sefaz-backend/xml-metadata-helper.js',
        comoUsar: "import { decidirDirecaoPorTpNF } from 'sefaz-backend/xml-metadata-helper.js'",
        porque: 'A régua nasceu em 31/07 no xml-importer (caso EDUARDO GUERRA) e o import MANUAL do '
            + 'frontend ficou com uma SEGUNDA CÓPIA — `emit === empresa ⇒ saída`, sem olhar o tpNF. Em '
            + '14/08 isso derrubou a NOVA ERA: 12 notas próprias de ENTRADA (art. 136) gravadas como '
            + 'saída ⇒ a DIPAM/FUNRURAL não as via ⇒ a dedup não achava a nota que cobre a NF-e do '
            + 'produtor ⇒ o FUNRURAL contou a nota DELE. Paulo: "o CFI está levando a nota dele e não '
            + 'está considerando a da NOVA ERA".',
        assinaturas: [
            // Quem decide direção sem o tpNF está reimplementando a régua.
            /emit\s*===\s*emp\s*\)\s*return\s*\{\s*ok:\s*true,\s*direcao:\s*'saida'/,
            /function decidirDirecao\s*\(/,
        ],
    },
    {
        nome: 'Nota própria de ENTRADA (art. 136) — tpNF quando existe, CFOP quando não existe',
        dono: 'sefaz-backend/xml-metadata-helper.js',
        comoUsar: "import { ehNotaPropriaDeEntrada } from './xml-metadata-helper.js'",
        porque: 'A correção do tpNF (14/08) subiu verde nos deploys 488-490 e o número do Paulo NÃO '
            + 'MUDOU — "vamos ter que voltar … Não subiu". O campo só passou a ser gravado dali pra '
            + 'frente, e no Firestore where(tpNF,==,0) não devolve documento que não TEM o campo: o '
            + 'backfill passava ao largo justamente das notas quebradas. A segunda prova (nota emitida '
            + 'pela empresa com CFOP de ENTRADA) alcança o que já está gravado, e ela vem com TRÊS '
            + 'travas — campo presente vence, sem CFOP não decide, CFOP misto não decide. Cópia dessa '
            + 'leitura em outro painel volta a divergir em silêncio, que foi o defeito original.',
        assinaturas: [
            // Testar o primeiro dígito do CFOP para achar entrada é a régua.
            /\[\s*'1'\s*,\s*'2'\s*,\s*'3'\s*\]\s*\.includes\s*\(/,
            // O par "campo ausente ⇒ olha o CFOP" reescrito fora do dono.
            /tpNF\s*\?\?\s*''\s*\)\s*===\s*'0'[\s\S]{0,200}cfop/i,
        ],
    },
    {
        nome: 'Correlação de CFOP do emitente → destinatário',
        dono: 'sefaz-backend/cfop-correlacao.js',
        comoUsar: "import { correlacionarCfop } from '../sefaz-backend/cfop-correlacao.js'",
        porque: 'O CfopCorrelacaoModal tinha uma réplica e mostrava 1405 — CFOP que NÃO EXISTE — '
            + 'enquanto o arquivo gravava 1403 (PR #621). Conferência que promete número diferente '
            + 'do arquivo é pior que não ter tela.',
        assinaturas: [
            // O mapa de inversão do primeiro dígito.
            /['"]5['"]\s*:\s*['"]1['"]\s*,\s*['"]6['"]\s*:\s*['"]2['"]/,
            // A família de compra de produto.
            /['"]101['"]\s*,\s*['"]102['"]\s*,\s*['"]116['"]/,
            // A família de VENDA com ST (a que não tem par na entrada).
            /['"]401['"]\s*,\s*['"]402['"]\s*,\s*['"]403['"]\s*,\s*['"]404['"]/,
        ],
    },
    {
        nome: 'Fronteiras de urgência de vencimento',
        dono: 'sefaz-backend/urgencia-vencimento.js',
        comoUsar: "import { classificarUrgencia } from '../sefaz-backend/urgencia-vencimento.js'",
        porque: 'Elas já tinham divergido entre vencimentosLogic.ts e vencimentos-orchestrator.js '
            + '(a MESMA obrigação com duas datas, FGTS 05/2026: 19/06 na tarefa e 22/06 na tela) e '
            + 'voltaram a ser copiadas no FiscalObligationsDashboard.tsx.',
        assinaturas: [
            // A cadeia de cortes escrita à mão. Só acusa quando os DOIS cortes
            // aparecem no mesmo arquivo — `<= 7` sozinho é cor de UI.
            /<=\s*3\b[\s\S]{0,400}?<=\s*7\b/,
        ],
        permitido: [
            // Cores de contagem regressiva da Reforma — outro domínio, sem
            // relação com prazo de obrigação.
            'components/ReformaCountdownBanner.tsx',
            // NÃO é prazo: é a FAIXA DE CNAE do ISS de alguns municípios
            // (`0-3`, `4-7` decidem o dia do vencimento). Número igual, assunto
            // diferente — e é por isso que a assinatura é literal e a exceção é
            // escrita, em vez de a régua ser afrouxada.
            'sefaz-backend/calendario-obrigacoes.js',
            // É a régua PRÓPRIA de vencimento de CERTIFICADO A1, com dono
            // declarado (o CLAUDE.md manda não escrever "≤30 dias" à mão em
            // outro lugar). Dois domínios com fronteiras parecidas e vidas
            // independentes: prazo de obrigação muda por lei, validade de
            // certificado muda por emissão.
            'sefaz-backend/cert-vencimento-helper.js',
        ],
    },
    {
        nome: 'Alíquotas do FUNRURAL (vigência da LC 224/2025)',
        dono: 'sefaz-backend/dipam-produtor-rural.js',
        comoUsar: "import { aliquotasFunruralVigentes, calcularFunrural } from '../sefaz-backend/dipam-produtor-rural.js'",
        porque: 'A virada é pela DATA DA VENDA (1,5% até 31/03/2026 e 1,63% depois) e o segurado '
            + 'especial NÃO subiu. Uma segunda tabela cobraria 0,13 ponto a mais de quem não deve, '
            + 'e quem paga é o cliente adquirente (sub-rogação).',
        assinaturas: [
            /senar\s*:\s*0\.2\b/i,
            /gilrat\s*:\s*0\.11\b/i,
        ],
    },
    {
        nome: 'Catálogo de obrigações por regime',
        dono: 'sefaz-backend/catalogo-obrigacoes.js',
        comoUsar: "import { obrigacoesDoRegime } from '../sefaz-backend/catalogo-obrigacoes.js'",
        porque: 'Existiam TRÊS catálogos que não concordavam, e o mês nascia do mais pobre: o cron '
            + 'do dia 1 não conhecia LUCRO PRESUMIDO, então a obrigação não virava tarefa, não '
            + 'aparecia em Vencimentos e o farol dizia "mês fechado" com obrigação nunca listada.',
        assinaturas: [
            // O par que só existe em quem monta o catálogo do regime.
            /LUCRO_PRESUMIDO[\s\S]{0,200}?EFD[_-]?CONTRIBUICOES/i,
        ],
    },
    {
        nome: 'Dígito verificador de CPF/CNPJ',
        dono: 'sefaz-backend/documento-dv.js',
        comoUsar: "import { validarCpf, validarCnpj } from '../sefaz-backend/documento-dv.js'",
        porque: 'A régua vivia SÓ no frontend (services/validadorDocumento.ts), então o backend — '
            + 'que é quem grava no banco e monta o evento — conferia apenas o COMPRIMENTO. No '
            + '`cpfTitular` do produtor rural isso significa o R-2055 declarar a aquisição em nome '
            + 'de OUTRA PESSOA por um dígito trocado, e entrega ao Reinf não se desfaz.',
        assinaturas: [
            // Os pesos do módulo 11 escritos à mão. Só existem em quem
            // reimplementa o cálculo.
            /\[\s*10\s*,\s*9\s*,\s*8\s*,\s*7\s*,\s*6\s*,\s*5\s*,\s*4\s*,\s*3\s*,\s*2\s*\]/,
            /\[\s*5\s*,\s*4\s*,\s*3\s*,\s*2\s*,\s*9\s*,\s*8\s*,\s*7\s*,\s*6\s*,\s*5\s*,\s*4\s*,\s*3\s*,\s*2\s*\]/,
            // O corte do módulo 11 (resto < 2 ⇒ DV 0) junto de "resto".
            /resto\s*<\s*2\s*\?\s*0\s*:\s*11\s*-\s*resto/,
        ],
    },
    {
        nome: 'Códigos de receita do FUNRURAL (R-2055 / totalizador do R-2099)',
        dono: 'sefaz-backend/reinf-aquisicao-rural.js',
        comoUsar: "import { CODIGOS_RECEITA_FUNRURAL, conferirTotalizadorR2099 } from "
            + "'../sefaz-backend/reinf-aquisicao-rural.js'",
        porque: 'O de-para não veio de dedução: veio do RECIBO do R-2099 aceito (VINCENZO 07/2026, '
            + 'MS7001) — 1656-01 INSS, 1646-03 GILRAT, 1213-06 SENAR, batendo componente a componente '
            + 'com a apuração da aba 🌾. Uma segunda tabela mandaria a contribuição para o código de '
            + 'outro tributo, e o erro só apareceria na cobrança.',
        assinaturas: [
            /['"]1656-01['"]/,
            /['"]1646-03['"]/,
            /['"]1213-06['"]/,
        ],
    },
    {
        nome: 'De-para elemento do XML → código do evento da EFD-Reinf',
        dono: 'sefaz-backend/reinf-recibo-entrega.js',
        comoUsar: "import { codigoDoEvento } from '../sefaz-backend/reinf-recibo-entrega.js'",
        porque: 'O gateway guarda o ELEMENTO (evtAqProd); a pessoa, o e-CAC e o extrato do fechamento '
            + 'falam em CÓDIGO (R-2055). Uma segunda tabela faria o mesmo evento aparecer com dois '
            + 'nomes em telas diferentes, num papel que serve de PROVA DE ENTREGA — e nomear errado '
            + 'ali é pior que não nomear.',
        assinaturas: [
            /evtAqProd['"]?\s*:\s*['"]R-2055/,
            /evtServTom['"]?\s*:\s*['"]R-2010/,
            /evtRetPJ['"]?\s*:\s*['"]R-4020/,
        ],
    },
    {
        nome: 'Nome do arquivo da guia que vai ao cliente',
        dono: 'sefaz-backend/nome-arquivo-guia.js',
        comoUsar: "import { nomeArquivoGuia } from '../sefaz-backend/nome-arquivo-guia.js'",
        porque: 'O cliente lê este nome acima do ícone do PDF no WhatsApp, e saía '
            + '`das_63787066000193_2026-07.pdf` — nome de máquina, com o CNPJ na tela de quem recebe, '
            + 'num arquivo feito para ser reencaminhado. O formato estava escrito em três lugares e a '
            + 'correção só pegou um: DARF e DARE seguiram com o nome velho porque a trava era uma '
            + 'LISTA de arquivos escrita à mão.',
        assinaturas: [
            // O formato antigo: sigla + `_` + interpolação com CNPJ.
            /`(?:das|darf|dare)_\$\{[^`]*[Cc]npj/i,
        ],
        permitido: [
            // O DOWNLOAD do colaborador continua com o CNPJ DE PROPÓSITO: os
            // arquivos caem todos na mesma pasta de Downloads, de dezenas de
            // empresas, e "DAS 07-2026" repetido oito vezes é o que faz perder
            // o arquivo. Nome bonito é para quem RECEBE; nome que distingue é
            // para quem ARQUIVA — a régua separa leitores, não formatos.
            'components/Das/index.tsx',
            'components/DCTFWeb/DetalheDeclaracao.tsx',
            'components/DCTFWeb/TrimestraisDoMesPanel.tsx',
            // Idem no painel das cotas: o arquivo baixado ali é uma quota
            // ENTRE várias, de empresas diferentes, no mesmo mês — sem o CNPJ
            // e o número da cota no nome, três guias viram três arquivos
            // indistinguíveis na pasta.
            'components/DCTFWeb/QuotasDoMesPanel.tsx',
            // No DARE o download ainda carrega o sufixo `_TESTE` quando o PDF é
            // de HOMOLOGAÇÃO — guia de teste não é pagável, e o nome no disco é
            // a última barreira antes de alguém mandar uma ao cliente.
            'components/LucroPresumidoReal/DareSpModal.tsx',
        ],
    },
];

// ─── Varredura ──────────────────────────────────────────────────────────────

function arquivosDeProducao(): string[] {
    const out: string[] = [];
    const anda = (dir: string) => {
        for (const nome of readdirSync(dir)) {
            if (nome === 'node_modules' || nome.startsWith('.')) continue;
            const caminho = join(dir, nome);
            if (statSync(caminho).isDirectory()) { anda(caminho); continue; }
            // `.d.ts` é declaração de tipo — não carrega régua.
            if (nome.endsWith('.d.ts')) continue;
            if (EXTENSOES.some((e) => nome.endsWith(e))) out.push(caminho);
        }
    };
    for (const pasta of PASTAS_DE_PRODUCAO) anda(join(RAIZ, pasta));
    return out;
}

const ARQUIVOS = arquivosDeProducao();

describe('MATA-BURRO: régua fiscal mora num lugar só', () => {
    it('a varredura enxerga o código de produção (se ela vier vazia, a trava é falsa)', () => {
        // Trava da trava: um teste que não lê nada passa sempre, e passar
        // sempre é o mesmo que não existir.
        expect(ARQUIVOS.length).toBeGreaterThan(100);
        expect(ARQUIVOS.some((f) => f.endsWith('cfop-correlacao.js'))).toBe(true);
    });

    it.each(REGUAS_VIGIADAS.map((r) => [r.nome, r] as const))(
        'nenhuma segunda cópia de: %s',
        (_nome, regua) => {
            const donoResolvido = join(RAIZ, regua.dono);
            expect(ARQUIVOS).toContain(donoResolvido);

            const infratores: string[] = [];
            for (const arquivo of ARQUIVOS) {
                if (arquivo === donoResolvido) continue;
                const rel = relative(RAIZ, arquivo).split('\\').join('/');
                if (regua.permitido?.includes(rel)) continue;
                const conteudo = readFileSync(arquivo, 'utf8');
                for (const assinatura of regua.assinaturas) {
                    if (assinatura.test(conteudo)) {
                        infratores.push(`${rel}  (casou com ${assinatura})`);
                        break;
                    }
                }
            }

            if (infratores.length) {
                throw new Error(
                    `\n\n🚧 SEGUNDA CÓPIA DE RÉGUA FISCAL — "${regua.nome}"\n\n`
                    + `Estes arquivos reimplementam a régua que mora em ${regua.dono}:\n`
                    + infratores.map((i) => `  · ${i}`).join('\n')
                    + `\n\nUse a régua, não copie:\n  ${regua.comoUsar}\n\n`
                    + `POR QUE ISTO É TRAVA: ${regua.porque}\n\n`
                    + 'Régua copiada não fica igual, fica PARECIDA — e parecida é pior que diferente,\n'
                    + 'porque ninguém desconfia. Se a cópia for MESMO necessária (um teste que prova\n'
                    + 'divergência, outro domínio com o mesmo número por coincidência), declare o\n'
                    + 'arquivo em `permitido` COM o motivo escrito — nunca apague a assinatura.\n',
                );
            }
            expect(infratores).toEqual([]);
        },
    );

    it('toda régua vigiada diz o DONO, o COMO USAR e o CASO que a justifica', () => {
        // Entrada sem "porque" vira burocracia: daqui a seis meses ninguém sabe
        // o que a trava protege e alguém a afrouxa pra "destravar o build".
        for (const r of REGUAS_VIGIADAS) {
            expect(r.dono).toMatch(/\.(js|ts)$/);
            expect(r.comoUsar).toMatch(/import/);
            expect(r.porque.length).toBeGreaterThan(60);
            expect(r.assinaturas.length).toBeGreaterThan(0);
        }
    });
});

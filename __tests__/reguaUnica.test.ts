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
        nome: 'A DeRE — em qual regime ESPECÍFICO de IBS/CBS a empresa fornece',
        dono: 'sefaz-backend/dere-regimes.js',
        comoUsar: "import { REGIMES_ESPECIFICOS_IBS_CBS, decidirDereNoCadastro } from 'sefaz-backend/dere-regimes.js'",
        porque: '02/09, Paulo: *"crie uma nova função capaz de atender esta obrigação chamada DERE"*. A pergunta '
            + '"esta empresa está na DeRE?" tem TRÊS leitores desde o primeiro dia — o catálogo que monta o mês, a '
            + 'fila da carteira e o modal do cadastro — e o alcance da declaração só está confirmado para três '
            + 'regimes (serviços financeiros, planos de saúde, loterias). Uma segunda cópia do vocabulário faria a '
            + 'tela oferecer um regime que o mês não conhece, ou o mês cobrar quem a fila diz que está fora. E o '
            + 'manual (MOD 1.0.1) não foi lido nesta rede: quando alguém o ler, a coluna `dereConfirmada` muda num '
            + 'lugar só.',
        assinaturas: [
            // Os códigos do vocabulário escritos como literal fora do dono.
            /'SERVICOS_FINANCEIROS'/,
            /'CONCURSOS_PROGNOSTICOS'/,
            // A coluna que decide o alcance — reescrevê-la é reescrever a régua.
            /dereConfirmada\s*:/,
        ],
        permitido: [
            // O tipo é a DECLARAÇÃO do dono, não uma segunda cópia (regra do .d.ts).
            'sefaz-backend/dere-regimes.d.ts',
        ],
    },
    {
        nome: 'O CCM DE SP — duas formas, e os SÓ-ZEROS como vazio',
        dono: 'sefaz-backend/ccm-sp.js',
        comoUsar: "import { ccmSpDaEmpresa, temCcmSp, ccmSpParaGravar, soZerosComoVazio } from 'sefaz-backend/ccm-sp.js'",
        porque: '29/08, LAV COMERCIO DE AUTOPECAS: *"não está capturando as NFS-e de serviços tomados pelo '
            + 'cliente"* — a MESMA empresa do caso dos oito zeros de 21/08, voltando com outro sintoma. A régua '
            + 'nasceu no `.ts` do sanitize e FICOU LÁ, então o backend — que lê o CCM em nove lugares — não a '
            + 'conhecia. E `\'00000000\'` é **truthy**: o `if (!ccm)` de cada leitor recebia "sim, tem CCM" '
            + 'sobre um campo que significa "não tem". O 0000 dos DOIS SPED declarava `00000000` no campo '
            + 'Inscrição Municipal (afirmação falsa num arquivo fiscal); o portal de SP indexava a empresa sob '
            + 'a chave `00000000`, nunca casava com o dropdown de prestadores e a pulava **sem gerar uma linha '
            + 'de erro**; e a tela pintava `✓ NFSe SP` engolindo o bloqueio *"falta Inscrição Municipal (CCM)"*, '
            + 'que era justamente a frase que resolveria o caso.',
        assinaturas: [
            // A leitura crua das duas formas — como os nove leitores estavam.
            /ccmSp\s*\|\|\s*\w+\.ccmSp/,
            // A régua dos zeros reimplementada (o modal tinha a terceira cópia:
            // `.replace(/\D/g,'').replace(/0/g,'') !== ''`).
            /replace\(\/0\/g/,
        ],
        permitido: [
            // A gravação valida o TAMANHO do CCM (6-11 dígitos) além de aplicar
            // a régua dos zeros — é outra pergunta, e ela já delega o "é vazio?"
            // ao dono.
            'sefaz-backend/empresa-status-routes.js',
        ],
    },
    {
        nome: 'A COMPETÊNCIA ESTÁ FECHADA? — o fim de mês (DAR FIM DE MÊS)',
        dono: 'sefaz-backend/fim-de-mes.js',
        comoUsar: "import { competenciaFechada, podeDarFimDeMes } from 'sefaz-backend/fim-de-mes.js'",
        porque: '26/08, Paulo: *"o fechamento do fim do mês no CFI exige (DAR FIM DE MÊS); essa função é que '
            + 'deve ser usada como régua para nos nortear, usar como base p impostos, livros, ficha financeira, '
            + 'exatamente o que o CCI deve usar como base para importação do contábil"*. É uma pergunta que vai '
            + 'ter MUITOS leitores — livro, os dois SPED, a ficha, as guias e o túnel do Contábil —, e é '
            + 'justamente aí que a segunda cópia nasce. Duas respostas para "esta competência está fechada?" '
            + 'seriam o livro dizendo uma coisa e o arquivo outra, que é o defeito que esta casa mais paga. '
            + 'E `reaberta` é ABERTA: a cópia que esquecer disso travaria a correção que a reabertura veio '
            + 'permitir.',
        assinaturas: [
            // A reimplementação do estado, em vez de perguntar ao dono.
            /estado\s*===\s*'fechada'/,
            // A reimplementação da pré-condição (as 5 etapas da Rotina).
            /export function podeDarFimDeMes/,
        ],
        permitido: [
            // A porta do frontend EXIBE o estado que o backend respondeu — ela
            // não decide nada, e ler o campo para escolher qual bloco renderizar
            // é outra coisa que reimplementar a régua.
            'components/FimDeMesBloco.tsx',
            // A trava da ficha pergunta ao documento que o backend gravou; a
            // régua de QUEM pode fechar continua sendo do backend.
            'services/lucroPresumidoService.ts',
        ],
    },
    // ⚠️ `services/valorDigitado.ts` (o valor que a PESSOA digitou) NÃO entra
    // aqui, e o motivo é a régua desta casa: régua única é o dono da MESMA
    // pergunta, não o dono mais próximo. A assinatura da conversão pt-BR
    // (`replace(/\./g,'').replace(',','.')`) casa com 37 arquivos que fazem
    // OUTRA pergunta — converter texto de ARQUIVO (linha de SPED, CSV do
    // portal de NFS-e, PDF do e-Fiscal), onde a forma é fixa e conhecida.
    // Acusá-los faria a trava gritar sobre código certo, e trava que grita sem
    // motivo é trava desligada. Quem fecha aquela classe é
    // `valorDigitadoNaTela.test.ts`, que varre o defeito de verdade: campo de
    // TEXTO controlado por um NÚMERO.
    {
        nome: 'A NORMALIZAÇÃO da competência — quatro formas, uma resposta',
        dono: 'sefaz-backend/competencia.js',
        comoUsar: "import { normalizarCompetencia, formasDaCompetencia } from 'sefaz-backend/competencia.js'",
        porque: '22/08: existiam DUAS funções `normalizarCompetencia` e elas divergiam nos dois sentidos — a '
            + 'do `envio-imposto` aceitava "AAAAMM" e recusava "AAAA-MM-DD" (a forma da ficha), a do '
            + '`ipi-varredura` fazia o contrário. Cada uma devolvia null para a forma que a outra entendia, e '
            + 'null aqui não falha: some. O efeito mais caro estava na CONSULTA — a trava do débito repetido '
            + 'perguntava `where(competencia, ==, <texto cru>)` enquanto a gravação normaliza, então pedindo '
            + '"07/2026" ela achava ZERO envios anteriores e liberava a MESMA cobrança (caso HYPE, 17/08).',
        assinaturas: [
            // Outra implementação da mesma conversão MM/AAAA → AAAA-MM.
            /export function normalizarCompetencia/,
        ],
        permitido: [
            // `partesDaCompetencia`/`assertCompetencia` validam o formato que o
            // catálogo EXIGE e LANÇAM de propósito — outra pergunta, outro
            // contrato. Régua única é o dono da MESMA pergunta.
            'sefaz-backend/catalogo-obrigacoes.js',
        ],
    },
    {
        nome: 'O ISS do documento — QUATRO formas, uma resposta',
        dono: 'sefaz-backend/xml-metadata-helper.js',
        comoUsar: "import { issDoDocumento, issRetidoDoDocumento } from 'sefaz-backend/xml-metadata-helper.js'",
        porque: '22/08: a varredura mostrou que **só o import pelo NAVEGADOR** grava o objeto `valores{}` — o '
            + 'portal de SP (CSV e WS) grava `valorIss`/`issDevido` achatados, o ABRASF grava `totais.vISS` e '
            + 'o ADN grava `valorIss`. Três leitores perguntavam só por `valores.iss`: o relatório de '
            + '**ICMS/IPI/ISS destacados** somava ISS 0,00, as abas de Serviços e **Retenções** imprimiam a '
            + 'coluna zerada, e a tese de recuperação do ISS respondia "sem_oportunidade" sem ter lido nota '
            + 'nenhuma. E a sequência certa já existia — copiada em DOIS lugares (`iss-carteira.js` e '
            + '`issSpApuracao.ts`), que é como a régua começa a divergir.',
        assinaturas: [
            // A sequência das formas reimplementada: `valorIss` ou `issDevido`
            // ao lado de `valores.iss` / `totais.vISS`.
            /valorIss\b[^\n]*\bissDevido\b/,
            /issDevido\b[^\n]*\bvISS\b/,
        ],
        permitido: [
            // Os IMPORTADORES: eles ESCREVEM as formas (é deles que a régua
            // nasce). Ler o próprio parse não é reimplementar a leitura.
            'sefaz-backend/nfse-sp-csv-importer.js',
            'sefaz-backend/nfse-sp-importer.js',
            'sefaz-backend/nfse-nacional-dfe-importer.js',
            'services/notaDigitada.ts',
            'services/xmlParserService.ts',
            // Projeções `.select()`: elas LISTAM os campos que a régua precisa,
            // não decidem valor. Tirá-los da projeção é que cegaria a régua.
            'sefaz-backend/rotina-fiscal-routes.js',
            'sefaz-backend/nfse-sp-routes.js',
            // Parser do PDF do e-Fiscal: `valorIss` ali é COLUNA do relatório
            // impresso, não campo de documento gravado.
            'services/efiscalPdfParserService.ts',
        ],
    },
    {
        nome: 'A leitura da FICHA por competência — mesReferencia tem TRÊS formas',
        dono: 'sefaz-backend/ipi-varredura.js',
        comoUsar: "import { acharFichaCompetencia } from 'sefaz-backend/ipi-varredura.js'",
        porque: '21/08 (AFFITTARE 1139): o F550 saiu vazio porque a régua lia a ficha pela forma do INPUT do '
            + 'cálculo. Ao varrer os OUTROS leitores apareceu a segunda metade do mesmo defeito: quatro deles '
            + 'comparavam `f.mesReferencia === competencia` na MÃO — e `mesReferencia` aparece em "YYYY-MM", '
            + '"YYYY-MM-DD" e "MM/YYYY" conforme a época do lançamento. Igualdade estrita não devolve erro: '
            + 'devolve NADA, que é indistinguível de "a ficha não foi lançada" — o zero silencioso que já '
            + 'zerou M200/M600, o saldo credor do SPED Fiscal e a etapa de apuração da Rotina do Mês.',
        assinaturas: [
            // `.find(f => f.mesReferencia === X)` e variantes com String(...)
            /mesReferencia\s*(?:\|\|\s*'')?\s*\)?\s*===\s*(?!'\d)/,
        ],
        permitido: [
            // Dedup na GRAVAÇÃO da ficha: compara a competência do registro que
            // está sendo salvo com a dele mesmo (mesma origem, mesmo formato) —
            // é substituição de linha, não busca por competência de fora.
            'services/lucroPresumidoService.ts',
            // Merge de cadastros duplicados: compara ficha do vencedor × do
            // perdedor, os dois vindos do MESMO campo — não é leitura por
            // competência informada pelo usuário.
            'sefaz-backend/empresa-merge.js',
        ],
    },
    {
        nome: 'A cronologia do saldo credor — abertura do SPED ENTREGUE + transporte calculado',
        dono: 'sefaz-backend/saldo-abertura.js',
        comoUsar: "import { extrairAberturaDoSped, resolverSaldoAnterior, transportarIpi } from 'sefaz-backend/saldo-abertura.js'",
        porque: 'Paulo, 17/08: a apuração não considerava o saldo acumulado — o ICMS transportava DEFASADO '
            + '(a ficha guarda o que ENTROU no mês, não o que sobrou) e o IPI/ST saíam 0,00. A régua carrega o '
            + 'que uma cópia perderia: a fonte é o E110 c.14 / E520 c.7 do SPED ENTREGUE (nunca digitação), o '
            + 'E520 lê o campo 7 (o parser TS lia fields[4], que é o VL_OD — quase sempre 0,00), a cadeia usa a '
            + 'MESMA matemática do E110 (aplicarAjustesApuracao), não retroage, e elo faltando derruba NOMEADO '
            + 'em vez de virar zero calado.',
        assinaturas: [
            /function extrairAberturaDoSped\s*\(/,
            /function resolverSaldoAnterior\s*\(/,
            /function transportarIpi\s*\(/,
        ],
    },
    {
        nome: 'A receita que NÃO tem documento (aluguel) — o F550 e o IND_REG_CUM do 0110',
        dono: 'sefaz-backend/receita-sem-documento-f550.js',
        comoUsar: "import { receitaDeLocacao, montarF550, indRegCumDoArquivo } from 'sefaz-backend/receita-sem-documento-f550.js'",
        porque: 'Paulo, 20/08 (AFFITTARE 1139): *"o faturamento dela é aluguel, então não tem captura de '
            + 'notas… a informação vai no bloco F550"*. O CFI monta o EFD-Contribuições a partir dos '
            + 'DOCUMENTOS, e numa administradora de imóveis não existe documento de receita — o arquivo saiu '
            + 'com M200/M600 ZERADOS numa empresa que fatura ~R$ 21 mil/mês, declarando à Receita que não há '
            + 'contribuição a pagar. A régua carrega três coisas que uma segunda cópia perderia: só a '
            + 'LOCAÇÃO entra (as outras receitas têm documento e entrariam em DOBRO), o IND_REG_CUM do 0110 '
            + 'DERIVA do que foi gerado (2 consolidada com F550, 9 detalhada sem) e o centavo sai da '
            + 'coerência interna, não do arquivo do e-Fiscal — que se desmente entre o F550 e o M200 dele.',
        assinaturas: [
            /function receitaDeLocacao\s*\(/,
            /function montarF550\s*\(/,
            /function indRegCumDoArquivo\s*\(/,
        ],
    },
    {
        nome: 'O contabilista do registro 0100 (os dois SPEDs falam pelo mesmo)',
        dono: 'sefaz-backend/contador-escrituracao.js',
        comoUsar: "import { getContadorPadrao } from 'sefaz-backend/contador-escrituracao.js'",
        porque: 'O PVA recusou o EFD ICMS/IPI da PWR em 19/08 com "Campo obrigatório · 13 - EMAIL" e '
            + '"14 - COD_MUN". Corrigi no orquestrador do Fiscal — e o do EFD-Contribuições tinha a SEGUNDA '
            + 'CÓPIA da mesma função, que ficou sem o e-mail padrão e sem o campo codMunIBGE sequer existir. '
            + 'O arquivo da PWR de 20/08 saiu com |0100|nome|cpf|crc||||||||| — tudo depois do CRC vazio, ou '
            + 'seja a MESMA recusa esperando no arquivo seguinte. Nenhum teste pegava: cada orquestrador fazia '
            + 'exatamente o que o próprio código dizia. E dois arquivos do mesmo mês declarando contabilistas '
            + 'diferentes é divergência que ninguém vai procurar.',
        assinaturas: [/function getContadorPadrao\s*\(/],
    },
    {
        nome: 'A base do PIS/COFINS — desconto incondicional fora da receita e ICMS fora da base (Tema 69)',
        dono: 'sefaz-backend/base-pis-cofins.js',
        comoUsar: "import { receitaDoItem, baseDoItem, receitaEBaseDoDocumento } from 'sefaz-backend/base-pis-cofins.js'",
        porque: 'Paulo, 20/08 (PWR 07/2026): *"não deduziu o ICMS da base do PIS/COFINS e também não considerou '
            + 'o desconto no valor total da nota"*. O M210 declarava base 38.316,84 — a soma crua dos vProd. As '
            + 'duas deduções faltavam no MESMO campo e as duas na direção mais cara: o SPED declarava mais '
            + 'contribuição que a guia paga. A régua é lida pelo C170 e pelo bloco M; uma segunda cópia faria o '
            + 'detalhe e a apuração do mesmo mês discordarem. E ela guarda o que uma cópia perderia: receita e '
            + 'base são campos DIFERENTES do M210 (VL_REC_BRT × VL_BC_CONT), na entrada a exclusão NÃO se aplica '
            + 'por analogia, e documento sem itens (NFS-e) tem receita = base porque serviço não destaca ICMS.',
        assinaturas: [
            /function receitaDoItem\s*\(/,
            /function baseDoItem\s*\(/,
            /function receitaEBaseDoDocumento\s*\(/,
        ],
    },
    {
        nome: 'O VALOR DA OPERAÇÃO do C190 (VL_OPR) — que NÃO é a soma dos vProd/VL_ITEM',
        dono: 'sefaz-backend/valor-operacao-c190.js',
        comoUsar: "import { valorOperacaoDoItem, pisoDoValorOperacaoDoC170, acessoriasDoC100, faixaDoValorOperacao } "
            + "from 'sefaz-backend/valor-operacao-c190.js'",
        porque: 'Paulo, 20/08 (PWR 07/2026): o Livro de Entradas somava 71.960,81 e o relatório do PVA sobre o '
            + 'arquivo recém-gerado somava 69.760,36 — a diferença era exatamente o IPI. O Guia Prático 3.2.3 '
            + '(C190, campo 05) é literal: o VL_OPR inclui frete, seguro, outras despesas, ICMS-ST, FCP-ST e o '
            + 'IPI destacado, menos o desconto incondicional. A regra estava em TRÊS lugares e os três '
            + 'discordavam do manual: o gerador somava vProd, o validador R8 exigia Σ VL_ITEM e o autofix '
            + 'REESCREVIA o campo com essa soma — ou seja, consertar só o gerador faria o editor acusar o '
            + 'arquivo certo e o autofix desfazer a correção. E o PVA não recusa por isso: só imprime um total '
            + 'menor, que é o jeito silencioso de o livro sair a menor.',
        assinaturas: [
            /function valorOperacaoDoItem\s*\(/,
            /function pisoDoValorOperacaoDoC170\s*\(/,
            /function faixaDoValorOperacao\s*\(/,
        ],
    },
    {
        nome: 'QUAL documento entra em QUAL bloco do SPED (o modelo pela régua, não pelo campo)',
        dono: 'sefaz-backend/sped-selecao-documentos.js',
        comoUsar: "import { ehNotaDeMercadoria, selecionarNotasBlocoC, selecionarCtesBlocoD } from 'sefaz-backend/sped-selecao-documentos.js'",
        porque: 'Paulo, 19/08 (PRONTO SOCORRO 0896): 131 notas no recorte e DOIS CFOPs no SPED. Os filtros liam '
            + 'o campo cru `n.modelo`, que o importer principal NUNCA gravou — o modelo mora na chave. Ficavam '
            + 'fora o bloco C, o bloco D, o C do EFD-Contribuições e a SOMA do E110/E520, ou seja a apuração '
            + 'inteira. A régua carrega duas travas que uma segunda cópia perderia: o tipo é julgado ANTES do '
            + 'modelo (o fallback do modeloDoDoc é 55, e uma NFS-e entraria como NF-e) e o resumo/sem-itens sai '
            + 'NOMEADO em vez de sumir (C100 sem C190 o PVA recusa).',
        assinaturas: [
            /function ehNotaDeMercadoria\s*\(/,
            /function selecionarNotasBlocoC\s*\(/,
            /function ehConhecimentoDeTransporte\s*\(/,
        ],
    },
    {
        nome: 'A releitura das notas VAZIAS — quando o XML guardado resolve e quando não',
        dono: 'sefaz-backend/releitura-notas-vazias.js',
        comoUsar: "import { classificarParaReleitura, patchDaReleitura, numeroDaChave } from 'sefaz-backend/releitura-notas-vazias.js'",
        porque: 'Paulo, 19/08 (PWR/GLOBAL COMPANY): nota sem nº/CFOP/CST na tela e o colaborador digitando no '
            + 'escuro. A régua separa CAUSAS com ações opostas — resumo gravado (reler não cria item; importe o '
            + 'XML completo) × XML completo guardado (a releitura resolve) × sem arquivo (buraco de captura). '
            + 'Uma segunda cópia dessa classificação faria o botão responder uma coisa e a gravação fazer outra. '
            + 'E o nº sai da CHAVE (posições 26-34) — segunda cópia desse recorte é o 1405 de outro jeito.',
        assinaturas: [
            /function classificarParaReleitura\s*\(/,
            /function numeroDaChave\s*\(/,
            /function patchDaReleitura\s*\(/,
        ],
    },
    {
        nome: 'As retenções federais nas DUAS formas de gravação (achatada × objeto)',
        dono: 'sefaz-backend/reinf-retencoes-pj.js',
        comoUsar: "import { lerRetencoesFederaisDoDoc } from 'sefaz-backend/reinf-retencoes-pj.js'",
        porque: 'CLUDE, 19/08: o CSV do portal grava valorIr/valorInss/valorCsll na RAIZ e o Relatório de '
            + 'Retenções só lia valores.* — 67 notas com IR/INSS gravados imprimiam "?". É a armadilha das duas '
            + 'formas, que já mordeu 8 vezes. Quem lê as duas é o DONO (o mesmo que alimenta o R-4020); uma '
            + 'segunda leitura divergiria — e o campo de CSLL só sai como csllOuTotal, porque no export do '
            + 'portal ele é o TOTAL das três contribuições (caso CLINIPAR).',
        assinaturas: [
            /function lerRetencoesFederaisDoDoc\s*\(/,
        ],
    },
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
        nome: 'O CST que a escrituração usa quando o CFOP foi reclassificado',
        dono: 'sefaz-backend/cst-correlacao.js',
        comoUsar: "import { cstDoLancamento } from 'sefaz-backend/cst-correlacao.js'",
        porque: 'Paulo, 18/08: "a nota vai vir 5102, vamos registrar como 1556; aí que está a chave do SPED: '
            + 'o CST do fornecedor vai vir como 00, temos que indicar 90 para essas operações". A régua vive '
            + 'em DOIS registros do mesmo item (C170 e C190) — se divergirem, o detalhe e o consolidado do '
            + 'MESMO item contam histórias diferentes, e é o C190 que a apuração soma. E ela guarda a '
            + 'armadilha que o CFOP não tem: o CST leva a ORIGEM da mercadoria no 1º dígito, então converter '
            + 'para "090" às cegas afirmaria dentro do SPED que um produto importado é nacional.',
        assinaturas: [
            /function cstDoLancamento\s*\(/,
            /function partesDoCst\s*\(/,
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
        dono: 'services/sp-connect-message-origin.js',
        comoUsar: "import { saiuPorOutraPlataforma } from 'services/sp-connect-message-origin.js'",
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
    {
        nome: 'O LADO em que está a contraparte do documento',
        dono: 'sefaz-backend/participante-doc-helper.js',
        comoUsar: "import { ladoDaContraparte } from 'sefaz-backend/participante-doc-helper.js'",
        porque: '26/08, triagem das 82 leituras cruas de `direcao`: duas cópias (`relatoriosAgregacoes` e '
            + '`livroNotaProdutor`) reconheciam a nota própria de entrada só por `tpNF === "0"`, SEM o laço '
            + 'que o dono tem — e o comentário do PRÓPRIO dono já diz por que ele existe: "a nota própria de '
            + 'entrada é emitida PELA EMPRESA. Sem esse laço, o tpNF=0 de um TERCEIRO viraria \'nossa\' nota '
            + 'própria — e a contraparte sairia do lado errado". Com dois clientes negociando entre si (KROYA '
            + '× GOLDLOG, 17/08), a nota própria de entrada de UM aparece na base e a coluna mostraria o '
            + 'PRÓPRIO cliente como fornecedor — em TODOS os relatórios e no Livro do produtor rural.',
        // ⚠️ AS ASSINATURAS CASAM A ESCOLHA DO LADO, não a derivação de "é nota
        // própria de entrada?" — essa é OUTRA pergunta e tem dono próprio
        // (`ehNotaPropriaDeEntrada`). A 1ª versão desta trava usava
        // `const propriaEntrada = String(` e acusou `migracao-prontidao.js`,
        // que pergunta "é saída própria?" e faz o laço na linha de cima:
        // alarme sobre código certo é o que faz a equipe desligar a trava.
        assinaturas: [
            /direcao === 'saida' \|\| propriaEntrada/,
            /propriaEntrada \? [\w.()|| ]*destinatario/,
        ],
        permitido: [
            // O dono do `tpNF` — é ele que define o que é nota própria de entrada.
            'sefaz-backend/xml-metadata-helper.js',
        ],
    },
    {
        nome: 'Natureza e tipo do FRETE CONTRATADO (bloco D do EFD-Contribuições)',
        dono: 'sefaz-backend/frete-contratado-bloco-d.js',
        comoUsar: "import { INDICADORES_NATUREZA_FRETE, INDICADORES_TIPO_FRETE, decidirFreteNoBlocoD } "
            + "from 'sefaz-backend/frete-contratado-bloco-d.js'",
        porque: '26/08: são tabelas OFICIAIS do Guia Prático 1.35 (D101/D105 campo 02 e D100 campo 17) e '
            + 'decidem, de uma vez, se o CT-e entra no arquivo e com qual CST — indicador 3, 4 ou 5 vai com '
            + 'CST 70, sem crédito. Uma segunda cópia da lista faria a TELA oferecer um indicador que o '
            + 'GERADOR não conhece (ou o contrário), e o resultado seria crédito de PIS/COFINS declarado a '
            + 'maior num arquivo que o PVA aceita — o erro que só aparece na fiscalização. É a família do '
            + 'IVA-ST e do catálogo de CFOP, que já custaram a réplica divergente.',
        assinaturas: [
            /(?:export\s+)?const\s+INDICADORES_NATUREZA_FRETE\s*=/,
            /(?:export\s+)?const\s+INDICADORES_TIPO_FRETE\s*=/,
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

/**
 * 🚨 MENÇÃO EM PROSA NÃO É SEGUNDA CÓPIA — a varredura lê CÓDIGO.
 *
 * A trava lia o arquivo INTEIRO, comentário incluído. Enquanto as assinaturas
 * eram formas de código (`export function normalizarCompetencia`) isso nunca
 * apareceu; a régua do ISS, que casa nomes de CAMPO, acusou na hora os três
 * comentários que EXPLICAM a correção — ou seja, ela gritaria justamente sobre
 * o arquivo já corrigido, mandando apagar a explicação para o teste passar.
 *
 * É a mesma decisão que a varredura de declarações órfãs já tinha tomado
 * ("comentário fora: menção em prosa não é uso"), e a razão é a de sempre:
 * trava que grita sem motivo é trava que a equipe desliga.
 */
const semComentarios = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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
                const conteudo = semComentarios(readFileSync(arquivo, 'utf8'));
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

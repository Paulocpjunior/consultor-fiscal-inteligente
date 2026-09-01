// ============================================================================
// sefaz-backend/nfse-nacional-leitura.js  (PURO — sem firebase, testável)
//
// 🚨 A NFS-e DO PADRÃO NACIONAL NÃO IMPORTAVA — e a TELA dizia que ia importar
//
// 01/09, Paulo (4BZ CONSULTORIA, arquivo `27_LIFECHEMM_16.xml`):
//
//   "as notas de serviços que puxamos pelo portal nacional vêm em arquivo XML
//    que temos a possibilidade de importar para o consultor, o mesmo reconhece
//    o arquivo como da empresa, mas não tá importando. Essa particularidade
//    acontece principalmente nas empresas que são do município de fora de SP."
//
// A recusa era: *"XML inválido: XML não é uma NFe/NFCe/CTe/NFSe válida (tag
// <infNFe>, <infCte> ou <InfNfse> ausente)"* — sobre uma NFS-e que É válida.
//
// 🔴 A CAUSA SÃO DOIS LEIAUTES COM O MESMO NOME. O `xmlParserService` conhece
// o **ABRASF** (`<InfNfse>`/`<infNfse>`, das prefeituras próprias) e o padrão
// **NACIONAL** (ADN) usa **`<infNFSe>`** — `NFSe` em MAIÚSCULAS. Em XML,
// `getElementsByTagName` é CASE-SENSITIVE, então `infNFSe` ≠ `infNfse`: o
// arquivo caía no `else` e era recusado como se não fosse nota fiscal.
//
// 🚨 E A TELA PROMETIA O CONTRÁRIO. O leiaute nacional traz `<emit>` (o
// prestador é o emitente), que é justamente o bloco que `extrairDadosXml` lê
// para a NF-e — então a confirmação dizia *"1 XML(s) · 1 desta empresa · 1 de
// saída (ela emitiu)"* e o botão Importar aparecia. **A tela afirmava a
// importação e o importador recusava** — é a promessa que a tela não cumpre
// (a família do ✕ de 14/08), agora entre duas leituras do MESMO arquivo.
//
// 📌 É a TERCEIRA leitura do mesmo XML divergindo em dois dias: 31/08 foi a
// tela que não conhecia o ABRASF; hoje é o importador que não conhece o
// nacional. Por isso esta régua nasce como DONO ÚNICO — o backend (captura do
// ADN) e o front (importação manual) leem daqui, nunca cada um do seu jeito.
//
// ⚠️ E O LEIAUTE NÃO FOI DEDUZIDO DE MEMÓRIA: as tags saem do que este repo
// já PROVA — o `nfse-nacional-dps-builder.js`, que **emite** DPS do padrão
// nacional (`infDPS`, `emit`, `toma`, `serv`, `valores > vServPrest > vServ`,
// `trib > tribMun > pAliq/vBC/vISSQN/tpRetISSQN`, `dhEmi`, `dCompet`), e o
// `nfse-nacional-dfe-importer.js`, que lê o retorno do ADN (`infNFSe` com o
// `Id`, `nNFSe`, `CNPJEmit`, `cMunIncidencia`). Inventar nome de tag aqui é o
// `1405` com outra roupa: produz nota importada com valor errado, e valor
// errado o app não denuncia.
// ============================================================================

/**
 * Casa `<tag ...>conteúdo</tag>`.
 *
 * 🐛 A PRIMEIRA VERSÃO USAVA `<${nome}[^>]*>` E LIA O VIZINHO — pega pelo
 * teste, antes de subir. Nesse leiaute há pares como `<vServPrest>` × `<vServ>`
 * e `<cMunIncidencia>` × `<cMun>`: `[^>]*` deixa o nome CURTO casar a abertura
 * do LONGO, e aí o `[\s\S]*?` corre até o fechamento do curto lá dentro. O
 * `vServ` voltava como `"<vReceb>0.00</vReceb><vServ>5000.00"` — texto que o
 * `numero()` transforma em **null**, ou seja: nota RECUSADA por "sem valor"
 * com o valor escrito no arquivo.
 *
 * ⚠️ Por isso o nome tem de terminar em FRONTEIRA (espaço, `>` ou `/`) — a
 * mesma disciplina do `'3.7'` que não podia casar `'3.70'` (15/08).
 */
function tag(xml, nome) {
    const m = String(xml || '').match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}\\s*>`, 'i'));
    return m ? m[1].trim() : null;
}

function atributo(xml, nome, attr) {
    const m = String(xml || '').match(new RegExp(`<${nome}(?:\\s[^>]*)?\\s${attr}="([^"]+)"`, 'i'));
    return m ? m[1] : null;
}

/** Primeira das tags que existir — a ordem é a precedência. */
function primeira(xml, nomes) {
    for (const n of nomes) {
        const v = tag(xml, n);
        if (v !== null && v !== '') return v;
    }
    return null;
}

function soDigitos(v) {
    return String(v || '').replace(/\D/g, '');
}

/**
 * Número do arquivo → number.
 *
 * ⚠️ Devolve **null** quando não há o que ler, NUNCA zero: no leiaute nacional
 * o valor do serviço é o número que vira livro, e zero silencioso é o defeito
 * que esta casa mais paga (regra de 06/08 — campo de valor não recebe default).
 */
function numero(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

/**
 * O XML é uma NFS-e do padrão NACIONAL?
 *
 * ⚠️ EVENTO NÃO É NOTA — o cancelamento do ADN também carrega a chave e
 * atravessaria por engano, e importar um evento como nota criaria documento
 * fantasma. A mesma separação que o `classificarDfe` do importer já faz.
 */
export function ehNfseNacional(xml) {
    const txt = String(xml || '');
    if (/<eventoNFSe|<pedRegEvento/i.test(txt)) return false;
    // 🚨 A DETECÇÃO É CASE-SENSITIVE, e é ELA que separa os dois leiautes.
    //
    // O ABRASF escreve `<InfNfse>` e o nacional escreve `<infNFSe>` — a
    // diferença entre os dois é LITERALMENTE a caixa das letras, e XML é
    // case-sensitive por definição. A primeira versão desta função usava a
    // flag `i` e engoliu o ABRASF inteiro: o teste do "nada regrediu" caiu na
    // hora, mandando toda NFS-e de prefeitura própria para o parser errado.
    //
    // `<infDPS` entra como segunda assinatura porque o DPS (a declaração que
    // o contribuinte assina) é exclusivo do padrão nacional — o ABRASF não
    // tem nada com esse nome.
    return /<infNFSe[\s>]/.test(txt) || /<infDPS[\s>]/.test(txt);
}

/**
 * Lê os participantes do leiaute nacional.
 *
 * 🐛 O PRESTADOR APARECE DUAS VEZES e nos dois casos como `<emit>`: no
 * `<infNFSe>` (o que a prefeitura devolveu) e dentro do `<DPS><infDPS>` (o que
 * o contribuinte declarou). Ler o primeiro é o certo — é o documento
 * AUTORIZADO —, e é o que a busca de cima para baixo faz naturalmente.
 *
 * 🚨 E O TOMADOR É `<toma>`, NÃO `<tomad>`. O regex do importer do ADN pedia
 * `<tomad[\s\S]*?<CNPJ>` — que **nunca** casa com `<toma>` —, então o tomador
 * saía vazio em toda NFS-e nacional. Passou despercebido porque o histórico do
 * trilho ADN é ZERO documento (medição de 23/08): o defeito estava vivo
 * esperando a primeira nota chegar.
 */
function participante(xml, tags) {
    for (const t of tags) {
        const bloco = tag(xml, t);
        if (bloco === null) continue;
        const cnpj = tag(bloco, 'CNPJ');
        const cpf = tag(bloco, 'CPF');
        const doc = soDigitos(cnpj || cpf);
        return {
            cnpjCpf: doc,
            nome: tag(bloco, 'xNome') || '',
            im: tag(bloco, 'IM') || '',
            uf: tag(bloco, 'UF') || '',
            codMunIBGE: tag(bloco, 'cMun') || '',
            logradouro: tag(bloco, 'xLgr') || '',
            numero: tag(bloco, 'nro') || '',
            bairro: tag(bloco, 'xBairro') || '',
            cep: soDigitos(tag(bloco, 'CEP')),
        };
    }
    return null;
}

/**
 * Lê uma NFS-e do padrão NACIONAL.
 *
 * Devolve os campos que o leiaute PROVA e nomeia em `lacunas` o que ele não
 * responde — nunca preenche no escuro.
 */
export function lerNfseNacional(xml) {
    const txt = String(xml || '');
    const lacunas = [];

    // O `Id` do infNFSe é `NFS` + a chave de 50 caracteres do padrão nacional.
    const chave = (atributo(txt, 'infNFSe', 'Id') || '').replace(/^NFS[e]?/i, '')
        || tag(txt, 'chaveAcesso') || '';
    const numeroNota = primeira(txt, ['nNFSe', 'nDPS']) || '';
    const dhEmi = primeira(txt, ['dhProc', 'dhEmi']) || '';
    const competencia = tag(txt, 'dCompet') || '';
    const codMunicipio = primeira(txt, ['cLocIncid', 'cMunIncidencia', 'cLocPrestacao']) || '';

    const prestador = participante(txt, ['emit', 'prest']);
    const tomador = participante(txt, ['toma', 'tomador']);
    if (!prestador || !prestador.cnpjCpf) lacunas.push('prestador sem CNPJ/CPF legível (<emit>)');

    // ── Valores ────────────────────────────────────────────────────────────
    // `vServ` vive em <valores><vServPrest><vServ>; o `vBC`, a alíquota e o
    // ISS ficam em <trib><tribMun>. As duas formas do importer do ADN
    // (`vServPrest` solto, `pAliqAplicada`) continuam aceitas.
    const servico = numero(primeira(txt, ['vServ', 'vServPrest']));
    const iss = numero(primeira(txt, ['vISSQN', 'vISS']));
    const aliquotaIss = numero(primeira(txt, ['pAliq', 'pAliqAplicada', 'pAliqAplic']));
    const baseCalculo = numero(tag(txt, 'vBC'));
    const liquido = numero(tag(txt, 'vLiq'));
    const tpRetIss = tag(txt, 'tpRetISSQN');

    if (servico === null) lacunas.push('valor do serviço não encontrado (<vServ>)');

    // 🚩 RETENÇÕES FEDERAIS FICAM DE FORA, NOMEADAS — e isso é decisão.
    //
    // O bloco `<tribFed>` do leiaute nacional (IRRF, CSLL, PIS/COFINS) NÃO é
    // emitido pelo `nfse-nacional-dps-builder.js` deste repo, então não há
    // aqui NENHUMA prova dos nomes das tags dele. Chutá-los produziria uma de
    // duas coisas, e as duas são piores que a ausência: valor lido do campo
    // errado, ou ZERO com cara de "não houve retenção" — que é justamente o
    // que o Relatório de Retenções e o R-4020 leem para declarar.
    //
    // Por isso o documento nasce com `retencoesFederaisGravadas: false`, que é
    // o mesmo carimbo que o app já usa para dizer *"ausente ≠ zero retido"*.
    // Fecha com um XML nacional REAL que tenha retenção.
    lacunas.push('retenções federais (IRRF/CSLL/PIS/COFINS) não lidas — leiaute do <tribFed> não provado neste repo');

    return {
        chave,
        numero: numeroNota,
        dhEmi,
        competencia,
        codMunicipio,
        prestador,
        tomador,
        valores: {
            servico,
            baseCalculo,
            aliquotaIss,
            iss,
            // ⚠️ `tpRetISSQN` = 1 é RETIDO (é o que o builder do DPS escreve
            // para `servico.issRetido`). Ausência não vira `false` afirmado:
            // vira `null`, que o leitor distingue de "a nota diz que não".
            issRetido: tpRetIss === null || tpRetIss === '' ? null : tpRetIss === '1',
            liquido,
            retencoesFederaisGravadas: false,
        },
        lacunas,
    };
}

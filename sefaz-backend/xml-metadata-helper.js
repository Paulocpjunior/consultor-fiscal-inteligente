/**
 * Direção do documento: entrada ou saída, do ponto de vista da EMPRESA-CLIENTE.
 *
 * ═══ O tpNF DECIDE QUANDO A EMPRESA É A EMITENTE ════════════════════════════
 *
 * Compra de produtor rural PF é **NOTA PRÓPRIA DE ENTRADA** (RICMS/SP art. 136,
 * I, "a"): o produtor não emite NF-e, então o adquirente emite a nota da própria
 * entrada, com `tpNF=0`. Ela tem `emit = empresa` e mesmo assim é ENTRADA de
 * mercadoria.
 *
 * Sem olhar o tpNF, essas notas viram "saída" — e a partir daí:
 *   · o Exportar SAGE recusa o CFOP 1xxx/2xxx ("CFOP inválido para nota de saída")
 *   · a DIPAM/FUNRURAL não as vê, porque só olha ENTRADAS
 *   · e a dedup do art. 136 não acha a nota própria que cobre a NF-e do
 *     produtor, então quem entra na conta é a NF-e DELE — que é justamente a
 *     que não se escritura
 *
 * ⚠️ **ESTA RÉGUA MORA AQUI, NUM LUGAR SÓ.** Ela nasceu em 31/07 (caso EDUARDO
 * GUERRA) dentro do `xml-importer.js`, e o caminho de importação MANUAL do
 * frontend ficou com uma segunda cópia que nunca recebeu a correção — decidindo
 * `emit === empresa ⇒ saída` e nada mais. Em 14/08 isso reapareceu na NOVA ERA:
 * 12 notas próprias de entrada gravadas como saída, o FUNRURAL contando a NF-e
 * do produtor no lugar da nota da empresa (Paulo: *"o CFI está levando a nota
 * dele e não está considerando a da NOVA ERA"*). Régua fiscal com duas cópias
 * diverge — e diverge em silêncio.
 */
export function decidirDirecaoPorTpNF(cnpjEmit, cnpjDest, empresaCnpj, tpNF) {
    const norm = (c) => String(c || '').replace(/\D/g, '');
    const emi = norm(cnpjEmit);
    const dest = norm(cnpjDest);
    const emp = norm(empresaCnpj);
    if (!emp) return 'desconhecida';
    // tpNF só é lido do lado da EMISSÃO — é lá que ele muda a resposta.
    if (emi === emp) return String(tpNF ?? '') === '0' ? 'entrada' : 'saida';
    if (dest === emp) return 'entrada';
    return 'desconhecida';
}

export function competenciaFromDhEmi(value) {
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}`;

    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}`;

    return null;
}

function pickFirstBlock(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1] : '';
}

function pickTag(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
}

/**
 * CNPJ/CPF autorizados a baixar o XML — bloco <autXML> da NF-e.
 *
 * É a PROVA de que o cliente configurou o escritório no emissor dele: com o
 * nosso CNPJ aqui, a SEFAZ entrega a nota de SAÍDA para nós (sem isso não
 * entrega — Rejeição 641). Paulo, 04/08: "como assegurar que o cliente fez
 * correto, como podemos confirmar se o cadastro já está apto conforme ele
 * informa". A resposta está escrita na própria nota.
 *
 * Uma NF-e aceita até 10 autorizados, então devolve LISTA.
 */
export function extrairAutXml(xml) {
    const fora = [];
    const re = /<autXML\b[^>]*>([\s\S]*?)<\/autXML>/gi;
    let m;
    while ((m = re.exec(String(xml || ''))) !== null) {
        const doc = pickTag(m[1], 'CNPJ') || pickTag(m[1], 'CPF');
        const d = String(doc || '').replace(/\D/g, '');
        if (d) fora.push(d);
    }
    return fora;
}

/** O escritório está entre os autorizados desta nota? */
export function autorizadoNoXml(xml, cnpjEscritorio) {
    const alvo = String(cnpjEscritorio || '').replace(/\D/g, '');
    if (!alvo) return false;
    return extrairAutXml(xml).includes(alvo);
}

export function extrairParticipantesNfe(xml) {
    const emit = pickFirstBlock(xml, 'emit');
    const dest = pickFirstBlock(xml, 'dest');

    // ENDEREÇO importa: o Exportar SAGE cadastra o participante (registro
    // E010) e o E-Fiscal RECUSA sem UF ("Campo 10, UF inválida"). Até 04/08 só
    // guardávamos o CNPJ do destinatário — nas SAÍDAS, que é justamente onde o
    // participante É o destinatário, o E010 saía com nome "CLIENTE" e UF em
    // branco e derrubava a importação inteira em cascata (caso 04/08: 30 sem
    // UF ⇒ 54 notas recusadas). O bloco <enderDest> sempre veio no XML.
    const endEmit = pickFirstBlock(emit, 'enderEmit');
    const endDest = pickFirstBlock(dest, 'enderDest');

    return {
        emitente: {
            cnpj: pickTag(emit, 'CNPJ') || pickTag(emit, 'CPF') || null,
            nome: pickTag(emit, 'xNome') || null,
            uf: pickTag(endEmit, 'UF') || null,
            codMunIBGE: pickTag(endEmit, 'cMun') || null,
            ie: pickTag(emit, 'IE') || null,
        },
        destinatario: {
            cnpj: pickTag(dest, 'CNPJ') || pickTag(dest, 'CPF') || null,
            nome: pickTag(dest, 'xNome') || null,
            uf: pickTag(endDest, 'UF') || null,
            codMunIBGE: pickTag(endDest, 'cMun') || null,
            ie: pickTag(dest, 'IE') || null,
        },
    };
}

/**
 * Direção EFETIVA de um doc já gravado — a régua única de leitura.
 *
 * O importer antigo marcava 'saida' sempre que a empresa era a emitente,
 * ignorando o tpNF: nota própria de ENTRADA (tpNF=0 — compra de produtor
 * rural PF, retorno etc.) ficava como saída, o Exportar SAGE recusava o CFOP
 * 1xxx/2xxx e a DIPAM não via a compra (31/07, caso EDUARDO GUERRA). O
 * backfill do sync-cron corrige o banco aos poucos; esta função corrige a
 * LEITURA na hora, para o painel não depender do próximo ciclo.
 */
export function direcaoEfetivaDoc(d) {
    if (!d) return undefined;
    if (d.direcao === 'saida' && ehNotaPropriaDeEntrada(d).sim) return 'entrada';
    return d.direcao;
}

/**
 * CFOP de ENTRADA — 1xxx (dentro do estado), 2xxx (outra UF), 3xxx (exterior).
 *
 * O primeiro dígito do CFOP é a DIREÇÃO da operação, por definição da tabela
 * CONFAZ. Não é dedução nossa: é o que o código significa.
 *
 * ⚠️ **NÃO USE ISTO PARA DECIDIR A DIREÇÃO DE UM DOCUMENTO GRAVADO** — leia o
 * aviso em `ehNotaPropriaDeEntrada`. A régua da direção é o `tpNF`.
 */
export function ehCfopDeEntrada(cfop) {
    const c = String(cfop || '').replace(/\D/g, '');
    return c.length === 4 && ['1', '2', '3'].includes(c[0]);
}

/**
 * A nota é NOTA PRÓPRIA DE ENTRADA (art. 136, I, "a" do RICMS/SP)? — e QUAL é
 * a prova disso.
 *
 * A régua é o **`tpNF`**, e só ele. É o próprio documento dizendo de que lado
 * está: `tpNF=0` numa nota emitida pela empresa é a nota que o adquirente
 * emite da própria entrada (compra de produtor rural PF, retorno etc.).
 *
 * ═══ POR QUE NÃO SE DECIDE ISTO PELO CFOP — lição de 14/08 ══════════════════
 *
 * Em 14/08 eu acrescentei aqui uma segunda prova: "nota emitida pela empresa
 * com CFOP de ENTRADA também é nota própria". A intenção era alcançar
 * documentos gravados antes de o import manual passar a guardar o `tpNF`.
 * Estava ERRADO por duas razões, e as duas só apareceram na revisão:
 *
 *  1. **O problema não existia.** As notas do caso real (NOVA ERA 07/2026)
 *     vieram pelo importer principal e SEMPRE tiveram `tpNF` — a própria tela
 *     provou, mostrando a prova `tpNF` e não `cfop-de-entrada`. Eu tinha
 *     diagnosticado por dedução, sem o dado na mão.
 *
 *  2. **E ela criava DUAS LEITURAS DO MESMO DADO.** Três dos quatro
 *     consumidores desta função leem o documento com `.select()` de projeção
 *     — relatórios de faturamento, Livro, conferência de chaves — e nenhuma
 *     dessas projeções traz `itens`/`cnpjEmit` (`itens` é justamente o campo
 *     pesado que elas evitam). Resultado medido: o MESMO documento saía
 *     `entrada` na base de crédito de PIS/COFINS (que lê o doc inteiro) e
 *     `saida` no faturamento. Duas leituras do mesmo dado discordando é a
 *     armadilha que mais mordeu este projeto.
 *
 * Régua que muda de resposta conforme o SELECT do chamador não é régua. Se um
 * dia aparecer documento sem `tpNF`, o certo é gravar o campo (backfill a
 * partir do XML no Storage, que é a FONTE), nunca deduzir a direção na leitura.
 *
 * @returns {{ sim: boolean, prova: 'tpNF'|null }}
 */
export function ehNotaPropriaDeEntrada(d, empresaCnpj) {
    const nao = { sim: false, prova: null };
    if (!d) return nao;
    if (String(d.tpNF ?? '').trim() !== '0') return nao;

    const norm = (c) => String(c || '').replace(/\D/g, '');
    const emp = norm(empresaCnpj || d.empresaCnpj);
    const emi = norm(d.cnpjEmit || d.emitente?.cnpjCpf || d.emitente?.cnpj);
    // A nota própria de entrada é emitida PELA EMPRESA. Sem esse laço, o
    // `tpNF=0` de um TERCEIRO (que emitiu a nota de entrada DELE) viraria
    // "nossa" nota própria — e a contraparte sairia do lado errado.
    const daEmpresa = d.direcao === 'saida' || (!!emp && !!emi && emi === emp);
    if (!daEmpresa) return nao;

    return { sim: true, prova: 'tpNF' };
}

// ── Cancelamento EFETIVO — mesma lição da direção: o campo gravado pode mentir ──
// Duas formas de o status ficar torto (bug 11/08, MV LIDER 639 — cancelada
// contada no Livro de Saídas e no fechamento):
//   1. o importer só virava status com evento cStat 135; cancelamento homologado
//      FORA DE PRAZO é cStat 155 e é cancelamento igual — ficava 'autorizado';
//   2. evento chegando ANTES da nota (stub 'cancelado') era atropelado pelo
//      merge quando a NF-e completa chegava com o protocolo dela (autorizado).
// Esta função decide na LEITURA, olhando o que o doc CARREGA: o status, o cStat
// da própria nota (legado 101/151 = cancelamento homologado) e os eventos[]
// (110111 registrado = 135/155). O backfill do sync-cron conserta o banco aos
// poucos; a leitura não espera o próximo ciclo.

const STATUS_CANCELADO = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);
/** cStat da PRÓPRIA nota que significa cancelamento (legado pré-evento). */
const CSTAT_NOTA_CANCELADA = new Set(['101', '151']);
/** cStat de EVENTO 110111 registrado (135) ou homologado fora de prazo (155). */
export const CSTAT_EVENTO_CANCELAMENTO = new Set(['135', '155']);

// ── EVENTO NÃO É NOTA ───────────────────────────────────────────────────────
//
// Caso 13/08 (Paulo: *"TA ZICADA ESSA EMPRESA"*): a aba 🌾 acusou **435 notas
// "sem o fornecedor"**, e o ♻️ não recuperava nenhuma — "0 recuperadas, 664 já
// tinham". Não eram notas: eram EVENTOS DE CANCELAMENTO gravados como
// documento. A "chave" delas tem 53 dígitos e começa com o tpEvento:
//
//   110111 35260729240822000121550010000255036113641904 201
//   └tpEvento┘ └──────────── chNFe (44) ────────────────┘ └seq┘
//
// Elas nunca têm emitente nem destinatário — evento não carrega participante —
// então caíam eternamente em "o documento não traz o fornecedor", mandando
// reler um XML que não tem o que reler. 435 alarmes sem ação, na frente da
// pendência que importava.
//
// A régua é literal e não depende de `tipoDoc` (que a captura por e-mail nem
// sempre grava): **chave de documento fiscal tem 44 dígitos**. Mais que isso é
// Id de evento. Chave VAZIA continua sendo nota legítima — a NFS-e do portal
// não tem chave, e isso é a forma do trilho, não buraco.
const TIPOS_DE_EVENTO = new Set(['eventoNFe', 'eventoNFCe', 'eventoCTe', 'eventoMDFe', 'resEvento']);

export function ehRegistroDeEvento(d) {
    if (!d) return false;
    if (TIPOS_DE_EVENTO.has(String(d.tipoDoc || d.tipo || ''))) return true;
    return String(d.chave || '').replace(/\D/g, '').length > 44;
}

/** A chNFe de verdade escondida na chave-Id de um registro de evento. */
export function chaveDaNotaDoEvento(d) {
    const bruto = String(d?.chave || '').replace(/\D/g, '');
    if (bruto.length === 44) return bruto;
    // ID + tpEvento(6) + chNFe(44) + seq — o miolo é sempre a chave.
    if (bruto.length > 44) return bruto.substring(6, 50).length === 44 ? bruto.substring(6, 50) : null;
    return null;
}

export function docCancelado(d) {
    if (!d) return false;
    if (STATUS_CANCELADO.has(String(d.status || '').toLowerCase())) return true;
    if (CSTAT_NOTA_CANCELADA.has(String(d.cStat || ''))) return true;
    const eventos = Array.isArray(d.eventos) ? d.eventos : [];
    return eventos.some((e) => {
        if (!e) return false;
        const ehCancelamento = String(e.tpEvento || '') === '110111'
            || String(e.tipo || '') === 'cancelamento';
        if (!ehCancelamento) return false;
        const cStat = String(e.cStat || '');
        // Sem cStat gravado (captura antiga/cofre): a SEFAZ só distribui evento
        // REGISTRADO, então cancelamento anexado sem cStat conta como cancelado.
        // cStat presente e fora de 135/155 (ex.: rejeição) NÃO cancela.
        return cStat === '' || CSTAT_EVENTO_CANCELAMENTO.has(cStat);
    });
}


/**
 * O VALOR do documento, em TODAS as formas em que ele é gravado.
 *
 * Nasceu no bloco A do EFD-Contribuições (17/08, MANTOAN: 37 documentos com
 * VL_DOC 0,00) e mudou para cá em 21/08, quando a varredura achou o MESMO
 * defeito no bloco D dos DOIS arquivos: eles liam `valor || totalNota` e o
 * importer grava **valorTotal** (o CT-e traz `<vTPrest>`).
 *
 * Devolve **NaN** quando nenhuma forma tem número — de propósito: "documento
 * de R$ 0,00" e "não achei o valor" são coisas diferentes, e foi o zero
 * silencioso que produziu linhas zeradas num arquivo entregue à Receita.
 */
export function valorDoDocumentoServico(nota) {
    const n = nota || {};
    const candidatos = [
        n.valor, n.valorTotal, n.totalNota, n.valorServicos,
        n.totais?.vNF, n.totais?.vServ, n.valores?.valorServicos,
    ];
    for (const c of candidatos) {
        if (c === null || c === undefined || c === '') continue;
        const v = typeof c === 'number' ? c : parseFloat(String(c).replace(',', '.'));
        if (Number.isFinite(v)) return v;
    }
    return NaN;
}

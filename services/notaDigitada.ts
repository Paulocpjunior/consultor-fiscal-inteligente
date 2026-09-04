/**
 * services/notaDigitada.ts — LANÇAR NOTA SEM XML, no MESMO trilho dos XMLs.
 *
 * Paulo, 15/08: *"importação de XML — automática ou manual — tem a mesma
 * finalidade: abastecer o sistema de lançamentos para que possam ser atendidas
 * as obrigações, relatórios, guias. Até mesmo o lançamento de uma nota de
 * forma manual, devemos poder fazer."*
 *
 * ═══ O DESENHO: uma TERCEIRA PORTA, nunca um segundo banco ══════════════════
 *
 * A nota digitada grava em `documentos_fiscais`, com a MESMA forma que o
 * importer grava — campos chatos + itens[] — para que TODO leitor que já
 * existe (SPED, livros, DIPAM, relatórios, varredura de IPI) a enxergue sem
 * uma linha de código nova. Documento que mora em coleção própria vira um
 * segundo mundo que nenhum relatório soma — o defeito da colcha, de novo.
 *
 * O que a distingue é a ORIGEM (`origem: 'digitada'`), carimbada com quem e
 * quando: dado fiscal digitado sem autor não se audita.
 *
 * ═══ AS TRÊS RÉGUAS QUE MANDAM ══════════════════════════════════════════════
 *
 * 1. **XML VENCE DIGITAÇÃO.** A nota digitada é o retrato que a pessoa fez do
 *    documento; o XML é o documento. Quando a captura trouxer o XML da mesma
 *    chave, ele SUBSTITUI a digitada (upgrade no importer) — e uma digitada
 *    nunca sobrescreve um doc que tem XML. Sem essa régua, a digitada de hoje
 *    travaria como "duplicado" o XML verdadeiro de amanhã — a mesma família
 *    da lápide que travava a reimportação (14/08).
 *
 * 2. **CAMPO DE VALOR NÃO TEM DEFAULT.** Valor zero digitado é resposta;
 *    valor ausente é recusa. A mesma régua do SPED (06/08): zero só entra
 *    quando zero É a resposta.
 *
 * 3. **O CFOP DIGITADO É O DA ESCRITURAÇÃO** — na entrada, 1xxx/2xxx/3xxx; na
 *    saída, 5xxx/6xxx/7xxx. Digitar o CFOP do fornecedor numa entrada é o
 *    erro clássico, e a validação barra com a explicação em vez de aceitar e
 *    deixar o livro sair torto.
 *
 * ═══ DUAS ESPÉCIES, PORQUE SÃO DOIS DOCUMENTOS DIFERENTES ═══════════════════
 *
 * A primeira versão desta porta só abria para MERCADORIA — exigia CFOP, que a
 * NFS-e não tem. Ou seja: a porta não servia justamente para os ~157 clientes
 * de serviço puro, nem para o caso que mais precisa dela (município que ainda
 * não transcreve ao ADN, como Jundiaí, onde a cobertura É a digitação).
 *
 * Serviço NÃO é mercadoria com outro rótulo: não tem CFOP nem NCM, tem código
 * de serviço municipal, ISS com alíquota e retenção, e prestador/tomador no
 * lugar de emitente/destinatário. Forçar tudo num formulário só faria a pessoa
 * inventar um CFOP para conseguir salvar — e CFOP inventado entra no livro.
 *
 * ⚠️ O ISS **não tem default**, e aqui isso vale dobrado: `iss-zerado-causa`
 * distingue "alíquota AUSENTE" (buraco, pede conferência) de "zerado com a nota
 * dizendo que tributa" (inconsistente). Gravar 0 por comodidade fabricaria uma
 * pendência falsa de inconsistência em toda nota lançada à mão.
 *
 * ═══ E A TERCEIRA: CONHECIMENTO DE TRANSPORTE (CT-e 57 / CT-e OS 67) ════════
 *
 * Paulo, 04/09, J.P. PISSATO: *"essa empresa tem uma particularidade… ela não é
 * formato 55, 65 e sim 67 DACTE-OS, com isso o cliente só envia o PDF"* — e o
 * mesmo caso na 923 MONACO. Com A3 no cadastro não há captura automática, então
 * a digitação É a cobertura daquele documento.
 *
 * 🚨 **CT-e OS não é NF-e nem NFS-e, e forçá-lo numa das duas move o documento
 * de BLOCO.** Lançado como serviço (modelo 99) ele entra no **bloco A** do
 * EFD-Contribuições e no Livro de Serviços; lançado como mercadoria, vira C100.
 * O lugar dele é o **bloco D** — e o CT-e OS tem **ICMS destacado** (o DACTE-OS
 * medido traz CST 00, base 3.901,37, 12%, ICMS 468,16), que a NFS-e não tem:
 * pelo caminho errado esses 468,16 sumiriam do débito/crédito do E110.
 *
 * ✅ E o resto do app **já sabia**: `ehConhecimentoDeTransporte` reconhece
 * 57/67 (e o rótulo `CTe`) desde sempre, e `sped-fiscal-blocoD` lê `nota.cfop`
 * na RAIZ, `nota.aliqIcms` e `totais.vBC/vICMS`. Esta espécie grava NESSES
 * campos — não há régua nova, havia uma porta que não produzia o documento.
 *
 * ⚠️ **O MODELO É ESCOLHA DA PESSOA, nunca dedução.** 57 (CT-e) e 67 (CT-e OS)
 * são documentos diferentes com a mesma cara no papel; carimbar um deles pelo
 * app seria inventar o modelo de um documento fiscal — a família do `1405`.
 */
import type { DocumentoFiscal } from '../types';
import { idDocumentoNfseSp } from '../sefaz-backend/nfse-identidade.js';
import {
    camposDaRetencaoDigitada,
    validarRetencaoDigitada,
    type RetencaoFederalDigitadaInput,
} from './retencaoFederalDigitada';

export interface ItemDigitado {
    cfop: string;
    /** Valor do item (obrigatório — campo de valor não tem default). */
    vProd: number | null;
    ncm?: string;
    xProd?: string;
    cst?: string;
    vBC?: number;
    vICMS?: number;
    vIPI?: number;
}

/** O que a pessoa digita quando a nota é de SERVIÇO (NFS-e). */
export interface ServicoDigitado {
    /** Discriminação do serviço — é ela que aparece nos relatórios. */
    discriminacao: string;
    /** Código de serviço do MUNICÍPIO (não é o item da LC 116). */
    codigoServico?: string;
    /** Alíquota do ISS em %. AUSENTE ≠ ZERO — deixe vazio se não souber. */
    aliquota?: number | null;
    /** ISS devido em R$. AUSENTE ≠ ZERO. */
    valorIss?: number | null;
    /** O tomador reteve o ISS? */
    issRetido?: boolean;
}

/**
 * O que a pessoa digita quando o documento é CT-e (57) ou CT-e OS (67).
 *
 * O CT-e não tem itens de produto: tem a PRESTAÇÃO, com um CFOP no cabeçalho
 * (o DACTE-OS medido traz `5357 - Prestação de serviço`) e o ICMS destacado.
 */
export interface TransporteDigitado {
    /** '57' = CT-e · '67' = CT-e OS. Escolha da pessoa — o app não deduz. */
    modelo: '57' | '67';
    /** CFOP da prestação, do cabeçalho do CT-e. */
    cfop: string;
    /** Descrição da prestação — é ela que aparece nos relatórios. */
    descricao?: string;
    /** CST do ICMS (ex.: '00'). */
    cst?: string;
    /** Base de cálculo do ICMS. AUSENTE ≠ ZERO. */
    vBC?: number | null;
    /** Alíquota do ICMS em %. AUSENTE ≠ ZERO. */
    aliqIcms?: number | null;
    /** ICMS destacado em R$. AUSENTE ≠ ZERO. */
    vICMS?: number | null;
}

export interface NotaDigitadaInput {
    /**
     * 'mercadoria' = NF-e (CFOP, itens) · 'servico' = NFS-e (ISS, sem CFOP)
     * · 'transporte' = CT-e / CT-e OS (bloco D, ICMS destacado).
     */
    especie?: 'mercadoria' | 'servico' | 'transporte';
    servico?: ServicoDigitado;
    transporte?: TransporteDigitado;
    /**
     * Retenção federal declarada no documento — vale para as TRÊS espécies.
     *
     * Sem isto, `retencoesFederaisGravadas` responde false e o Relatório de
     * Retenções imprime **"?"** na coluna do IR sobre uma nota que DIZ o valor
     * retido no corpo. Era o caso da J.P. PISSATO.
     */
    retencao?: RetencaoFederalDigitadaInput;
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    direcao: 'entrada' | 'saida';
    numero: string;
    serie?: string;
    /** Data de emissão AAAA-MM-DD. */
    dhEmi: string;
    /** Chave de 44 dígitos, OPCIONAL — com ela, o XML futuro assume o lugar. */
    chave?: string;
    /** A contraparte: fornecedor na entrada, cliente na saída. */
    participanteNome: string;
    participanteDoc?: string;
    participanteUf?: string;
    valorTotal: number | null;
    /** Só na espécie mercadoria — serviço não tem itens com CFOP. */
    itens: ItemDigitado[];
    digitadaPorEmail: string;
    /**
     * 🚨 UID de quem está lançando — SEM ELE O FIRESTORE RECUSA A CRIAÇÃO.
     *
     * A regra de `documentos_fiscais` exige
     * `request.resource.data.createdBy == request.auth.uid` no CREATE, e não há
     * escape nem para admin. Como este objeto não trazia `createdBy`, TODA nota
     * nova era negada com "Missing or insufficient permissions" (Paulo, 17/08,
     * com print) — ou seja, a terceira porta nunca gravou nota nenhuma.
     */
    createdByUid?: string;
}

/** Espécie efetiva — o padrão é mercadoria (como a porta nasceu). */
export const especieDe = (i: { especie?: string }): 'mercadoria' | 'servico' | 'transporte' =>
    i.especie === 'servico' ? 'servico'
        : i.especie === 'transporte' ? 'transporte'
            : 'mercadoria';

/** Os modelos que a espécie transporte admite — Tabela 4.1.1 do SPED. */
export const MODELOS_TRANSPORTE = ['57', '67'] as const;

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Erros em PORTUGUÊS com a ação — validação que só diz "inválido" ensina a chutar. */
export function validarNotaDigitada(i: NotaDigitadaInput): string[] {
    const erros: string[] = [];
    if (!i.empresaId || soDigitos(i.empresaCnpj).length !== 14) {
        erros.push('Empresa inválida — ative a empresa antes de lançar.');
    }
    // 🚨 Sem UID a gravação é RECUSADA pelo Firestore com "Missing or
    // insufficient permissions" — mensagem que não diz nada a quem lê e manda
    // procurar problema de permissão que não existe. A recusa DIZ a causa e a
    // saída aqui, antes de tentar.
    if (!String(i.createdByUid || '').trim()) {
        erros.push('Sessão sem usuário identificado — saia e entre de novo antes de lançar. '
            + 'A nota é gravada em nome de quem a lançou, e sem isso o banco recusa.');
    }
    if (!String(i.numero || '').trim()) erros.push('Informe o número da nota.');
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(i.dhEmi || ''))) {
        erros.push('Informe a data de emissão (a competência sai dela).');
    }
    if (i.valorTotal === null || i.valorTotal === undefined || !(Number(i.valorTotal) > 0)) {
        erros.push('Informe o valor total da nota (maior que zero). Valor não tem default.');
    }
    const chave = soDigitos(i.chave);
    if (i.chave && chave.length !== 44) {
        erros.push(`A chave de acesso tem 44 dígitos — a informada tem ${chave.length}. Se não tiver a chave, deixe em branco.`);
    }
    if (!String(i.participanteNome || '').trim()) {
        erros.push(i.direcao === 'entrada'
            ? 'Informe o FORNECEDOR — sem ele a nota cai em "fornecedor indefinido" na DIPAM e nos relatórios.'
            : 'Informe o CLIENTE (destinatário).');
    }
    // A retenção federal vale para as TRÊS espécies — o CT-e OS do caso J.P.
    // PISSATO tem IRRF e nenhum ISS; a NFS-e tomada tem os dois.
    erros.push(...validarRetencaoDigitada(i.retencao, i.valorTotal));

    if (especieDe(i) === 'servico') {
        // SERVIÇO não tem CFOP nem itens: o que identifica a operação é a
        // discriminação e o código do município.
        if (!String(i.servico?.discriminacao || '').trim()) {
            erros.push('Descreva o serviço prestado — é a discriminação que aparece nos livros e nos relatórios.');
        }
        const al = i.servico?.aliquota;
        if (al !== null && al !== undefined && !(Number(al) >= 0 && Number(al) <= 100)) {
            erros.push('Alíquota do ISS deve ficar entre 0 e 100%. Se não souber, deixe VAZIO — vazio é diferente de zero.');
        }
        return erros;
    }

    if (especieDe(i) === 'transporte') {
        const t = i.transporte;
        // O MODELO decide o bloco e o leiaute — o app não escolhe por ninguém.
        if (!MODELOS_TRANSPORTE.includes(String(t?.modelo || '') as any)) {
            erros.push('Escolha o modelo do documento: 57 (CT-e) ou 67 (CT-e OS). '
                + 'É o modelo que diz à escrituração qual documento é este — o app não deduz.');
        }
        const cfop = soDigitos(t?.cfop);
        if (cfop.length !== 4) {
            erros.push('Informe o CFOP da prestação (4 dígitos) — ele está no cabeçalho do CT-e, ao lado da natureza da operação.');
        } else {
            const iniciaisValidas = i.direcao === 'entrada' ? ['1', '2', '3'] : ['5', '6', '7'];
            if (!iniciaisValidas.includes(cfop[0])) {
                erros.push(i.direcao === 'entrada'
                    ? `CFOP ${cfop} é de SAÍDA. Na entrada se lança o CFOP da ESCRITURAÇÃO — o 5357 do transportador vira 1357 aqui.`
                    : `CFOP ${cfop} é de ENTRADA — numa saída o CFOP é 5xxx/6xxx/7xxx.`);
            }
        }
        const al = t?.aliqIcms;
        if (al !== null && al !== undefined && !(Number(al) >= 0 && Number(al) <= 100)) {
            erros.push('Alíquota do ICMS deve ficar entre 0 e 100%. Se não souber, deixe VAZIO — vazio é diferente de zero.');
        }
        // ⚠️ O ICMS não é conferido CONTRA a conta base × alíquota: o CT-e pode
        // ter redução de base, e recalcular aqui acusaria documento correto.
        // O que se recusa é o impossível — ICMS maior que a própria prestação.
        const icms = t?.vICMS;
        if (icms !== null && icms !== undefined && Number(i.valorTotal) > 0 && Number(icms) > Number(i.valorTotal)) {
            erros.push(`ICMS de R$ ${Number(icms).toFixed(2)} é MAIOR que o valor da prestação — confira a vírgula.`);
        }
        return erros;
    }

    if (!Array.isArray(i.itens) || !i.itens.length) {
        erros.push('Lance ao menos um item com CFOP e valor — é do item que saem livro, DIPAM e SPED.');
    }
    const iniciaisValidas = i.direcao === 'entrada' ? ['1', '2', '3'] : ['5', '6', '7'];
    for (const [idx, it] of (i.itens || []).entries()) {
        const cfop = soDigitos(it.cfop);
        if (cfop.length !== 4) {
            erros.push(`Item ${idx + 1}: CFOP deve ter 4 dígitos.`);
        } else if (!iniciaisValidas.includes(cfop[0])) {
            erros.push(i.direcao === 'entrada'
                ? `Item ${idx + 1}: CFOP ${cfop} é de SAÍDA. Na entrada se lança o CFOP da ESCRITURAÇÃO (1xxx/2xxx/3xxx) — o 5102 do fornecedor vira 1102 aqui.`
                : `Item ${idx + 1}: CFOP ${cfop} é de ENTRADA — numa saída o CFOP é 5xxx/6xxx/7xxx.`);
        }
        if (it.vProd === null || it.vProd === undefined || !(Number(it.vProd) >= 0)) {
            erros.push(`Item ${idx + 1}: informe o valor do item.`);
        }
    }
    return erros;
}

/**
 * Id DETERMINÍSTICO: relançar a mesma nota corrige a digitação em vez de
 * duplicar o documento. Com chave, o id É a chave — é isso que faz o XML
 * futuro cair NO MESMO documento e fazer o upgrade.
 */
export function idNotaDigitada(i: NotaDigitadaInput): string {
    if (especieDe(i) === 'servico') {
        // 🚨 A MESMA IDENTIDADE QUE OS IMPORTADORES DE NFS-e USAM. É isto que
        // faz a nota capturada depois cair NO MESMO documento e substituir a
        // digitada. Fórmula própria aqui criaria um SEGUNDO documento, e o
        // mesmo serviço entraria duas vezes no livro, no ISS e no faturamento.
        const empresaCnpj = soDigitos(i.empresaCnpj);
        const partDoc = soDigitos(i.participanteDoc);
        const prestador = i.direcao === 'saida' ? empresaCnpj : partDoc;
        const tomador = i.direcao === 'saida' ? partDoc : empresaCnpj;
        return idDocumentoNfseSp({ prestadorCnpj: prestador, tomadorCnpj: tomador, numero: i.numero });
    }
    const chave = soDigitos(i.chave);
    if (chave.length === 44) return chave;
    const comp = String(i.dhEmi || '').slice(0, 7);
    return `digitada_${i.empresaId}_${String(i.numero).trim()}_${String(i.serie || '1').trim()}_${comp}`;
}

/** Monta o documento na MESMA forma que o importer grava. */
export function montarNotaDigitada(i: NotaDigitadaInput): DocumentoFiscal {
    if (especieDe(i) === 'servico') return montarNfseDigitada(i);
    if (especieDe(i) === 'transporte') return montarCteDigitado(i);
    const chave = soDigitos(i.chave);
    const empresaCnpj = soDigitos(i.empresaCnpj);
    const partDoc = soDigitos(i.participanteDoc);
    const competencia = String(i.dhEmi).slice(0, 7);
    // Nota de ENTRADA emitida pela própria empresa não existe na digitação
    // comum; quem digita lança a nota do FORNECEDOR. Então na entrada o
    // emitente é a contraparte, na saída é a empresa — igual ao XML.
    const emitente = i.direcao === 'entrada'
        ? { cnpjCpf: partDoc, nome: i.participanteNome, uf: (i.participanteUf || '').toUpperCase() }
        : { cnpjCpf: empresaCnpj, nome: i.empresaNome, uf: '' };
    const destinatario = i.direcao === 'entrada'
        ? { cnpjCpf: empresaCnpj, nome: i.empresaNome, uf: '' }
        : { cnpjCpf: partDoc, nome: i.participanteNome, uf: (i.participanteUf || '').toUpperCase() };

    return {
        id: idNotaDigitada(i),
        chave: chave.length === 44 ? chave : '',
        xmlHash: '',
        tipo: 'NFe',
        modelo: '55',
        serie: String(i.serie || '1').trim(),
        numero: String(i.numero).trim(),
        tpNF: i.direcao === 'saida' ? '1' : null,
        dhEmi: i.dhEmi,
        competencia,
        direcao: i.direcao,
        // A pessoa afirma lançar de um documento em mãos (DANFE/nota impressa);
        // fica gravado QUEM afirmou — mesma régua do "sem movimento": o app não
        // verifica, a pessoa atesta, e a autoria não some.
        status: 'autorizado',
        empresaId: i.empresaId,
        empresaCnpj,
        empresaNome: i.empresaNome,
        emitente,
        destinatario,
        // Campos CHATOS também — metade dos leitores lê esta forma (11/08).
        cnpjEmit: emitente.cnpjCpf,
        xNomeEmit: emitente.nome,
        ufEmit: emitente.uf,
        cnpjDest: destinatario.cnpjCpf,
        xNomeDest: destinatario.nome,
        ufDest: destinatario.uf,
        totais: { vNF: Number(i.valorTotal) },
        valorTotal: Number(i.valorTotal),
        itens: i.itens.map((it, idx) => ({
            nItem: String(idx + 1),
            cfop: soDigitos(it.cfop),
            ncm: soDigitos(it.ncm) || undefined,
            xProd: it.xProd || `ITEM ${idx + 1} (digitado)`,
            vProd: Number(it.vProd),
            cst: it.cst || undefined,
            vBC: it.vBC !== undefined ? Number(it.vBC) : undefined,
            vICMS: it.vICMS !== undefined ? Number(it.vICMS) : undefined,
            vIPI: it.vIPI !== undefined ? Number(it.vIPI) : undefined,
        })),
        // Só os tributos PREENCHIDOS entram — ver `retencaoFederalDigitada`.
        ...camposDaRetencaoDigitada(i.retencao),
        origem: 'digitada',
        createdBy: i.createdByUid || null,
        digitadaPorEmail: i.digitadaPorEmail,
        digitadaEm: new Date().toISOString(),
        importadoPorEmail: i.digitadaPorEmail,
    } as unknown as DocumentoFiscal;
}

/**
 * CT-e / CT-e OS digitado — nos MESMOS campos que `sped-fiscal-blocoD` LÊ.
 *
 * Medido no gerador antes de escrever: ele lê `nota.cfop` na **RAIZ** (nunca só
 * no item), `nota.aliqIcms`, `totais.vBC`/`totais.vICMS`, mais os donos
 * `valorDoDocumento`, `serieDoDocumento`, `codSitDoDocumento` e
 * `participanteDoDocumento`. É o mesmo lugar em que o `xml-importer` grava o
 * CFOP de cabeçalho do CT-e capturado (`...(meta.cfopCabecalho ? { cfop } : {})`).
 *
 * 🚨 **O RÓTULO É `CTe`, e é ele que liga o bloco D.**
 * `ehConhecimentoDeTransporte` casa `/CTe/i` no rótulo ANTES de olhar o modelo,
 * e `ehNotaDeServico` devolve false para ele — então este documento sai do
 * bloco A e do Livro de Serviços por construção, sem uma linha de régua nova.
 */
function montarCteDigitado(i: NotaDigitadaInput): DocumentoFiscal {
    const chave = soDigitos(i.chave);
    const empresaCnpj = soDigitos(i.empresaCnpj);
    const partDoc = soDigitos(i.participanteDoc);
    const competencia = String(i.dhEmi).slice(0, 7);
    const t = i.transporte || ({} as TransporteDigitado);

    // AUSENTE ≠ ZERO — mesma régua do ISS: o que a pessoa não soube dizer fica
    // UNDEFINED, e o D190 sai sem afirmar base/alíquota que ninguém informou.
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

    // Na entrada quem emitiu foi o TRANSPORTADOR (a contraparte); na saída, a
    // própria empresa transportadora. Igual à espécie mercadoria.
    const emitente = i.direcao === 'entrada'
        ? { cnpjCpf: partDoc, nome: i.participanteNome, uf: (i.participanteUf || '').toUpperCase() }
        : { cnpjCpf: empresaCnpj, nome: i.empresaNome, uf: '' };
    const destinatario = i.direcao === 'entrada'
        ? { cnpjCpf: empresaCnpj, nome: i.empresaNome, uf: '' }
        : { cnpjCpf: partDoc, nome: i.participanteNome, uf: (i.participanteUf || '').toUpperCase() };

    return {
        id: idNotaDigitada(i),
        chave: chave.length === 44 ? chave : '',
        xmlHash: '',
        // O rótulo que `ehConhecimentoDeTransporte` lê.
        tipo: 'CTe',
        tipoDoc: 'CTe',
        modelo: t.modelo,
        serie: String(i.serie || '1').trim(),
        numero: String(i.numero).trim(),
        dhEmi: i.dhEmi,
        competencia,
        direcao: i.direcao,
        status: 'autorizado',
        empresaId: i.empresaId,
        empresaCnpj,
        empresaNome: i.empresaNome,
        emitente,
        destinatario,
        cnpjEmit: emitente.cnpjCpf,
        xNomeEmit: emitente.nome,
        ufEmit: emitente.uf,
        cnpjDest: destinatario.cnpjCpf,
        xNomeDest: destinatario.nome,
        ufDest: destinatario.uf,

        // 🚨 O CFOP na RAIZ é o que `cfopDoCte` lê primeiro.
        cfop: soDigitos(t.cfop),
        cstIcms: t.cst || undefined,
        aliqIcms: num(t.aliqIcms),
        natOp: t.descricao || 'Prestação de serviço de transporte',
        descricao: t.descricao,

        totais: {
            vNF: Number(i.valorTotal),
            vPrest: Number(i.valorTotal),
            vBC: num(t.vBC),
            vICMS: num(t.vICMS),
        },
        valorTotal: Number(i.valorTotal),
        // O CT-e não tem itens de produto — tem a prestação. O item único
        // carrega o CFOP para os leitores que agregam por item.
        itens: [{
            nItem: '1',
            cfop: soDigitos(t.cfop),
            xProd: t.descricao || 'Prestação de serviço de transporte',
            vProd: Number(i.valorTotal),
            cst: t.cst || undefined,
            vBC: num(t.vBC),
            vICMS: num(t.vICMS),
        }],
        // Só os tributos PREENCHIDOS entram — ver `retencaoFederalDigitada`.
        ...camposDaRetencaoDigitada(i.retencao),

        origem: 'digitada',
        createdBy: i.createdByUid || null,
        digitadaPorEmail: i.digitadaPorEmail,
        digitadaEm: new Date().toISOString(),
        importadoPorEmail: i.digitadaPorEmail,
    } as unknown as DocumentoFiscal;
}

/**
 * NFS-e digitada — nos MESMOS campos que `nfse-sp-csv-importer` grava.
 *
 * Nada de nomes novos: é essa igualdade que faz o painel 🏛️ ISS, o relatório
 * de Retenções, o R-2010/R-4020 e os livros enxergarem a nota sem uma linha de
 * código nova. Campo com nome próprio aqui viraria um segundo mundo que nenhum
 * relatório soma — o defeito da colcha, que é o que o CFI existe para acabar.
 */
function montarNfseDigitada(i: NotaDigitadaInput): DocumentoFiscal {
    const empresaCnpj = soDigitos(i.empresaCnpj);
    const partDoc = soDigitos(i.participanteDoc);
    const competencia = String(i.dhEmi).slice(0, 7);
    const ehPrestador = i.direcao === 'saida';
    const prestadorCnpj = ehPrestador ? empresaCnpj : partDoc;
    const prestadorNome = ehPrestador ? i.empresaNome : i.participanteNome;
    const tomadorCnpj = ehPrestador ? partDoc : empresaCnpj;
    const tomadorNome = ehPrestador ? i.participanteNome : i.empresaNome;
    const sv = i.servico || ({} as ServicoDigitado);

    // AUSENTE ≠ ZERO. Alíquota/ISS que a pessoa não soube dizer ficam
    // UNDEFINED, e o `iss-zerado-causa` os lê como "alíquota ausente" (que pede
    // conferência) em vez de "a nota diz que tributa e veio zero" (que é
    // inconsistência inventada). Zero só entra quando zero É a resposta.
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

    return {
        id: idNotaDigitada(i),
        chave: null,
        xmlHash: '',
        // `ehDocumentoDeServico` reconhece por AQUI — e é isso que impede a
        // nota de serviço de um prestador PF de virar FUNRURAL (15/08).
        tipo: 'NFSe',
        tipoDoc: 'NFSe',
        modelo: '99',
        serie: String(i.serie || '1').trim(),
        numero: String(i.numero).trim(),
        natOp: sv.codigoServico ? `Cód. serviço ${sv.codigoServico}` : 'Serviço NFS-e',
        dhEmi: i.dhEmi,
        competencia,
        direcao: i.direcao,
        status: 'autorizado',
        empresaId: i.empresaId,
        empresaCnpj,
        empresaNome: i.empresaNome,

        prestadorCnpj, prestadorNome,
        tomadorCnpj, tomadorNome,
        // Compat com o schema NF-e (o dashboard e metade dos leitores usam).
        cnpjEmit: prestadorCnpj,
        xNomeEmit: prestadorNome,
        cnpjDest: tomadorCnpj,
        xNomeDest: tomadorNome,
        emitente: { cnpjCpf: prestadorCnpj, nome: prestadorNome, uf: '' },
        destinatario: { cnpjCpf: tomadorCnpj, nome: tomadorNome, uf: '' },

        valorTotal: Number(i.valorTotal),
        valorServicos: Number(i.valorTotal),
        valorIss: num(sv.valorIss),
        issDevido: num(sv.valorIss),
        issRetido: !!sv.issRetido,
        aliquotaServicos: num(sv.aliquota),
        codigoServico: sv.codigoServico || undefined,
        descricao: sv.discriminacao,
        discriminacaoServicos: sv.discriminacao,
        totais: { vNF: Number(i.valorTotal), vServ: Number(i.valorTotal), vISS: num(sv.valorIss) },
        // Só os tributos PREENCHIDOS entram — ver `retencaoFederalDigitada`.
        ...camposDaRetencaoDigitada(i.retencao),

        origem: 'digitada',
        createdBy: i.createdByUid || null,
        digitadaPorEmail: i.digitadaPorEmail,
        digitadaEm: new Date().toISOString(),
        importadoPorEmail: i.digitadaPorEmail,
    } as unknown as DocumentoFiscal;
}

/**
 * Pode gravar por cima do que já existe?
 *
 * · nada lá → grava;
 * · lá está uma DIGITADA → regrava (corrigir digitação é o uso normal);
 * · lá está um doc COM XML → RECUSA com o estado dito: o documento vence o
 *   retrato, e a recusa aponta a saída (conferir/editar não é digitar de novo).
 */
export function podeGravarSobre(existente: { origem?: string; xmlHash?: string } | null | undefined):
    { ok: boolean; motivo?: string } {
    if (!existente) return { ok: true };
    if (existente.origem === 'digitada') return { ok: true };
    return {
        ok: false,
        motivo: 'Já existe este documento com XML no banco — o XML vence a digitação. '
            + 'Confira na Central de Documentos; se o XML estiver errado, o caminho é o ↻ Substituir da importação, não digitar por cima.',
    };
}

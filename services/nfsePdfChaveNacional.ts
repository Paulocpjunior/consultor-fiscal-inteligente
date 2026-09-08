/**
 * nfsePdfChaveNacional.ts — o que a CHAVE da NFS-e nacional já responde
 * quando o PDF não nomeia prestador nem tomador (PURO, testável).
 *
 * 🚨 O CASO (08/09, Paulo, LEGACY 0360 · 08/2026): *"quando importamos NFS em
 * PDF ele sobe sem CNPJ do prestador e tomador, apenas com valores, então no
 * relatório fica sem os dados"* — sete notas na lista com a contraparte
 * **"— -"**, e a mesma nota no modal com a **chave nacional preenchida** e os
 * dois blocos de participante VAZIOS.
 *
 * 📌 A CHAVE NÃO MENTE, e ela carrega o PRESTADOR: no padrão nacional a chave
 * tem 50 dígitos — `cMun (7) · ambiente (1) · tipo de inscrição (1) ·
 * inscrição federal (14) · número (15) · AAAAMM (4) · código (9)`... o que
 * importa aqui são as três primeiras partes e a inscrição, que é o CNPJ (ou o
 * CPF, com zeros à esquerda) de quem EMITIU — o prestador. É a MESMA leitura
 * que `nfse-nacional-leitura.js` faz do XML (a chave de 50 do `<infNFSe>`),
 * e a mesma disciplina do CT-e da A CASTELLANO: antes de pedir o dado ao
 * dono, perguntar se o app não o tem.
 *
 * ⚠️ E O TOMADOR NÃO ESTÁ NA CHAVE. O que se sabe é o que o prestador NÃO é:
 * se ele não é a empresa selecionada, a empresa só pode ser a TOMADORA — é a
 * única forma de a nota ser dela. Isso é DEDUÇÃO a partir de uma escolha
 * humana (a empresa do combo), então sai CARIMBADO (`tomadorOrigem:
 * 'empresa-selecionada'`) e a tela diz para conferir no papel. Nunca se
 * apresenta como lido do documento (o `csllOuTotal` com outra roupa).
 *
 * 📌 O QUE O PAPEL DISSE VENCE: participante que o leitor conseguiu ler não é
 * sobrescrito pela chave. Se os dois discordam, isso é AVISO — a chave não
 * mente, mas o leitor pode ter lido o bloco errado, e escolher em silêncio
 * seria decidir de quem é a nota sem ninguém ver.
 */

export interface ChaveNfseNacional {
    /** Município emissor (7 dígitos IBGE). */
    cMun: string;
    /** 1 = produção · 2 = homologação. */
    ambiente: string;
    /** 1 = CPF · 2 = CNPJ. */
    tpInsc: string;
    /** CNPJ (14) ou CPF (11), só dígitos — quem EMITIU (o prestador). */
    inscricaoEmitente: string;
    /** Número da NFS-e sem os zeros à esquerda. */
    numero: string;
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const raiz = (v: unknown) => soDigitos(v).slice(0, 8);

/**
 * Lê a chave de 50 dígitos do padrão nacional. Chave de outro tamanho (44 da
 * NF-e, ou nada) devolve null — nunca um pedaço de outra chave como CNPJ, que
 * foi exatamente o defeito de 02/09 (`\d{14}` casando o começo da chave).
 */
export function lerChaveNfseNacional(chave: unknown): ChaveNfseNacional | null {
    const c = soDigitos(chave);
    // A chave tem 50 dígitos; o nome do arquivo da DANFSe traz 53 (a chave
    // mais um sufixo), e o leitor captura os 50 primeiros. As posições que
    // importam são as 38 primeiras, iguais nas duas formas. Chave de 44 (NF-e)
    // ou menor não é deste padrão.
    if (c.length < 50 || c.length > 53) return null;
    const tpInsc = c[8];
    const insc14 = c.slice(9, 23);
    let inscricaoEmitente = '';
    if (tpInsc === '2') inscricaoEmitente = insc14;
    else if (tpInsc === '1') inscricaoEmitente = insc14.slice(-11);
    else return null;
    if (/^0+$/.test(inscricaoEmitente)) return null;
    return {
        cMun: c.slice(0, 7),
        ambiente: c[7],
        tpInsc,
        inscricaoEmitente,
        numero: c.slice(23, 38).replace(/^0+/, '') || '0',
    };
}

export type OrigemParticipantePdf = 'documento' | 'chave-nacional' | 'empresa-selecionada' | null;

export interface ParticipantesCompletados {
    prestadorCnpj: string;
    prestadorOrigem: OrigemParticipantePdf;
    tomadorCnpj: string;
    tomadorNome: string;
    tomadorOrigem: OrigemParticipantePdf;
    /** Direção que a chave + a empresa permitem afirmar; null quando não dá. */
    direcao: 'entrada' | 'saida' | null;
    /** O que a pessoa precisa saber antes de salvar — uma frase por fato. */
    avisos: string[];
}

/**
 * Completa prestador/tomador com o que a chave e a empresa selecionada
 * respondem — só o que está VAZIO, nunca por cima do que o papel disse.
 */
export function completarParticipantesDaNfsePdf(p: {
    prestadorCnpj?: string | null;
    tomadorCnpj?: string | null;
    tomadorNome?: string | null;
    chaveAcesso?: string | null;
    empresaCnpj: string;
    empresaNome?: string | null;
}): ParticipantesCompletados {
    const lidoPrest = soDigitos(p.prestadorCnpj);
    const lidoToma = soDigitos(p.tomadorCnpj);
    const empresa = soDigitos(p.empresaCnpj);
    const chave = lerChaveNfseNacional(p.chaveAcesso);
    const avisos: string[] = [];

    let prestadorCnpj = lidoPrest;
    let prestadorOrigem: OrigemParticipantePdf = lidoPrest ? 'documento' : null;
    if (chave) {
        if (!lidoPrest) {
            prestadorCnpj = chave.inscricaoEmitente;
            prestadorOrigem = 'chave-nacional';
            avisos.push('O PDF não nomeia o prestador — o CNPJ/CPF dele saiu da CHAVE NACIONAL '
                + '(quem emitiu a nota). O nome não está na chave: digite do papel.');
        } else if (raiz(lidoPrest) !== raiz(chave.inscricaoEmitente)) {
            avisos.push(`O prestador lido no papel (${lidoPrest}) não é o emitente da chave nacional `
                + `(${chave.inscricaoEmitente}). A chave não mente — confira se o leitor não pegou o bloco errado.`);
        }
    }

    let tomadorCnpj = lidoToma;
    let tomadorNome = String(p.tomadorNome || '').trim();
    let tomadorOrigem: OrigemParticipantePdf = lidoToma ? 'documento' : null;
    let direcao: 'entrada' | 'saida' | null = null;

    if (!empresa) {
        avisos.push('A empresa selecionada está sem CNPJ no cadastro — não dá para deduzir o tomador.');
        return { prestadorCnpj, prestadorOrigem, tomadorCnpj, tomadorNome, tomadorOrigem, direcao, avisos };
    }

    if (prestadorCnpj && raiz(prestadorCnpj) === raiz(empresa)) {
        direcao = 'saida';
    } else if (lidoToma && raiz(lidoToma) === raiz(empresa)) {
        direcao = 'entrada';
    } else if (prestadorCnpj && !lidoToma) {
        // O prestador é conhecido e NÃO é a empresa: a nota só é dela se ela
        // for a tomadora. Dedução a partir da escolha do combo — carimbada.
        tomadorCnpj = empresa;
        tomadorNome = String(p.empresaNome || '').trim();
        tomadorOrigem = 'empresa-selecionada';
        direcao = 'entrada';
        avisos.push('O PDF não nomeia o tomador — foi preenchido com a EMPRESA SELECIONADA, porque o '
            + 'prestador (da chave) não é ela. Confira no papel antes de salvar: se o tomador for outro, '
            + 'esta nota não é desta empresa.');
    }

    return { prestadorCnpj, prestadorOrigem, tomadorCnpj, tomadorNome, tomadorOrigem, direcao, avisos };
}

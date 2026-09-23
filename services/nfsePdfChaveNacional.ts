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
 * 📌 A CHAVE NÃO MENTE, e ela carrega o PRESTADOR: no padrão nacional ela tem
 * 50 dígitos, e o que importa aqui é a **inscrição federal** dentro dela — o
 * CNPJ (ou o CPF, com zeros à esquerda) de quem EMITIU, o prestador. O
 * leiaute campo a campo está no dono, MEDIDO. É a MESMA leitura
 * que `nfse-nacional-leitura.js` faz do XML (a chave de 50 do `<infNFSe>`),
 * e a mesma disciplina do CT-e da A CASTELLANO: antes de pedir o dado ao
 * dono, perguntar se o app não o tem.
 *
 * 🏠 A LEITURA DA CHAVE MUDOU DE CASA (10/09): ela mora no BACKEND
 * (`sefaz-backend/chave-nfse-nacional.js`), porque o importador de CSV do
 * portal de **Barueri** também precisa dela e backend não importa TS. Aqui só
 * se RE-EXPORTA — escrever a leitura de novo lá seria a segunda cópia da régua
 * que decide de quem é a nota. (Foi na mudança de casa que o `numero` da chave
 * apareceu ERRADO: eram 13 dígitos, não 15 — medido em 24 chaves reais.)
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

// A leitura da chave e o TIPO dela têm DONO ÚNICO no backend — o `.d.ts` ao
// lado do `.js` é o que faz o TypeScript enxergar. Re-exportado aqui para quem
// já importava deste módulo continuar funcionando.
import { lerChaveNfseNacional } from '../sefaz-backend/chave-nfse-nacional.js';

export { lerChaveNfseNacional };
export type { ChaveNfseNacional } from '../sefaz-backend/chave-nfse-nacional.js';

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const raiz = (v: unknown) => soDigitos(v).slice(0, 8);

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

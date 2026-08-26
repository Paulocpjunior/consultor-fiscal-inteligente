/**
 * services/livroNotaProdutor.ts — a compra de produtor rural tem DUAS notas, e
 * o livro só escritura UMA.
 *
 * Paulo, 12/08/2026, conferindo a VINCENZO GUERRA BANANAS 07/2026: o Livro de
 * Entradas trouxe OITO notas em pares de valor idêntico — 95/16 (5.200,00),
 * 96/17 (5.000,00), 97/18 (3.500,00), 98/19 (5.200,00) — totalizando 37.800,00
 * quando a entrada real do mês é 18.900,00. **O livro estava dobrado.**
 *
 * É a MESMA duplicidade que dobrou o FUNRURAL em 11/08 (par DAMIÃO × EDUARDO
 * GUERRA), agora aparecendo no livro: a NF-e do produtor (documento de ORIGEM,
 * CFOP de saída dele) e a nota própria de entrada que o cliente emite
 * (CFOP 1xxx, tpNF=0). O adquirente escritura SÓ a que ELE emitiu —
 * RICMS/SP art. 136, I, "a", confirmado pela RC 33068/2025.
 *
 * A correção existia desde 11/08 em `dipam-produtor-rural.js`
 * (`dedupNotaProdutorComEntrada`) e valia só para a aba 🌾. O Livro de Entradas
 * — que é o que vai ao SPED e ao papel — não a usava. Régua repetida é régua
 * que diverge; esta porta segue a MESMA regra, com teste travado nos números da
 * VINCENZO.
 *
 * ─── O QUE ESTE MÓDULO SE RECUSA A FAZER ────────────────────────────────────
 *
 * · NÃO exclui NF-e de produtor SEM par. Muitos clientes escrituram direto a
 *   nota do produtor (uma nota por operação — não dobra), e sumir com ela seria
 *   apagar entrada legítima do livro. A dedup desfaz DUPLICIDADE, não impõe
 *   processo.
 * · NÃO some com o que exclui: as notas saem do total e aparecem NOMEADAS.
 *   Total que muda sozinho faz desconfiar do número certo.
 * · NÃO adivinha participante. Sem CPF/CNPJ da contraparte não há como parear,
 *   e aí a nota fica no livro — errar para o lado de escriturar a mais é
 *   conferível; escriturar a menos, não.
 */

// O DONO da pergunta — a mesma régua que o SPED, o `.FML` e a DIPAM usam.
import { ehNotaPropriaDeEntrada as ehNotaPropriaDeEntradaDoc } from '../sefaz-backend/xml-metadata-helper.js';
// O LADO da contraparte tem dono — ver o comentário na função abaixo.
import { ladoDaContraparte } from '../sefaz-backend/participante-doc-helper.js';

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/**
 * Contraparte de um documento, lendo as DUAS formas que o banco tem.
 *
 * O importer PRINCIPAL (SEFAZ, cofre, XML manual) grava os participantes em
 * campos CHATOS (`cnpjEmit`, `xNomeEmit`…); `sync-routes` e o abrasf gravam
 * ANINHADO (`emitente`/`destinatario`). Ler só o aninhado é a armadilha que
 * mais mordeu este projeto — e é por isso que a coluna "Fornecedor/Remetente"
 * do livro saía toda com "—".
 */
export function contraparteNormalizada(d: any): { nome: string; doc: string; uf: string } {
    const temLado = (p: any) => !!(p && (p.cnpjCpf || p.cnpj || p.cpf || p.nome || p.razaoSocial));
    const emitente = temLado(d?.emitente) ? d.emitente : (temLado(d?.prestador) ? d.prestador : {
        cnpjCpf: d?.cnpjEmit || d?.cnpjEmitente || '',
        nome: d?.xNomeEmit || d?.nomeEmit || '',
        uf: d?.ufEmit || '',
    });
    const destinatario = temLado(d?.destinatario) ? d.destinatario : (temLado(d?.tomador) ? d.tomador : {
        cnpjCpf: d?.cnpjDest || d?.cnpjDestinatario || '',
        nome: d?.xNomeDest || d?.nomeDest || '',
        uf: d?.ufDest || '',
    });
    // 🚨 QUEM DECIDE O LADO É O DONO, não uma cópia (26/08). A cópia daqui
    // reconhecia a nota própria de entrada só por `tpNF === '0'`, SEM o laço
    // que o dono tem — e o comentário do próprio dono já diz por que ele
    // existe: *"a nota própria de entrada é emitida PELA EMPRESA. Sem esse
    // laço, o tpNF=0 de um TERCEIRO viraria 'nossa' nota própria — e a
    // contraparte sairia do lado errado"*.
    const p = ladoDaContraparte(d, d?.empresaCnpj) === 'destinatario' ? destinatario : emitente;
    return {
        nome: p?.nome || p?.razaoSocial || '',
        doc: soDigitos(p?.cnpjCpf || p?.cnpj || p?.cpf),
        uf: p?.uf || '',
    };
}

/**
 * É a nota que o PRÓPRIO cliente emitiu para dar entrada (RICMS art. 136)?
 *
 * 🚨 ESTA CÓPIA RESPONDIA O CONTRÁRIO DO DONO (22/08). Ela exigia
 * `direcao === 'entrada'` — e essa nota fica gravada como **'saida'** até o
 * backfill do sync-cron passar, que é justamente o caso que ela existe para
 * reconhecer. Efeito: **a dedup do art. 136 não rodava para nota nenhuma**
 * antes do backfill — a compra de produtor entrava DUAS vezes no livro (a nota
 * do produtor e a própria de entrada), que é exatamente o que a dedup impede.
 *
 * E era uma função com o **mesmo nome** do dono no backend, respondendo
 * diferente — o começo de duas respostas divergentes (a lição do
 * `perguntarDebitosJaEnviados`, 18/08). Agora ela delega.
 */
export function ehNotaPropriaDeEntrada(d: any): boolean {
    return !!(ehNotaPropriaDeEntradaDoc(d) as { sim: boolean })?.sim;
}

export interface NotaExcluidaDoLivro {
    numero: string;
    data: string;
    participante: string;
    valor: number;
    motivo: string;
}

export interface LivroSemDuplicidade<T> {
    linhas: T[];
    excluidas: NotaExcluidaDoLivro[];
}

/**
 * Tira do livro a NF-e do produtor quando existe a nota própria que a cobre.
 *
 * Pareia por CONTRAPARTE × VALOR: não há refNFe ligando as duas, e o valor é o
 * que a RC 33068/2025 descreve (a nota própria reproduz a operação). Sem valor
 * batendo, não pareia — melhor deixar as duas e o colaborador conferir do que
 * apagar a errada.
 *
 * @param docs      documentos de ENTRADA da competência
 * @param montar    monta a linha do livro a partir do documento
 * @param valorDe   valor contábil do documento (o mesmo que vai na coluna)
 */
export function livroSemNotaDeProdutorDuplicada<T>(
    docs: any[],
    montar: (d: any) => T,
    valorDe: (d: any) => number,
): LivroSemDuplicidade<T> {
    const lista = Array.isArray(docs) ? docs : [];
    const centavos = (v: number) => Math.round((Number(v) || 0) * 100);
    const chave = (d: any) => `${contraparteNormalizada(d).doc}|${centavos(valorDe(d))}`;

    // Quantas notas PRÓPRIAS de entrada existem por contraparte×valor: é o
    // "orçamento" de exclusão. Cada nota própria cobre UMA nota do produtor.
    const orcamento = new Map<string, number>();
    for (const d of lista) {
        if (!ehNotaPropriaDeEntrada(d)) continue;
        const k = chave(d);
        if (!contraparteNormalizada(d).doc) continue;   // sem contraparte não pareia
        orcamento.set(k, (orcamento.get(k) || 0) + 1);
    }

    const linhas: T[] = [];
    const excluidas: NotaExcluidaDoLivro[] = [];
    for (const d of lista) {
        if (ehNotaPropriaDeEntrada(d)) { linhas.push(montar(d)); continue; }
        const parte = contraparteNormalizada(d);
        const k = chave(d);
        if (parte.doc && (orcamento.get(k) || 0) > 0) {
            orcamento.set(k, (orcamento.get(k) as number) - 1);
            excluidas.push({
                numero: String(d?.numero ?? '—'),
                data: String(d?.dhEmi ?? '').slice(0, 10),
                participante: parte.nome || parte.doc || '—',
                valor: Number(valorDe(d)) || 0,
                motivo: 'NF-e do produtor: documento de ORIGEM. A escriturada é a nota própria de entrada '
                    + '(RICMS/SP art. 136, I, "a"; RC 33068/2025) — escriturar as duas dobra a entrada.',
            });
            continue;
        }
        linhas.push(montar(d));
    }
    return { linhas, excluidas };
}

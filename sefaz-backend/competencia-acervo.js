// ============================================================================
// sefaz-backend/competencia-acervo.js  (PURO)
// ----------------------------------------------------------------------------
// "Esta nota JÁ GRAVADA está no mês certo?" — a metade que faltou em 03/09.
//
// 🚨 O QUE FICOU ABERTO NAQUELE DIA, escrito com todas as letras: *"o ACERVO
// não se conserta sozinho. Nota já gravada com a competência da emissão
// continua no mês errado — e o `dataFatoGerador` ESTÁ no banco, então o app TEM
// como listar e corrigir. Mudar o mês de uma nota mexe em livro que pode já ter
// sido entregue, então isso é decisão do dono, caso a caso, nunca automática."*
//
// Este módulo é a LISTA e a DECISÃO; quem grava é a rota, num clique por nota.
//
// 🔴 O CUSTO DE DEIXAR COMO ESTÁ é o mais silencioso desta casa: a nota existe,
// está capturada, e **some do mês a que pertence** (Livro de Serviços, ISS da
// competência, bloco A do EFD-Contribuições) aparecendo no mês seguinte, onde
// não deveria estar. Não há erro na tela: há um livro a MENOS num mês e a MAIS
// no outro.
//
// ⚠️ SÓ ACUSA QUANDO OS DOIS MESES DIVERGEM. A maioria das notas antigas foi
// gravada pela emissão e está CERTA por construção — emitir e prestar no mesmo
// mês é o caso comum. Acusar todas encheria a fila de nota correta, que é o
// jeito conhecido de a equipe desligar a lista (a lição das 236 em ALTO, 26/08).
//
// ⚠️ E SÓ ALCANÇA DOCUMENTO DE SERVIÇO. Na NF-e e no CT-e a data de emissão É a
// competência — não existe "fato gerador" separado —, então perguntar ali seria
// inventar divergência (a mesma triagem que poupou o `xml-importer` em 03/09).
// ============================================================================
import { competenciaDaNfse } from './competencia-da-nfse.js';
import { ehNotaDeServico } from './sped-selecao-documentos.js';
import { docContaNoLivro } from './xml-metadata-helper.js';

/** Normaliza para 'AAAA-MM' o que já está gravado, aceitando as formas da casa. */
function mesGravado(v) {
    const t = String(v ?? '').trim();
    let m = /^(\d{4})-(\d{2})/.exec(t);
    if (m) return `${m[1]}-${m[2]}`;
    m = /^(\d{2})\/(\d{4})$/.exec(t);
    if (m) return `${m[2]}-${m[1]}`;
    m = /^(\d{4})(\d{2})$/.exec(t);
    if (m) return `${m[1]}-${m[2]}`;
    return '';
}

function mesPorExtenso(iso) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${m[2]}/${m[1]}` : String(iso || '—');
}

/**
 * Classifica UMA nota do acervo.
 *
 * Devolve sempre `{ situacao, ... }`, nunca lança — uma nota torta não pode
 * derrubar a varredura da carteira inteira.
 *
 * Situações:
 * · `fora-do-escopo`     — não é documento de serviço, ou foi tirada do livro;
 * · `sem-fato-gerador`   — o documento não traz a data, então não há o que
 *                          comparar (a emissão continua respondendo);
 * · `ilegivel`           — nem competência nem datas legíveis: o caminho é
 *                          reimportar, não mexer no mês;
 * · `ja-corrigida`       — alguém já decidiu esta nota; não reoferece;
 * · `confere`            — o mês gravado é o que a régua diria hoje;
 * · `mes-errado`         — é O caso: a nota está declarada no mês errado.
 */
export function classificarCompetenciaDoAcervo(doc) {
    const d = doc || {};

    if (!ehNotaDeServico(d) || !docContaNoLivro(d)) {
        return { situacao: 'fora-do-escopo', precisaCorrigir: false };
    }
    if (d?.competenciaCorrigida?.em) {
        return {
            situacao: 'ja-corrigida',
            precisaCorrigir: false,
            competenciaGravada: mesGravado(d.competencia) || null,
            corrigidaPor: d.competenciaCorrigida.porEmail || null,
            corrigidaEm: d.competenciaCorrigida.em || null,
        };
    }

    const regua = competenciaDaNfse({
        // ⚠️ A competência DECLARADA pelo documento não entra aqui, e isso é
        // decisão: ela é o campo do próprio papel, e o que está gravado hoje já
        // pode ser ela. Quem desempata o acervo é o FATO GERADOR contra a
        // EMISSÃO, que é o par que produziu o defeito.
        dataFatoGerador: d.dataFatoGerador,
        dataEmissao: d.dhEmi || d.dataEmissao,
    });

    const gravada = mesGravado(d.competencia);
    const certa = regua.competencia;

    if (!certa) {
        return {
            situacao: 'ilegivel',
            precisaCorrigir: false,
            competenciaGravada: gravada || null,
            motivo: regua.motivo,
        };
    }
    if (regua.origem !== 'fato-gerador') {
        return {
            situacao: 'sem-fato-gerador',
            precisaCorrigir: false,
            competenciaGravada: gravada || null,
            motivo: 'O documento não traz data de fato gerador, então não há como saber se o mês '
                + 'gravado é o da prestação. A emissão continua respondendo.',
        };
    }
    if (gravada === certa) {
        return { situacao: 'confere', precisaCorrigir: false, competenciaGravada: gravada };
    }

    return {
        situacao: 'mes-errado',
        precisaCorrigir: true,
        competenciaGravada: gravada || null,
        competenciaCerta: certa,
        motivo: `O serviço foi prestado em ${mesPorExtenso(certa)} (fato gerador) e a nota está `
            + `declarada em ${mesPorExtenso(gravada) || 'nenhum mês'}. Ela some do Livro de Serviços, do ISS `
            + `e do bloco A de ${mesPorExtenso(certa)} e aparece em ${mesPorExtenso(gravada)}, onde não deveria estar.`,
        consequencia: `Corrigir muda os DOIS meses: ${mesPorExtenso(gravada)} perde esta nota e `
            + `${mesPorExtenso(certa)} ganha. Se algum dos dois já foi entregue, o arquivo daquele mês precisa `
            + `ser regerado e conferido — o app não sabe quais competências foram transmitidas.`,
    };
}

/**
 * A fila da empresa: só as notas que PRECISAM de decisão, com os contadores do
 * que ficou de fora e POR QUÊ.
 *
 * 📌 O que fica de fora sai CONTADO, nunca sumido: "12 notas conferem" e "12
 * notas não têm fato gerador" pedem leituras diferentes, e uma fila que só
 * mostra o problema faz quem olha achar que o resto nem foi examinado.
 */
export function montarFilaCompetencia(documentos) {
    const docs = Array.isArray(documentos) ? documentos : [];
    const paraCorrigir = [];
    const contagem = {
        examinadas: 0, conferem: 0, semFatoGerador: 0,
        ilegiveis: 0, jaCorrigidas: 0, foraDoEscopo: 0,
    };

    for (const d of docs) {
        const r = classificarCompetenciaDoAcervo(d);
        if (r.situacao === 'fora-do-escopo') { contagem.foraDoEscopo++; continue; }
        contagem.examinadas++;
        if (r.situacao === 'confere') { contagem.conferem++; continue; }
        if (r.situacao === 'sem-fato-gerador') { contagem.semFatoGerador++; continue; }
        if (r.situacao === 'ilegivel') { contagem.ilegiveis++; continue; }
        if (r.situacao === 'ja-corrigida') { contagem.jaCorrigidas++; continue; }
        paraCorrigir.push({
            id: d.id || null,
            numero: d.numero || d.numeroNota || null,
            prestador: d.prestadorNome || d.xNomeEmit || d.emitente?.nome || null,
            valor: d.valorServicos ?? d.valorTotal ?? null,
            ...r,
        });
    }

    // A mais antiga primeiro: é ela que está há mais tempo no mês errado, e é
    // dela que o livro já entregue tem mais chance de depender.
    paraCorrigir.sort((a, b) => String(a.competenciaCerta).localeCompare(String(b.competenciaCerta)));

    return {
        paraCorrigir,
        contagem,
        // 🚨 FILA VAZIA NÃO É "ESTÁ TUDO CERTO" quando nada foi examinado: sem
        // documento de serviço a resposta é sobre a AUSÊNCIA de notas, não
        // sobre a saúde do acervo (a régua do farol honesto).
        resumo: contagem.examinadas === 0
            ? 'Nenhum documento de serviço nesta busca — não há competência para conferir.'
            : paraCorrigir.length === 0
                ? `${contagem.examinadas} nota(s) de serviço examinada(s): nenhuma está no mês errado.`
                : `${paraCorrigir.length} nota(s) declarada(s) no mês errado, de ${contagem.examinadas} examinada(s).`,
    };
}

/**
 * O patch da correção. **Não grava** — quem grava é a rota.
 *
 * ⚠️ AUTOR E MOTIVO SÃO OBRIGATÓRIOS, e o piso de 15 caracteres é o mesmo da
 * T3 da DCTFWeb e da reabertura do fim de mês: mudar o mês de uma nota é
 * decisão, e daqui a três meses ninguém lembra por que aquele mês mudou.
 *
 * ⚠️ E A COMPETÊNCIA ANTIGA FICA GUARDADA: sem ela não há como responder
 * depois *"este livro foi gerado antes ou depois da correção?"*.
 */
export function patchCorrecaoCompetencia({ doc, porEmail, motivo, agoraIso } = {}) {
    const r = classificarCompetenciaDoAcervo(doc);
    if (!r.precisaCorrigir) {
        return { ok: false, erro: `Esta nota não está no mês errado (situação: ${r.situacao}).` };
    }
    const autor = String(porEmail ?? '').trim();
    if (!autor) {
        return { ok: false, erro: 'Falta quem está corrigindo — decisão que muda mês de livro não é clique anônimo.' };
    }
    const texto = String(motivo ?? '').trim();
    if (texto.length < 15) {
        return { ok: false, erro: 'Escreva o motivo da correção (mínimo 15 caracteres).' };
    }

    return {
        ok: true,
        de: r.competenciaGravada,
        para: r.competenciaCerta,
        patch: {
            competencia: r.competenciaCerta,
            competenciaOrigem: 'fato-gerador',
            competenciaCorrigida: {
                de: r.competenciaGravada,
                para: r.competenciaCerta,
                porEmail: autor,
                motivo: texto,
                em: agoraIso || new Date().toISOString(),
            },
        },
    };
}

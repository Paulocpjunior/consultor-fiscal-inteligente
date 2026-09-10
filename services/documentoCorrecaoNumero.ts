/**
 * documentoCorrecaoNumero.ts — corrigir o NÚMERO de uma nota digitada (PURO).
 *
 * 🚨 O CASO (10/09, Paulo, HANAMI EMBALAGENS · NF-e de saída lançada à mão):
 * *"precisava fazer uma correção em uma nota q eu lancei manualmente … O
 * correto seria 9792, oq eu posso fazer nesse caso?"* — ela está gravada como
 * **792**.
 *
 * ═══ O QUE ELE IA ENCONTRAR, E POR QUE ERA UMA ARMADILHA ════════════════════
 *
 * O ✍️ Lançar nota sem XML tem id DETERMINÍSTICO e diz, ao regravar, *"Nota nº
 * X REGRAVADA (corrigiu a digitação anterior)"*. **Isso é verdade para todo
 * campo MENOS três** — número, série e a competência da emissão —, porque são
 * eles que formam o id:
 *
 *     digitada_{empresaId}_{numero}_{serie}_{AAAA-MM}   ·   nfsesp-{tom}-{pre}-{numero}
 *
 * Relançar a mesma nota com **9792** monta um id DIFERENTE ⇒ nasce um SEGUNDO
 * documento, e a nota 792 continua lá. A partir daí a mesma venda conta **duas
 * vezes** no Livro, no Resumo por CFOP, na competência, no faturamento e no
 * bloco C/A do SPED — e **nenhum validador acusa**, porque os dois documentos
 * são formalmente corretos (é a duplicidade que o `duplicatasNasLinhas` já
 * denunciava no Relatório de Retenções, 04/09, agora pela porta da digitação).
 *
 * 🚨 E O CAMINHO QUE RESOLVIA TINHA O NOME ERRADO: existe o botão de retirada
 * (03/09), mas ele se chama *"Esta nota não é desta empresa"* — **falso aqui**.
 * A nota É da empresa; o número é que está errado. Quem lê aquilo conclui, com
 * razão, que o botão não serve — é o achado 18 (21/08) na forma mais cara: a
 * saída existe, funciona, e o rótulo dela diz que não serve.
 *
 * ═══ A DECISÃO: UM ATO SÓ, NUNCA DOIS PASSOS ═══════════════════════════════
 *
 * Corrigir o número **grava a nota certa e enterra a errada no MESMO ato**.
 * Deixar isso como procedimento ("relance e depois tire a antiga") é apostar
 * que ninguém vai esquecer a segunda metade — e a metade esquecida é justamente
 * a que duplica o faturamento.
 *
 * ─── AS TRAVAS ──────────────────────────────────────────────────────────────
 *
 * 1. **SÓ NOTA DIGITADA.** Documento com XML tem o número que o documento
 *    declara; corrigi-lo aqui seria reescrever a nota do cliente. A recusa
 *    aponta o caminho certo (o ↻ Substituir da importação).
 *
 * 2. **COM CHAVE DE 44, O NÚMERO NÃO SE CORRIGE** — ele está DENTRO da chave
 *    (posições 26-34), e um número que contradiz a chave é uma nota que se
 *    desmente. Quem manda é a chave (a régua do `serieDoDocumento`, 21/08).
 *
 * 3. **COLISÃO NO DESTINO RECUSA NOMEANDO.** Se já existe documento no id
 *    novo, gravar por cima apagaria uma nota legítima — ou, se for a mesma nota
 *    já relançada, o que existe é a DUPLICATA, e a recusa manda tirá-la em vez
 *    de sobrescrever.
 *
 * 4. **AUTOR OBRIGATÓRIO** (a régua da retirada, do ajuste de retenção e da
 *    reabertura do fim de mês): reescrever a identidade de um documento fiscal
 *    sem quem/quando não se reconstrói depois.
 *
 * 5. **A LÁPIDE É A MESMA `_deleted`** que toda listagem já filtra desde 24/07.
 *    Um segundo mecanismo de "sumir da lista" seria a segunda cópia, e o
 *    primeiro leitor que não o conhecesse contaria a nota duas vezes — que é
 *    exatamente o defeito que este módulo existe para impedir.
 */

import { idDigitadaSemChave } from './notaDigitada';
import { idDocumentoNfseSp } from '../sefaz-backend/nfse-identidade.js';

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

export interface DocumentoParaCorrigir {
    id?: string | null;
    numero?: string | null;
    serie?: string | null;
    chave?: string | null;
    origem?: string | null;
    tipo?: string | null;
    tipoDoc?: string | null;
    empresaId?: string | null;
    empresaNome?: string | null;
    competencia?: string | null;
    dhEmi?: string | null;
    /** NFS-e identifica-se por tomador+prestador+número. */
    prestadorCnpj?: string | null;
    tomadorCnpj?: string | null;
    /** Quem criou o documento — a regra do Firestore confere isto no CREATE. */
    createdBy?: string | null;
    _deleted?: boolean;
}

export interface CorrecaoRecusada {
    ok: false;
    motivo: string;
}

export interface CorrecaoAceita {
    ok: true;
    /**
     * `patch`         → número/série não fazem parte do id (NFS-e com série
     *                   trocada): troca os campos NO MESMO documento.
     * `novo-documento`→ o id muda: grava a nota certa e enterra a errada.
     */
    modo: 'patch' | 'novo-documento';
    idNovo: string;
    numeroNovo: string;
    serieNova: string;
    /** O que muda no documento que passa a valer. */
    patchNovo: Record<string, unknown>;
    /** A lápide do documento errado — só no modo `novo-documento`. */
    patchAntigo: Record<string, unknown> | null;
    avisoDepois: string;
}

export type Correcao = CorrecaoAceita | CorrecaoRecusada;

/** O id que este documento teria com outro número/série. */
export function idComOutroNumero(
    doc: DocumentoParaCorrigir,
    numero: string,
    serie: string,
): string | null {
    const ehServico = ['NFSe', 'NFS-e', 'nfseNacional'].includes(String(doc.tipoDoc || doc.tipo || ''));
    if (ehServico) {
        // A MESMA fórmula que os importadores de NFS-e usam — nunca uma cópia:
        // divergindo um caractere, a captura futura criaria um segundo
        // documento e o serviço entraria duas vezes no livro e no ISS.
        try {
            return idDocumentoNfseSp({
                prestadorCnpj: doc.prestadorCnpj,
                tomadorCnpj: doc.tomadorCnpj,
                numero,
            });
        } catch {
            return null;
        }
    }
    const empresaId = String(doc.empresaId || '').trim();
    const comp = String(doc.competencia || String(doc.dhEmi || '').slice(0, 7)).trim();
    if (!empresaId || !comp) return null;
    return idDigitadaSemChave(empresaId, numero, serie, comp);
}

/**
 * Decide se dá para corrigir o número/série, e monta o que grava.
 *
 * @param doc            o documento como está no banco
 * @param numeroNovo     o número certo
 * @param serieNova      a série (em branco mantém a atual)
 * @param autor          quem está corrigindo
 * @param existeNoDestino o que a casca achou no id novo (null = nada lá)
 * @param agora          injetável nos testes
 */
export function corrigirNumeroDaNotaDigitada(
    doc: DocumentoParaCorrigir | null | undefined,
    numeroNovo: string,
    serieNova: string,
    autor: { uid?: string | null; email?: string | null } | null | undefined,
    existeNoDestino: { origem?: string | null; numero?: string | null } | null | undefined,
    agora: Date = new Date(),
): Correcao {
    if (!doc || !doc.id) {
        return { ok: false, motivo: 'Documento não identificado — recarregue a lista e tente de novo.' };
    }
    if (doc._deleted) {
        return {
            ok: false,
            motivo: 'Esta nota já foi tirada do livro desta empresa — ela não conta mais aqui. '
                + 'Lance a nota certa pelo ✍️ Lançar nota sem XML.',
        };
    }
    // 🚨 O NÚMERO DO DOCUMENTO É DO DOCUMENTO. Corrigi-lo numa nota que tem XML
    // seria reescrever a nota do cliente — e o XML vence a digitação sempre.
    if (String(doc.origem || '') !== 'digitada') {
        return {
            ok: false,
            motivo: 'Esta nota veio de um XML/PDF, e o número é o que o próprio documento declara — '
                + 'o app não reescreve documento capturado. Se o arquivo importado estiver errado, '
                + 'o caminho é reimportar o certo com "↻ Substituir os que já estão no banco".',
        };
    }
    // A chave carrega o número nas posições 26-34: corrigir um sem o outro
    // produz uma nota que se desmente por dentro.
    const chave = soDigitos(doc.chave);
    if (chave.length === 44) {
        return {
            ok: false,
            motivo: 'Esta nota foi lançada COM a chave de acesso, e a chave já declara o número dela — '
                + 'mudar só o número deixaria os dois se contradizendo. Se a chave estiver errada, '
                + 'a nota é outra: tire esta do livro e lance a certa.',
        };
    }

    const numero = String(numeroNovo || '').trim();
    const serie = String(serieNova || '').trim() || String(doc.serie || '1').trim();
    if (!numero) return { ok: false, motivo: 'Informe o número certo da nota.' };
    if (numero.length > 20) return { ok: false, motivo: 'Número muito longo — confira o que foi digitado.' };

    const numeroAtual = String(doc.numero || '').trim();
    const serieAtual = String(doc.serie || '1').trim();
    if (numero === numeroAtual && serie === serieAtual) {
        return {
            ok: false,
            motivo: `A nota já está gravada como nº ${numeroAtual}, série ${serieAtual} — não há o que corrigir.`,
        };
    }

    const uid = String(autor?.uid || '').trim();
    const email = String(autor?.email || '').trim();
    if (!uid && !email) {
        return {
            ok: false,
            motivo: 'Sessão expirada — saia e entre de novo. A correção fica gravada com quem a fez, '
                + 'e sem isso ela não pode ser registrada.',
        };
    }

    const idNovo = idComOutroNumero(doc, numero, serie);
    if (!idNovo) {
        return {
            ok: false,
            motivo: 'Não deu para montar a identidade da nota corrigida (falta empresa, competência ou '
                + 'as partes do serviço). Tire esta nota do livro e lance a certa pelo ✍️.',
        };
    }

    const mudaId = idNovo !== String(doc.id);

    // 🚨 O DOCUMENTO NOVO É UM **CREATE**, e a regra do Firestore exige
    // `createdBy == request.auth.uid` — foi ela que fez o ✍️ nunca gravar até
    // 17/08. Sem o uid, a gravação voltaria como "Missing or insufficient
    // permissions", que manda procurar um problema de permissão que não existe.
    if (mudaId && !uid) {
        return {
            ok: false,
            motivo: 'Sessão expirada — saia e entre de novo. A nota corrigida é gravada em seu nome, '
                + 'e sem isso o banco recusa a gravação.',
        };
    }

    // 🚨 GRAVAR POR CIMA DE DOCUMENTO QUE JÁ EXISTE APAGARIA UMA NOTA LEGÍTIMA
    // — ou, se for esta mesma nota já relançada, o que está lá é a DUPLICATA, e
    // a ação certa é tirar uma das duas, não sobrescrever.
    if (mudaId && existeNoDestino) {
        return {
            ok: false,
            motivo: `Já existe uma nota nº ${numero} nesta empresa e competência. `
                + 'Se você já a relançou, ela é a certa — o que sobra é esta nº ' + numeroAtual
                + ', que precisa sair do livro pelo botão "🚫 Tirar esta nota do livro" aqui embaixo '
                + '(senão a mesma venda conta duas vezes).',
        };
    }

    const quando = agora.toISOString();
    const carimbo = {
        numero,
        serie,
        correcaoNumero: {
            deNumero: numeroAtual,
            deSerie: serieAtual,
            paraNumero: numero,
            paraSerie: serie,
            em: quando,
            porEmail: email || null,
            porUid: uid || null,
            documentoAnterior: mudaId ? String(doc.id) : null,
            // O rastro de quem DIGITOU a nota não se perde: `digitadaPorEmail`
            // e `digitadaEm` viajam no documento, e o dono original fica aqui.
            createdByOriginal: doc.createdBy ?? null,
        },
    };

    if (!mudaId) {
        // Número/série não entram no id (NFS-e com série trocada): é troca de
        // campo no MESMO documento — nada nasce, nada é enterrado.
        return {
            ok: true,
            modo: 'patch',
            idNovo,
            numeroNovo: numero,
            serieNova: serie,
            patchNovo: carimbo,
            patchAntigo: null,
            avisoDepois: `Nota corrigida: nº ${numeroAtual} → ${numero}. `
                + 'Ela continua sendo o MESMO documento — livros, relatórios e SPED já leem o número novo.',
        };
    }

    return {
        ok: true,
        modo: 'novo-documento',
        idNovo,
        numeroNovo: numero,
        serieNova: serie,
        // O documento inteiro é recopiado pela casca; aqui vão os campos que
        // mudam mais o carimbo do de-para. ⚠️ `createdBy` passa a ser de quem
        // CORRIGE porque é quem cria este documento — e é o que a regra do
        // Firestore confere. O digitador original continua registrado em
        // `digitadaPorEmail` e em `correcaoNumero.createdByOriginal`.
        patchNovo: { ...carimbo, id: idNovo, createdBy: uid },
        // A MESMA lápide de 24/07 — é ela que toda listagem já filtra. Um
        // segundo mecanismo de "sumir da lista" seria a segunda cópia.
        patchAntigo: {
            _deleted: true,
            _deletedEm: quando,
            _deletedPor: uid || null,
            _deletedPorEmail: email || null,
            _deletedMotivo: `Número corrigido de ${numeroAtual} para ${numero}`
                + (serie !== serieAtual ? ` (série ${serieAtual} → ${serie})` : '')
                + ' — o documento que vale é o de número novo.',
            _corrigidaPara: idNovo,
            _corrigidaParaNumero: numero,
        },
        avisoDepois: `Nota corrigida: nº ${numeroAtual} → ${numero}`
            + (serie !== serieAtual ? ` · série ${serieAtual} → ${serie}` : '')
            + `. A nota nº ${numeroAtual} saiu do livro de ${doc.empresaNome || 'esta empresa'} no mesmo ato, `
            + 'então a venda NÃO conta duas vezes. O documento antigo não foi apagado: ele fica registrado '
            + 'apontando para o novo.',
    };
}

/**
 * A frase do estado, para a nota que foi substituída por uma corrigida.
 *
 * ⚠️ Ela existe porque `explicarRetirada` diria *"tirada desta empresa"*, e
 * isso é FALSO aqui: a nota não saiu da empresa — ela virou outro número. Dizer
 * a causa errada manda procurar no lugar errado.
 */
export function explicarCorrecao(doc: {
    _deleted?: boolean;
    _corrigidaPara?: string | null;
    _corrigidaParaNumero?: string | null;
    _deletedEm?: string | null;
    _deletedPorEmail?: string | null;
    numero?: string | null;
} | null | undefined): string | null {
    if (!doc?._deleted || !doc?._corrigidaPara) return null;
    const quando = doc._deletedEm ? new Date(doc._deletedEm) : null;
    const data = quando && !Number.isNaN(quando.getTime()) ? quando.toLocaleDateString('pt-BR') : null;
    return `Esta nota foi CORRIGIDA${data ? ` em ${data}` : ''}`
        + `${doc._deletedPorEmail ? ` por ${doc._deletedPorEmail}` : ''}`
        + `${doc._corrigidaParaNumero ? `: o número certo é ${doc._corrigidaParaNumero}` : ''}. `
        + 'Ela não conta mais no livro; quem conta é a nota corrigida. O documento continua guardado.';
}

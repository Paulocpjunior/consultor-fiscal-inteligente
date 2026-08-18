// ============================================================================
// sefaz-backend/whatsapp-import-lote.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// IMPORTAÇÃO EM LOTE DO BACKUP DA ULTRA FOX (Paulo, 18/08: *"pode
// construir"*). O export chegou com ~800 MB e esta forma, conferida nos
// prints dele — não deduzida:
//
//   bot-131293-17082026233001/
//   ├── _files/                        ← toda a mídia, numa pasta só e achatada
//   └── whatsapp/
//       └── 551133371554/              ← o número do ESCRITÓRIO
//           └── 14074950699/           ← uma pasta por CONTATO
//               ├── _full-chat.txt     ← a conversa inteira
//               └── 554584868/         ← um atendimento (protocolo?)
//                   └── _chat.txt
//
// POR QUE O ARQUIVO A IMPORTAR É O `_full-chat.txt`:
// o SP Connect modela UMA conversa por número (o cliente tem um chat no
// celular), e é isso que o full-chat é. Os `_chat.txt` das subpastas contêm
// AS MESMAS mensagens recortadas por atendimento — importar os dois seria a
// mesma mensagem duas vezes. O id determinístico as colapsaria, mas contar
// com isso é rede de segurança, não plano.
//
// ⚠️ **E O QUE NÃO ENTRA VAI CONTADO, NUNCA ENGOLIDO**: subpasta ignorada,
// arquivo fora do padrão e número ilegível voltam nomeados. Contador mudo é o
// que faz alguém achar que importou tudo (a lição do "0 recuperadas · 664 já
// tinham" da releitura de participantes).
//
// 🌍 **O NOME DA PASTA É O IDENTIFICADOR DO WHATSAPP E ENTRA COMO ESTÁ.** Foi
// este backup que revelou os clientes de fora do Brasil (Angola, Moçambique,
// EUA) e o defeito de produção que reescrevia o destino do envio. Aqui vale a
// mesma régua: quem escreveu o número foi a Meta — completar 55 é justamente
// a operação errada.
// ============================================================================

import { numeroCanonicoWhatsapp } from './whatsapp-cloud.js';

/** Nome do arquivo que carrega a conversa INTEIRA de um contato. */
export const ARQUIVO_CONVERSA = '_full-chat.txt';
/** Nome do arquivo de UM atendimento (dentro da pasta do protocolo). */
export const ARQUIVO_ATENDIMENTO = '_chat.txt';

const partes = (caminho) => String(caminho || '').split('/').filter(Boolean);

/**
 * Classifica os caminhos do backup SEM ler conteúdo.
 *
 * A leitura é POSICIONAL A PARTIR DO FIM, de propósito: a pessoa pode escolher
 * a pasta do contato, a do número do escritório, a `whatsapp/` ou a raiz do
 * zip — e o prefixo muda em cada caso. Amarrar na profundidade absoluta faria
 * a varredura devolver ZERO em silêncio dependendo de onde ela clicou, que é
 * exatamente o modo de falha que este projeto mais paga.
 *
 * QUEM É CONTATO se decide pelos fatos, não por posição: contato é a pasta que
 * tem `_full-chat.txt`. Isso resolve a ambiguidade real — `551133371554/
 * 14074950699/_chat.txt` tem duas leituras possíveis (contato com atendimento
 * único × protocolo de um contato), e as duas pastas são numéricas.
 */
export function mapearArquivosDoBackup(caminhos = []) {
    const lista = (Array.isArray(caminhos) ? caminhos : []).map(String);

    // 1ª passada: quem tem _full-chat.txt É contato.
    const contatos = new Set();
    for (const c of lista) {
        const p = partes(c);
        if (p[p.length - 1] === ARQUIVO_CONVERSA && p.length >= 2) contatos.add(p[p.length - 2]);
    }

    const conversas = [];
    const atendimentos = [];
    const semDono = [];
    const ignorados = [];

    for (const caminho of lista) {
        const p = partes(caminho);
        const arquivo = p[p.length - 1];
        const pai = p[p.length - 2] || null;
        const avo = p[p.length - 3] || null;

        if (arquivo === ARQUIVO_CONVERSA) {
            const numero = numeroCanonicoWhatsapp(pai);
            if (!numero) { ignorados.push({ caminho, motivo: `pasta "${pai}" não é um número de WhatsApp` }); continue; }
            conversas.push({ numero, caminho });
            continue;
        }

        if (arquivo === ARQUIVO_ATENDIMENTO) {
            // O dono é o ANCESTRAL que já se provou contato. Se o avô é
            // contato, o pai é o protocolo daquele atendimento.
            if (avo && contatos.has(avo)) {
                atendimentos.push({ numero: numeroCanonicoWhatsapp(avo), protocolo: pai, caminho });
                continue;
            }
            // Sem full-chat em lugar nenhum da linhagem, o histórico deste
            // contato SÓ existe aqui — deixar de fora apagaria a conversa. Vai
            // como conversa, mas MARCADO: é suposição, e suposição se declara.
            const numero = numeroCanonicoWhatsapp(pai);
            if (!numero) { ignorados.push({ caminho, motivo: `pasta "${pai}" não é um número de WhatsApp` }); continue; }
            semDono.push({ numero, caminho });
            continue;
        }

        ignorados.push({ caminho, motivo: 'arquivo fora do padrão do export' });
    }

    return { conversas, atendimentos, semDono, ignorados };
}

/**
 * O que a tela precisa LER antes de gravar qualquer coisa: quantos arquivos
 * de cada tipo, e o alerta quando a varredura não achou nada.
 *
 * "Zero conversas" NÃO é resultado neutro: ou a pasta escolhida está errada,
 * ou o export tem outra forma. Dizer isso é o que impede a pessoa de concluir
 * que o backup estava vazio.
 */
export function resumoDaVarredura(mapa) {
    const m = mapa || { conversas: [], atendimentos: [], semDono: [], ignorados: [] };
    const arquivosParaLer = m.conversas.length + m.semDono.length;
    const avisos = [];
    if (!arquivosParaLer) {
        avisos.push(`Nenhum ${ARQUIVO_CONVERSA} encontrado. Escolha a pasta que contém as pastas por número `
            + `(ex.: a pasta do número do escritório, dentro de "whatsapp") — ou o export tem outra forma, e aí me diga.`);
    }
    if (m.atendimentos.length) {
        avisos.push(`${m.atendimentos.length} arquivo(s) de atendimento por protocolo NÃO serão importados: `
            + `as mesmas mensagens já estão no ${ARQUIVO_CONVERSA} de cada contato.`);
    }
    if (m.semDono.length) {
        avisos.push(`${m.semDono.length} conversa(s) só têm ${ARQUIVO_ATENDIMENTO} (sem ${ARQUIVO_CONVERSA}) — `
            + `entram assim mesmo, senão o histórico delas sumiria.`);
    }
    return {
        contatos: new Set([...m.conversas, ...m.semDono].map((x) => x.numero)).size,
        arquivosParaLer,
        atendimentosIgnorados: m.atendimentos.length,
        foraDoPadrao: m.ignorados.length,
        avisos,
    };
}

/**
 * Junta as leituras de vários arquivos numa PRÉVIA só.
 *
 * `lidos` = [{ numero, mensagens: [{em, autor, texto}], autores: [], descartadas: [] }]
 * — cada item vem do `interpretarConversaTxt`, que é o parser que já existe
 * (segunda cópia dele seria a divergência de sempre).
 *
 * 🚨 **OS AUTORES SÃO A PERGUNTA CENTRAL** e por isso vêm com CONTAGEM: a
 * direção de cada mensagem depende de quem é do escritório, e essa é escolha
 * humana (regra do importador desde o começo). Num lote de centenas de
 * arquivos a lista de autores é grande, então ordená-la por volume é o que
 * torna a decisão possível — os quatro ou cinco primeiros nomes respondem por
 * quase tudo.
 */
export function consolidarPrevia(lidos = []) {
    const porAutor = new Map();
    let mensagens = 0;
    let descartadas = 0;
    const conversas = new Set();
    let semMensagem = 0;

    for (const l of (Array.isArray(lidos) ? lidos : [])) {
        const msgs = Array.isArray(l?.mensagens) ? l.mensagens : [];
        if (l?.numero) conversas.add(l.numero);
        if (!msgs.length) semMensagem += 1;
        mensagens += msgs.length;
        descartadas += Array.isArray(l?.descartadas) ? l.descartadas.length : 0;
        for (const m of msgs) {
            const a = String(m?.autor || '').trim();
            if (!a) continue;
            porAutor.set(a, (porAutor.get(a) || 0) + 1);
        }
    }

    const autores = [...porAutor.entries()]
        .map(([autor, total]) => ({ autor, total }))
        .sort((a, b) => b.total - a.total || a.autor.localeCompare(b.autor));

    return {
        conversas: conversas.size,
        mensagens,
        descartadas,
        // Arquivo lido e sem NENHUMA mensagem reconhecida é sinal de formato
        // diferente do esperado — some da conta, não da tela.
        arquivosSemMensagem: semMensagem,
        autores,
    };
}

/** Limite por requisição — o corpo do POST tem teto, e lote gigante estoura. */
export const MENSAGENS_POR_ENVIO = 2000;

/**
 * Divide as conversas lidas em BLOCOS que cabem numa requisição.
 *
 * Uma conversa NUNCA é partida entre dois blocos sem necessidade, mas conversa
 * maior que o teto é fatiada — e continua correta, porque o id de cada
 * mensagem é determinístico: o mesmo pedaço reenviado não duplica.
 */
export function dividirEmBlocos(conversas = [], teto = MENSAGENS_POR_ENVIO) {
    const limite = Number.isFinite(teto) && teto > 0 ? teto : MENSAGENS_POR_ENVIO;
    const blocos = [];
    let atual = [];
    let cabem = limite;

    for (const c of (Array.isArray(conversas) ? conversas : [])) {
        let msgs = Array.isArray(c?.mensagens) ? c.mensagens : [];
        if (!c?.numero || !msgs.length) continue;
        while (msgs.length > limite) {
            if (atual.length) { blocos.push(atual); atual = []; cabem = limite; }
            blocos.push([{ numero: c.numero, mensagens: msgs.slice(0, limite) }]);
            msgs = msgs.slice(limite);
        }
        if (msgs.length > cabem) { blocos.push(atual); atual = []; cabem = limite; }
        atual.push({ numero: c.numero, mensagens: msgs });
        cabem -= msgs.length;
    }
    if (atual.length) blocos.push(atual);
    return blocos;
}

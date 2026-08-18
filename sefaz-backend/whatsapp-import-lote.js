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

/** Pasta achatada com toda a mídia do export. */
export const PASTA_MIDIA = '_files';
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
    let midias = 0;

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

        // A pasta `_files` é a MÍDIA, e ela não é "arquivo fora do padrão":
        // por decisão do Paulo (18/08) o anexo vai para o SharePoint e não
        // entra no app. Contá-la é o que permite conferir, na prévia, se as
        // mensagens ainda APONTAM para esses arquivos — ver `detectarAnexo`.
        if (p.includes(PASTA_MIDIA)) { midias += 1; continue; }
        ignorados.push({ caminho, motivo: 'arquivo fora do padrão do export' });
    }

    return { conversas, atendimentos, semDono, ignorados, midias };
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
    // 📎 A CONFERÊNCIA QUE VALE: mídia no backup × anexo reconhecido no texto.
    // Quem faz é `avisoDeAnexos`, chamado com a prévia já pronta — aqui só
    // existe a contagem de arquivos.
    if (m.semDono.length) {
        avisos.push(`${m.semDono.length} conversa(s) só têm ${ARQUIVO_ATENDIMENTO} (sem ${ARQUIVO_CONVERSA}) — `
            + `entram assim mesmo, senão o histórico delas sumiria.`);
    }
    return {
        contatos: new Set([...m.conversas, ...m.semDono].map((x) => x.numero)).size,
        arquivosParaLer,
        atendimentosIgnorados: m.atendimentos.length,
        foraDoPadrao: m.ignorados.length,
        midias: m.midias || 0,
        avisos,
    };
}

/**
 * 📎 A MENSAGEM TINHA ANEXO? (decisão do Paulo, 18/08: *"texto no whatsapp,
 * anexo SharePoint"*).
 *
 * O anexo NÃO entra no app — mas a mensagem que o carregava entra, e ela
 * chega no texto como um marcador (`<anexado: DOC-20260327-WA0001.pdf>`,
 * `IMG-20260327-WA0001.jpg (arquivo anexado)`, `<Mídia oculta>`). Sem tratar
 * isso, a thread mostraria uma linha enigmática e quem lesse ficaria
 * procurando um arquivo que o app nunca teve — é o "campo vazio sem
 * explicação" de sempre, e a saída é a mesma: DIZER o que houve e ONDE está.
 *
 * ⚠️ **SÓ RECONHECE O QUE TEM CERTEZA.** Marcador que não casa fica como
 * texto puro, sem inventar anexo — e a prévia compara o total detectado com o
 * tamanho da pasta `_files`: **muita mídia no backup e nenhum anexo
 * reconhecido significa que o marcador é outro**, e isso precisa aparecer
 * ANTES de gravar, não depois.
 */
export const MARCADORES_ANEXO = [
    // WhatsApp iOS/Android em pt-BR e en; o ‎ (U+200E) vem no export.
    /<\s*(?:anexado|attached)\s*:\s*([^>]+?)\s*>/i,
    /([\w.\-]+\.[A-Za-z0-9]{2,5})\s*\((?:arquivo anexado|file attached)\)/i,
];

/** Marcador de mídia OCULTA — o export não trouxe o arquivo nem o nome. */
const SEM_ARQUIVO = /(?:<\s*m[íi]dia\s+oculta\s*>|imagem\s+ocultada|[áa]udio\s+ocultado|v[íi]deo\s+ocultado|figurinha\s+omitida|documento\s+omitido)/i;

export function detectarAnexo(texto) {
    const t = String(texto || '').replace(/\u200e/g, '');
    for (const re of MARCADORES_ANEXO) {
        const m = re.exec(t);
        if (m) return { temAnexo: true, arquivo: m[1].trim() };
    }
    // Sem nome de arquivo ainda é anexo — o que não dá é dizer QUAL. Fingir um
    // nome faria alguém procurar no SharePoint um arquivo que não existe.
    if (SEM_ARQUIVO.test(t)) return { temAnexo: true, arquivo: null };
    return { temAnexo: false, arquivo: null };
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
    let comAnexo = 0;
    const conversas = new Set();
    let semMensagem = 0;

    for (const l of (Array.isArray(lidos) ? lidos : [])) {
        const msgs = Array.isArray(l?.mensagens) ? l.mensagens : [];
        if (l?.numero) conversas.add(l.numero);
        if (!msgs.length) semMensagem += 1;
        mensagens += msgs.length;
        descartadas += Array.isArray(l?.descartadas) ? l.descartadas.length : 0;
        for (const m of msgs) {
            if (detectarAnexo(m?.texto).temAnexo) comAnexo += 1;
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
        comAnexo,
        autores,
    };
}

/**
 * 📎 O AVISO QUE FECHA A DECISÃO "texto no app, anexo no SharePoint".
 *
 * Ele responde duas coisas que a pessoa precisa saber ANTES de gravar:
 *  1. quantas mensagens vão entrar dizendo que tinham anexo (e que o arquivo
 *     está no backup arquivado, não no app);
 *  2. se a pasta `_files` está cheia e NENHUM anexo foi reconhecido no texto —
 *     o que significa que o marcador do export é outro e a referência está se
 *     perdendo em silêncio. Descobrir isso depois de gravar é descobrir tarde.
 */
export function avisoDeAnexos({ midias = 0, comAnexo = 0 } = {}) {
    if (!midias && !comAnexo) return null;
    if (midias > 0 && comAnexo === 0) {
        return {
            grave: true,
            texto: `A pasta ${PASTA_MIDIA} tem ${midias} arquivo(s), mas NENHUMA mensagem foi reconhecida como tendo anexo. `
                + 'O marcador de anexo deste export é diferente do esperado — as mensagens entram, mas sem dizer que havia arquivo. '
                + 'Me avise antes de gravar.',
        };
    }
    return {
        grave: false,
        texto: `${comAnexo} mensagem(ns) tinham anexo. O arquivo NÃO entra no app (decisão de 18/08): `
            + `a mensagem entra dizendo que havia anexo e o arquivo fica no backup guardado no SharePoint, pasta ${PASTA_MIDIA}.`,
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

// ============================================================================
// sefaz-backend/whatsapp-midia.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// ANEXO NO ATENDIMENTO: o cliente manda comprovante e a equipe manda
// documento — era a lacuna 🔴 BLOQUEANTE nº 1 e 2 do de-para com a Ultra Fox.
//
// DECISÕES QUE MANDAM:
// - O TIPO da mensagem na Cloud API sai do MIME, não da extensão do nome
//   (nome de arquivo é texto livre do usuário; mime vem do navegador). Sem
//   mime legível o tipo é `document`, que é o balde genérico LEGÍTIMO da
//   Meta — não é chute.
// - LIMITE EFETIVO, não o da Meta: o corpo da requisição é JSON base64, que
//   INFLA ~33% e passa pelo `express.json({limit})`. Recusar por "100 MB da
//   Meta" e depois estourar o parser com 413 cru seria a recusa mentindo
//   sobre o próprio limite — a régua diz o menor dos dois e DIZ qual pegou.
// - Arquivo VAZIO é recusa própria: `tamanho 0` costuma ser leitura que
//   falhou, e mandar 0 byte ao cliente é pior que não mandar.
// ============================================================================

/** Limites da Cloud API por tipo (bytes). Fonte: docs de mídia da Meta. */
export const LIMITES_META = {
    image: 5 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    sticker: 100 * 1024,
    document: 100 * 1024 * 1024,
};

/**
 * Teto do corpo da requisição (`express.json({ limit: '20mb' })`) traduzido
 * em BYTES ÚTEIS de arquivo: base64 usa 4 caracteres para cada 3 bytes.
 * Sobra deliberada para o resto do JSON (nome, legenda, campos).
 */
export const LIMITE_CORPO_BYTES = Math.floor((20 * 1024 * 1024 * 0.97) * 3 / 4);

const IMAGENS = ['image/jpeg', 'image/png', 'image/webp'];
const AUDIOS = ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'];
const VIDEOS = ['video/mp4', 'video/3gp', 'video/3gpp'];

/**
 * Tipo da mensagem na Cloud API a partir do MIME.
 * `image/webp` é figurinha SÓ quando o chamador diz que é (o mesmo mime
 * serve imagem comum) — o app manda como imagem, que é o caso do dia a dia.
 */
export function tipoDaMidia(mime) {
    const m = String(mime || '').split(';')[0].trim().toLowerCase();
    if (IMAGENS.includes(m)) return 'image';
    if (AUDIOS.includes(m)) return 'audio';
    if (VIDEOS.includes(m)) return 'video';
    return 'document';   // balde genérico da Meta — vale pra PDF, planilha, zip…
}

/** Nome de arquivo seguro (o nome viaja ao cliente e vira nome no Storage). */
export function nomeSeguroDeArquivo(nome, tipo = 'document') {
    const limpo = String(nome || '').replace(/[\\/\x00-\x1f]/g, '').trim().slice(0, 120);
    if (limpo) return limpo;
    return { image: 'imagem.jpg', audio: 'audio.ogg', video: 'video.mp4' }[tipo] || 'arquivo';
}

/**
 * Valida o anexo ANTES de subir à Meta. Devolve {ok, tipo, nome} ou
 * {ok:false, erro, acao} — a recusa diz o limite que pegou, porque "arquivo
 * grande demais" sem número manda a pessoa adivinhar.
 */
export function validarAnexo({ mime, tamanhoBytes, nomeArquivo }) {
    const tamanho = Number(tamanhoBytes);
    if (!Number.isFinite(tamanho) || tamanho <= 0) {
        return {
            ok: false,
            erro: 'Arquivo vazio ou ilegível.',
            acao: 'Escolha o arquivo de novo — tamanho zero costuma ser leitura que falhou.',
        };
    }
    const tipo = tipoDaMidia(mime);
    const limiteMeta = LIMITES_META[tipo];
    // O menor dos dois manda, e a mensagem DIZ qual pegou.
    const limite = Math.min(limiteMeta, LIMITE_CORPO_BYTES);
    if (tamanho > limite) {
        const mb = (n) => `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
        const dono = limite === limiteMeta ? `limite da Meta para ${tipo}` : 'limite de envio do app';
        return {
            ok: false,
            erro: `Arquivo de ${mb(tamanho)} — o máximo é ${mb(limite)} (${dono}).`,
            acao: tipo === 'image'
                ? 'Reduza a imagem, ou envie como documento (PDF) se precisar do original.'
                : 'Envie um arquivo menor, ou compartilhe por link no texto.',
        };
    }
    return { ok: true, tipo, nome: nomeSeguroDeArquivo(nomeArquivo, tipo) };
}

/**
 * Corpo da mensagem de mídia da Cloud API. `legenda` só existe em image,
 * video e document — em áudio a Meta IGNORA, então o app avisa em vez de
 * mandar texto que some (mensagem que some é pior que mensagem recusada).
 */
export function montarMensagemMidia({ para, tipo, mediaId, nomeArquivo, legenda }) {
    const corpo = { messaging_product: 'whatsapp', to: para, type: tipo };
    const bloco = { id: mediaId };
    if (tipo === 'document') bloco.filename = nomeSeguroDeArquivo(nomeArquivo, tipo);
    if (legenda && tipo !== 'audio') bloco.caption = String(legenda).slice(0, 1024);
    corpo[tipo] = bloco;
    return corpo;
}

/** A legenda foi descartada? (o front avisa antes de mandar). */
export function legendaSeraIgnorada(tipo, legenda) {
    return Boolean(legenda) && tipo === 'audio';
}

/** Resumo do anexo pra lista de conversas (mesma linguagem do rotuloMidia). */
export function resumoDoAnexo(tipo, nome, legenda) {
    const icone = { image: '🖼️', audio: '🎙️', video: '🎬', document: '📎' }[tipo] || '📎';
    const base = `${icone} ${nome}`;
    return (legenda ? `${base} — ${legenda}` : base).slice(0, 140);
}

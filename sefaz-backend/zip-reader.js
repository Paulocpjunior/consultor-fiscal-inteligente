// ============================================================================
// sefaz-backend/zip-reader.js  (PURO — sem io/rede, testável)
// ----------------------------------------------------------------------------
// Leitor mínimo de ZIP pro cofre de e-mail: MUITO emissor manda os XMLs do dia
// zipados ("XMLs_2026-07.zip") e o ingestor só aceitava .xml solto — os anexos
// ZIP eram ignorados em silêncio (falha achada 27/07 com o Paulo).
//
// Implementado com o zlib do próprio Node (inflateRaw) lendo o Central
// Directory do ZIP — sem dependência nova (toda dep nova passa pelo gate de
// auditoria do deploy e vira risco de advisory).
//
// Suporta os 2 métodos que os emissores usam: 0 = store, 8 = deflate.
// ZIP64 (>4 GB ou >65535 arquivos) NÃO é suportado — falha com mensagem clara.
// ============================================================================

// Namespace import: em ESM nativo e sob o transform do jest o default de
// 'node:zlib' pode vir undefined — com `* as` funciona nos dois.
import * as zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50;   // End of Central Directory
const SIG_CD = 0x02014b50;     // Central Directory header
const SIG_LOCAL = 0x04034b50;  // Local file header

/**
 * Extrai arquivos de um buffer ZIP.
 *
 * @param {Buffer} buffer
 * @param {object} [opts]
 * @param {RegExp} [opts.filtroNome]   só extrai nomes que casarem (ex.: /\.xml$/i)
 * @param {number} [opts.maxArquivos=500]
 * @param {number} [opts.maxBytesPorArquivo=20e6]  proteção contra zip-bomb
 * @returns {{ arquivos: Array<{nome: string, conteudo: Buffer}>, ignorados: string[] }}
 */
export function extrairArquivosZip(buffer, {
    filtroNome = null,
    maxArquivos = 500,
    maxBytesPorArquivo = 20_000_000,
} = {}) {
    const arquivos = [];
    const ignorados = [];
    if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
        throw new Error('ZIP inválido: arquivo vazio ou truncado.');
    }

    // EOCD fica no fim; o comentário final pode ter até 65535 bytes.
    let eocd = -1;
    const limite = Math.max(0, buffer.length - 65557);
    for (let i = buffer.length - 22; i >= limite; i--) {
        if (buffer.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP inválido: fim do arquivo (EOCD) não encontrado.');

    const totalEntradas = buffer.readUInt16LE(eocd + 10);
    const offsetCd = buffer.readUInt32LE(eocd + 16);
    if (totalEntradas === 0xffff || offsetCd === 0xffffffff) {
        throw new Error('ZIP no formato ZIP64 não é suportado — extraia e reenvie os XMLs soltos.');
    }

    let ptr = offsetCd;
    for (let n = 0; n < totalEntradas && arquivos.length < maxArquivos; n++) {
        if (ptr + 46 > buffer.length || buffer.readUInt32LE(ptr) !== SIG_CD) break;

        const metodo = buffer.readUInt16LE(ptr + 10);
        const tamComprimido = buffer.readUInt32LE(ptr + 20);
        const tamOriginal = buffer.readUInt32LE(ptr + 24);
        const nomeLen = buffer.readUInt16LE(ptr + 28);
        const extraLen = buffer.readUInt16LE(ptr + 30);
        const comentLen = buffer.readUInt16LE(ptr + 32);
        const offsetLocal = buffer.readUInt32LE(ptr + 42);
        const nome = buffer.slice(ptr + 46, ptr + 46 + nomeLen).toString('utf-8');
        ptr += 46 + nomeLen + extraLen + comentLen;

        // Pastas e nomes fora do filtro saem cedo (sem descomprimir).
        if (nome.endsWith('/')) continue;
        if (filtroNome && !filtroNome.test(nome)) { ignorados.push(nome); continue; }
        if (tamOriginal > maxBytesPorArquivo) { ignorados.push(`${nome} (>${Math.round(maxBytesPorArquivo / 1e6)}MB)`); continue; }

        // O tamanho vem do Central Directory (confiável mesmo com data
        // descriptor no local header).
        if (offsetLocal + 30 > buffer.length || buffer.readUInt32LE(offsetLocal) !== SIG_LOCAL) {
            ignorados.push(`${nome} (cabeçalho local inválido)`);
            continue;
        }
        const lhNomeLen = buffer.readUInt16LE(offsetLocal + 26);
        const lhExtraLen = buffer.readUInt16LE(offsetLocal + 28);
        const inicio = offsetLocal + 30 + lhNomeLen + lhExtraLen;
        const dados = buffer.slice(inicio, inicio + tamComprimido);

        try {
            let conteudo;
            if (metodo === 0) conteudo = dados;                         // store
            // `maxOutputLength`: o tamanho declarado vem do Central Directory, que é
            // de quem montou o zip — sem o teto na INFLAÇÃO, um zip-bomb passava
            // pela checagem de cima e alocava sem limite.
            else if (metodo === 8) conteudo = zlib.inflateRawSync(dados, { maxOutputLength: maxBytesPorArquivo }); // deflate
            else { ignorados.push(`${nome} (compressão ${metodo} não suportada)`); continue; }
            arquivos.push({ nome, conteudo });
        } catch (e) {
            ignorados.push(`${nome} (falha ao descomprimir: ${e.message})`);
        }
    }

    return { arquivos, ignorados };
}

/** Conveniência: extrai só os .xml de um ZIP, já como string utf-8. */
export function extrairXmlsDoZip(buffer, opts = {}) {
    const { arquivos, ignorados } = extrairArquivosZip(buffer, { ...opts, filtroNome: /\.xml$/i });
    return {
        xmls: arquivos.map((a) => ({ nome: a.nome, xml: a.conteudo.toString('utf-8') })),
        ignorados,
    };
}

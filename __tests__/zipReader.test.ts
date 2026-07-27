/**
 * Leitor de ZIP do cofre de e-mail (27/07): emissor que manda os XMLs do dia
 * zipados era ignorado em silêncio — o ingestor só aceitava .xml solto.
 * Os ZIPs abaixo são construídos aqui mesmo (deflate e store) pra travar o
 * parser contra ZIP real, sem fixture binária no repo.
 */
import * as zlib from 'node:zlib';
// @ts-expect-error — modulo .js puro
import { extrairArquivosZip, extrairXmlsDoZip } from '../sefaz-backend/zip-reader.js';
// @ts-expect-error — modulo .js puro
import { hashMsgId } from '../sefaz-backend/xml-email-ingestor.js';

/** Monta um ZIP mínimo (local headers + central directory + EOCD). */
function montarZip(entradas: { nome: string; conteudo: Buffer; comprimir?: boolean }[]): Buffer {
    const locais: Buffer[] = [];
    const centrais: Buffer[] = [];
    let offset = 0;

    for (const e of entradas) {
        const nomeBuf = Buffer.from(e.nome, 'utf-8');
        const comprimir = e.comprimir !== false;
        const dados = comprimir ? zlib.deflateRawSync(e.conteudo) : e.conteudo;
        const metodo = comprimir ? 8 : 0;

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);            // versão
        lh.writeUInt16LE(metodo, 8);
        lh.writeUInt32LE(0, 14);            // crc (não validamos)
        lh.writeUInt32LE(dados.length, 18);
        lh.writeUInt32LE(e.conteudo.length, 22);
        lh.writeUInt16LE(nomeBuf.length, 26);
        lh.writeUInt16LE(0, 28);
        locais.push(lh, nomeBuf, dados);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(metodo, 10);
        cd.writeUInt32LE(0, 16);
        cd.writeUInt32LE(dados.length, 20);
        cd.writeUInt32LE(e.conteudo.length, 24);
        cd.writeUInt16LE(nomeBuf.length, 28);
        cd.writeUInt32LE(offset, 42);
        centrais.push(cd, nomeBuf);

        offset += lh.length + nomeBuf.length + dados.length;
    }

    const corpo = Buffer.concat(locais);
    const central = Buffer.concat(centrais);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entradas.length, 8);
    eocd.writeUInt16LE(entradas.length, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(corpo.length, 16);
    return Buffer.concat([corpo, central, eocd]);
}

const XML_NFE = '<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe352607"/></NFe></nfeProc>';

describe('extrairXmlsDoZip — caso do emissor que manda os XMLs zipados', () => {
    it('extrai .xml comprimido (deflate) e ignora PDF de dentro do ZIP', () => {
        const zip = montarZip([
            { nome: 'NFe352607203851.xml', conteudo: Buffer.from(XML_NFE, 'utf-8') },
            { nome: 'DANFE352607203851.pdf', conteudo: Buffer.from('%PDF-1.4 fake', 'utf-8') },
        ]);
        const r = extrairXmlsDoZip(zip);
        expect(r.xmls).toHaveLength(1);
        expect(r.xmls[0].nome).toBe('NFe352607203851.xml');
        expect(r.xmls[0].xml).toBe(XML_NFE);
        expect(r.ignorados.join(' ')).toMatch(/\.pdf/i);
    });

    it('extrai .xml sem compressão (store) e vários de uma vez', () => {
        const zip = montarZip([
            { nome: 'a.xml', conteudo: Buffer.from('<a/>', 'utf-8'), comprimir: false },
            { nome: 'sub/pasta/b.xml', conteudo: Buffer.from('<b/>', 'utf-8') },
            { nome: 'c.xml', conteudo: Buffer.from('<c/>', 'utf-8'), comprimir: false },
        ]);
        const r = extrairXmlsDoZip(zip);
        expect(r.xmls.map((x: any) => x.xml).sort()).toEqual(['<a/>', '<b/>', '<c/>']);
    });

    it('ZIP corrompido/vazio falha com mensagem clara (não silencia)', () => {
        expect(() => extrairArquivosZip(Buffer.from('não é zip'))).toThrow(/ZIP inválido/);
        expect(() => extrairArquivosZip(Buffer.alloc(0))).toThrow(/ZIP inválido/);
    });

    it('respeita filtro e teto de arquivos', () => {
        const zip = montarZip([
            { nome: '1.xml', conteudo: Buffer.from('<x/>', 'utf-8') },
            { nome: '2.xml', conteudo: Buffer.from('<y/>', 'utf-8') },
        ]);
        const r = extrairArquivosZip(zip, { filtroNome: /\.xml$/i, maxArquivos: 1 });
        expect(r.arquivos).toHaveLength(1);
    });
});

describe('hashMsgId — id de documento estável pro registro de processadas', () => {
    it('é determinístico, seguro pra path do Firestore e distingue mensagens', () => {
        const id1 = 'AAMkAGI2/THVSAAA=';   // messageId real tem '/' e '='
        const id2 = 'AAMkAGI2/THVSAAB=';
        expect(hashMsgId(id1)).toBe(hashMsgId(id1));
        expect(hashMsgId(id1)).not.toBe(hashMsgId(id2));
        expect(hashMsgId(id1)).not.toMatch(/[/=]/);
    });
});

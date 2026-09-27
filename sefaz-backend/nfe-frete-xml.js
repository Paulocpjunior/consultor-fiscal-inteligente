import { DOMParser } from '@xmldom/xmldom';
import { Storage } from '@google-cloud/storage';
import { normalizarModalidadeFrete } from './nfe-frete.js';
import { docCancelado } from './xml-metadata-helper.js';
import { modeloDoDoc } from './participante-doc-helper.js';

function elementos(no, nome) {
    return Array.from(no.getElementsByTagName('*')).filter(e => e.localName === nome);
}

export function lerFreteXml(xml, chaveEsperada) {
    if (/<!DOCTYPE/i.test(xml)) throw new Error('DOCTYPE nao permitido');
    const erros = [];
    const dom = new DOMParser({ errorHandler: { warning() {}, error: e => erros.push(e), fatalError: e => erros.push(e) } }).parseFromString(xml, 'application/xml');
    const infos = elementos(dom, 'infNFe');
    if (erros.length || infos.length !== 1) throw new Error('XML NF-e invalido');
    const info = infos[0];
    const chave = (info.getAttribute('Id') || '').replace(/^NFe/, '');
    if (!chaveEsperada || chave !== chaveEsperada) throw new Error('Chave do XML diverge do documento');
    const transp = elementos(info, 'transp');
    const mods = transp.length === 1 ? elementos(transp[0], 'modFrete') : [];
    return mods.length === 1 ? normalizarModalidadeFrete(mods[0].textContent) : null;
}

/** Recupera somente na memoria da geracao: nunca reescreve a escrituracao salva. */
export async function completarFreteDasNotas(notas, baixarXml) {
    const baixar = baixarXml || (async path => {
        const bucket = process.env.STORAGE_BUCKET || `${process.env.GCP_PROJECT_ID || 'consultorfiscalapp'}.firebasestorage.app`;
        const [buf] = await new Storage().bucket(bucket).file(path).download();
        return buf.toString('utf8');
    });
    const pendencias = [];
    for (const nota of notas) {
        const modelo = modeloDoDoc(nota);
        if (docCancelado(nota) || modelo === '65') continue;
        if (modelo !== '55') continue;
        if (normalizarModalidadeFrete(nota.modFrete) !== null) continue;
        try {
            if (!nota.storagePath || !nota.storagePath.startsWith('xmls/') || nota.storagePath.includes('..')) throw new Error('XML original nao localizado');
            const modFrete = lerFreteXml(await baixar(nota.storagePath), nota.chave);
            if (modFrete === null) throw new Error('Modalidade ausente ou invalida no XML');
            nota.modFrete = modFrete;
        } catch (err) {
            pendencias.push(`Nota ${nota.numero || nota.id}: ${err.message}`);
        }
    }
    if (pendencias.length) {
        const err = new Error(`Modalidade de frete nao confirmada. Reimporte o XML original antes de gerar o SPED. ${pendencias.slice(0, 10).join('; ')}${pendencias.length > 10 ? `; e mais ${pendencias.length - 10} nota(s)` : ''}`);
        err.code = 'MODALIDADE_FRETE_PENDENTE';
        throw err;
    }
}

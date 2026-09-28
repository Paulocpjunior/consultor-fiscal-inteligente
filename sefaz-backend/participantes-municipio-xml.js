/**
 * participantes-municipio-xml.js — o COD_MUN do 0150 relido do XML GUARDADO,
 * só na memória da geração (nunca reescreve o documento salvo).
 *
 * ELS 08/2026, 3ª rodada do PVA (28/09): *"Campo obrigatório para
 * contribuintes domiciliados no Brasil. Preencher com 9999999 caso contrário"*
 * no 0150 do produtor rural OVIDIO (CPF). O documento foi gravado sem o
 * `codMunIBGE` do emitente, mas o XML está no Cloud Storage (`storagePath`) e
 * traz `<enderEmit><cMun>`. A mesma régua do ♻️ Reler município da DIPAM
 * (12/08) e do frete do C100 (`completarFreteDasNotas`): RECUPERAÇÃO DA FONTE —
 * não se pede arquivo ao cliente, não se digita, não se inventa ("9999999" é
 * afirmar que o produtor mora fora do Brasil).
 *
 * O que continuar sem município fica VAZIO e dito pelo aviso de sempre
 * (`avisoParticipantesSemMunicipio`); este módulo só diz o que RELEU e por
 * que os outros não vieram (sem XML guardado × XML sem o dado).
 */
import { Storage } from '@google-cloud/storage';
import { extrairParticipantesNfe, docCancelado } from './xml-metadata-helper.js';
import { modeloDoDoc, codPartDoDocumento } from './participante-doc-helper.js';

const so = (v) => String(v ?? '').replace(/\D/g, '');

async function baixarDoStorage(path) {
    const bucket = process.env.STORAGE_BUCKET || `${process.env.GCP_PROJECT_ID || 'consultorfiscalapp'}.firebasestorage.app`;
    const [buf] = await new Storage().bucket(bucket).file(path).download();
    return buf.toString('utf8');
}

const storagePathValido = (p) => typeof p === 'string' && p.startsWith('xmls/') && !p.includes('..');

/** O LADO do XML que é este participante (emitente ou destinatário), ou null. */
export function ladoDoParticipanteNoXml(xml, codPart) {
    if (/<!DOCTYPE/i.test(String(xml || ''))) return null;
    const p = extrairParticipantesNfe(String(xml || ''));
    if (so(p?.emitente?.cnpj) && so(p.emitente.cnpj) === so(codPart)) return p.emitente;
    if (so(p?.destinatario?.cnpj) && so(p.destinatario.cnpj) === so(codPart)) return p.destinatario;
    return null;
}

/**
 * Completa, NA MEMÓRIA, o `codMunIBGE` (e o endereço que faltar) dos
 * participantes sem município, relendo o XML guardado de um documento deles.
 * @returns {Promise<{preenchidos:string[], semXml:string[], semDadoNoXml:string[], falhas:string[], aviso:string|null}>}
 */
export async function completarMunicipioDosParticipantes({
    participantes, notas, empresaCnpj, baixarXml = baixarDoStorage, maxPorParticipante = 3,
} = {}) {
    const r = { preenchidos: [], semXml: [], semDadoNoXml: [], falhas: [], aviso: null };
    const lista = Array.isArray(participantes) ? participantes : [];
    const docs = Array.isArray(notas) ? notas : [];
    for (const p of lista) {
        if (!p || so(p.codMunIBGE)) continue;
        const codPart = so(p.codPart || p.cnpj || p.cpf);
        if (!codPart) continue;
        const nome = String(p.nome || codPart);
        const candidatas = docs.filter((n) => n && !docCancelado(n) && modeloDoDoc(n) === '55'
            && storagePathValido(n.storagePath) && codPartDoDocumento(n, empresaCnpj) === codPart);
        if (!candidatas.length) { r.semXml.push(nome); continue; }
        let lidas = 0; let achou = false;
        for (const n of candidatas.slice(0, maxPorParticipante)) {
            try {
                const lado = ladoDoParticipanteNoXml(await baixarXml(n.storagePath), codPart);
                lidas += 1;
                if (!so(lado?.codMunIBGE)) continue;
                p.codMunIBGE = so(lado.codMunIBGE).slice(0, 7);
                for (const campo of ['logradouro', 'numero', 'complemento', 'bairro']) {
                    if (!String(p[campo] || '').trim() && lado[campo]) p[campo] = String(lado[campo]);
                }
                achou = true;
                break;
            } catch (e) {
                r.falhas.push(`${nome}: ${e?.message || e}`);
            }
        }
        if (achou) r.preenchidos.push(nome);
        else if (lidas) r.semDadoNoXml.push(nome);
        else if (!r.falhas.some((f) => f.startsWith(`${nome}:`))) r.semXml.push(nome);
    }
    const partes = [];
    if (r.preenchidos.length) {
        partes.push(`${r.preenchidos.length} participante(s) sem município ganharam o COD_MUN relido do XML guardado `
            + `(${r.preenchidos.slice(0, 5).join(', ')}${r.preenchidos.length > 5 ? ` e mais ${r.preenchidos.length - 5}` : ''}) — só neste arquivo; o cadastro não muda.`);
    }
    if (r.semXml.length) partes.push(`${r.semXml.length} sem XML guardado para reler (${r.semXml.slice(0, 5).join(', ')}).`);
    if (r.semDadoNoXml.length) partes.push(`${r.semDadoNoXml.length} com XML relido que NÃO traz o município (${r.semDadoNoXml.slice(0, 5).join(', ')}).`);
    if (r.falhas.length) partes.push(`${r.falhas.length} falha(s) ao ler o XML: ${r.falhas.slice(0, 3).join('; ')}.`);
    r.aviso = partes.length ? `♻️ Bloco 0 (COD_MUN do 0150): ${partes.join(' ')}` : null;
    return r;
}

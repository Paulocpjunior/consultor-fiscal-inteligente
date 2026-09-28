/**
 * ♻️ COD_MUN DO 0150 RELIDO DO XML GUARDADO — só na memória da geração.
 *
 * ELS 08/2026, 3ª rodada do PVA (28/09): "Campo obrigatório para contribuintes
 * domiciliados no Brasil. Preencher com 9999999 caso contrário" no 0150 do
 * produtor rural (CPF). O documento foi gravado sem o município do emitente,
 * mas o XML no Storage traz <enderEmit><cMun>. Recuperação da fonte, a mesma
 * régua do frete do C100 e do ♻️ Reler município da DIPAM.
 *
 * Fatos cobrados: preenche pelo lado certo do XML (emitente na compra,
 * destinatário na venda); endereço que falta vem junto, o que já existe fica;
 * sem XML guardado e XML sem o dado ficam DITOS e o campo VAZIO (nunca
 * 9999999); nota cancelada não é fonte; o aviso nomeia; os dois orquestradores
 * chamam a releitura; nada é gravado.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error módulo .js puro sem tipos
import { completarMunicipioDosParticipantes, ladoDoParticipanteNoXml } from '../sefaz-backend/participantes-municipio-xml.js';

const RAIZ = join(__dirname, '..');
const EMPRESA = '65671243000105';
const CPF_PRODUTOR = '21331057604';
const CNPJ_CLIENTE = '49167213000100';

const xmlCompra = (cMun: string | null) => `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35260800021331057604550010000000011000000011">
<emit><CPF>${CPF_PRODUTOR}</CPF><xNome>OVIDIO SOARES</xNome><enderEmit><xLgr>SITIO BOA VISTA</xLgr><nro>SN</nro><xBairro>ZONA RURAL</xBairro>${cMun ? `<cMun>${cMun}</cMun>` : ''}<UF>BA</UF></enderEmit></emit>
<dest><CNPJ>${EMPRESA}</CNPJ><xNome>ELS</xNome><enderDest><cMun>2925758</cMun><UF>BA</UF></enderDest></dest>
</infNFe></NFe></nfeProc>`;
const xmlVenda = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35260865671243000105550010000018091896679148">
<emit><CNPJ>${EMPRESA}</CNPJ><xNome>ELS</xNome><enderEmit><cMun>2925758</cMun><UF>BA</UF></enderEmit></emit>
<dest><CNPJ>${CNPJ_CLIENTE}</CNPJ><xNome>RR COMERCIO</xNome><enderDest><xLgr>RUA A</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3550308</cMun><UF>SP</UF></enderDest></dest>
</infNFe></NFe></nfeProc>`;

const compra = (extra: Record<string, unknown> = {}) => ({
    tipo: 'NFe', modelo: '55', direcao: 'entrada', numero: '1', chave: '35260800021331057604550010000000011000000011',
    cnpjEmit: CPF_PRODUTOR, cnpjDest: EMPRESA, emitente: { cpf: CPF_PRODUTOR, nome: 'OVIDIO SOARES' },
    destinatario: { cnpj: EMPRESA }, storagePath: 'xmls/els/compra-1.xml', ...extra,
});
const venda = () => ({
    tipo: 'NFe', modelo: '55', direcao: 'saida', numero: '1809', chave: '35260865671243000105550010000018091896679148',
    cnpjEmit: EMPRESA, cnpjDest: CNPJ_CLIENTE, emitente: { cnpj: EMPRESA }, destinatario: { cnpj: CNPJ_CLIENTE, nome: 'RR' },
    storagePath: 'xmls/els/venda-1809.xml',
});
const produtor = () => ({ codPart: CPF_PRODUTOR, nome: 'OVIDIO SOARES', cpf: CPF_PRODUTOR, cnpj: '', codMunIBGE: '', logradouro: '', numero: '', bairro: 'JA TINHA' });
const cliente = () => ({ codPart: CNPJ_CLIENTE, nome: 'RR COMERCIO', cnpj: CNPJ_CLIENTE, codMunIBGE: '' });

describe('ladoDoParticipanteNoXml — o lado é o do participante, não o do arquivo', () => {
    it('acha o emitente pelo CPF e o destinatário pelo CNPJ', () => {
        expect(ladoDoParticipanteNoXml(xmlCompra('2925758'), CPF_PRODUTOR)?.codMunIBGE).toBe('2925758');
        expect(ladoDoParticipanteNoXml(xmlVenda, CNPJ_CLIENTE)?.codMunIBGE).toBe('3550308');
        expect(ladoDoParticipanteNoXml(xmlVenda, CPF_PRODUTOR)).toBeNull();
        expect(ladoDoParticipanteNoXml('<!DOCTYPE x><NFe/>', CPF_PRODUTOR)).toBeNull();
    });
});

describe('completarMunicipioDosParticipantes — recuperação da fonte, na memória', () => {
    it('compra de produtor PF: o COD_MUN vem do <enderEmit>, o endereço que falta vem junto, o que já existe fica', async () => {
        const p = produtor();
        const lidos: string[] = [];
        const r = await completarMunicipioDosParticipantes({
            participantes: [p], notas: [compra()], empresaCnpj: EMPRESA,
            baixarXml: async (path: string) => { lidos.push(path); return xmlCompra('2925758'); },
        });
        expect(lidos).toEqual(['xmls/els/compra-1.xml']);
        expect(p.codMunIBGE).toBe('2925758');
        expect(p.logradouro).toBe('SITIO BOA VISTA');
        expect(p.numero).toBe('SN');
        expect(p.bairro).toBe('JA TINHA');
        expect(r.preenchidos).toEqual(['OVIDIO SOARES']);
        expect(r.aviso).toContain('OVIDIO SOARES');
        expect(r.aviso).toContain('o cadastro não muda');
    });

    it('venda: o COD_MUN do cliente vem do <enderDest>', async () => {
        const p = cliente();
        await completarMunicipioDosParticipantes({
            participantes: [p], notas: [venda()], empresaCnpj: EMPRESA, baixarXml: async () => xmlVenda,
        });
        expect(p.codMunIBGE).toBe('3550308');
    });

    it('quem já tem município não é relido (zero downloads)', async () => {
        const p = { ...produtor(), codMunIBGE: '2925758' };
        let downloads = 0;
        const r = await completarMunicipioDosParticipantes({
            participantes: [p], notas: [compra()], empresaCnpj: EMPRESA, baixarXml: async () => { downloads += 1; return xmlCompra('1'); },
        });
        expect(downloads).toBe(0);
        expect(r.aviso).toBeNull();
    });

    it('sem XML guardado (storagePath ausente ou fora de xmls/): campo VAZIO e dito — nunca 9999999', async () => {
        const p = produtor();
        const r = await completarMunicipioDosParticipantes({
            participantes: [p], notas: [compra({ storagePath: '' }), compra({ storagePath: '../etc/passwd' })], empresaCnpj: EMPRESA,
            baixarXml: async () => { throw new Error('não deveria baixar'); },
        });
        expect(p.codMunIBGE).toBe('');
        expect(r.semXml).toEqual(['OVIDIO SOARES']);
        expect(r.aviso).toContain('sem XML guardado');
        expect(JSON.stringify(p)).not.toContain('9999999');
    });

    it('XML relido que NÃO traz o <cMun>: campo vazio e a causa dita', async () => {
        const p = produtor();
        const r = await completarMunicipioDosParticipantes({
            participantes: [p], notas: [compra()], empresaCnpj: EMPRESA, baixarXml: async () => xmlCompra(null),
        });
        expect(p.codMunIBGE).toBe('');
        expect(r.semDadoNoXml).toEqual(['OVIDIO SOARES']);
        expect(r.aviso).toContain('NÃO traz o município');
    });

    it('nota cancelada não é fonte; a próxima nota viva do mesmo participante é', async () => {
        const p = produtor();
        const lidos: string[] = [];
        await completarMunicipioDosParticipantes({
            participantes: [p], empresaCnpj: EMPRESA,
            notas: [
                compra({ storagePath: 'xmls/els/cancelada.xml', eventos: [{ tpEvento: '110111', cStat: '135' }] }),
                compra({ storagePath: 'xmls/els/viva.xml' }),
            ],
            baixarXml: async (path: string) => { lidos.push(path); return xmlCompra('2925758'); },
        });
        expect(lidos).toEqual(['xmls/els/viva.xml']);
        expect(p.codMunIBGE).toBe('2925758');
    });

    it('falha no download não derruba a geração: vai dita e o campo fica vazio', async () => {
        const p = produtor();
        const r = await completarMunicipioDosParticipantes({
            participantes: [p], notas: [compra()], empresaCnpj: EMPRESA, baixarXml: async () => { throw new Error('bucket fora'); },
        });
        expect(p.codMunIBGE).toBe('');
        expect(r.falhas[0]).toContain('bucket fora');
        expect(r.aviso).toContain('falha(s) ao ler o XML');
    });
});

describe('os dois orquestradores releem o município antes do bloco 0', () => {
    it.each(['sped-contrib-orchestrator.js', 'sped-fiscal-orchestrator.js'])('%s chama completarMunicipioDosParticipantes com participantes, notas e a empresa', (arq) => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend', arq), 'utf8');
        expect(src).toContain('completarMunicipioDosParticipantes({');
        const i = src.indexOf('completarMunicipioDosParticipantes({');
        const trecho = src.slice(i, i + 300);
        expect(trecho).toContain('dados.participantes');
        expect(trecho).toContain('dados.notas');
        expect(trecho).toContain('dados.empresa');
    });

    it('o módulo não grava nada: nenhuma escrita no Firestore', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/participantes-municipio-xml.js'), 'utf8');
        expect(src).not.toMatch(/\.(set|update|batch)\(/);
        expect(src).not.toContain('firestore');
    });
});

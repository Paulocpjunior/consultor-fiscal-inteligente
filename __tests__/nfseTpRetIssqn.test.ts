// @ts-nocheck
/**
 * 🚨 tpRetISSQN DO PADRÃO NACIONAL: 1 = NÃO retido · 2 = retido pelo TOMADOR ·
 * 3 = retido pelo INTERMEDIÁRIO (05/10).
 *
 * Paulo, REALITY (0899), tomados 09/2026: "apenas 1 nf de serviços tomados tem
 * a retenção do ISS, porém na aba de ISS aparece como se todos fossem retidos"
 * — nove notas, R$ 1.290,33. O leitor (e o emissor do DPS) diziam "1 é
 * retido": o contrário.
 *
 * A PROVA É POR ARQUIVO REAL, não por leiaute lembrado: nas NFS-e 5725 e 5747
 * (fixtures/progress-retencoes, transmitidas de verdade) o tpRetISSQN é 1, o
 * vTotalRet é só a soma das retenções FEDERAIS e o líquido é serviço menos
 * esse total — o ISS da nota NÃO saiu do líquido. Logo, 1 = não retido.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { lerNfseNacional } from '../sefaz-backend/nfse-nacional-leitura.js';
import { parseNFeXml } from '../services/xmlParserService';
import { buildDocumentoFiscal } from '../services/xmlParserService';
import { patchDaReleituraIssRetido, precisaReleituraIssRetido } from '../sefaz-backend/nfse-iss-retido-releitura.js';

const DIR = join(__dirname, 'fixtures', 'progress-retencoes');
const real = (n: string) => readFileSync(join(DIR, `${n}.xml`), 'utf8');
const tag = (xml: string, t: string) => {
    const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml);
    return m ? Number(m[1]) : null;
};

describe('a prova no arquivo real: tpRetISSQN=1 é NÃO retido', () => {
    it.each(['5725', '5747'])('NFS-e %s: o ISS não saiu do líquido', (n) => {
        const xml = real(n);
        expect(xml).toContain('<tpRetISSQN>1</tpRetISSQN>');
        const vServ = tag(xml, 'vServ')!;
        const vLiq = tag(xml, 'vLiq')!;
        const vTotalRet = tag(xml, 'vTotalRet')!;
        const vISSQN = tag(xml, 'vISSQN')!;
        const federal = (tag(xml, 'vRetIRRF') || 0) + (tag(xml, 'vRetCSLL') || 0) + (tag(xml, 'vRetCP') || 0);
        // O total retido é só o federal…
        expect(Math.round(vTotalRet * 100)).toBe(Math.round(federal * 100));
        // …e o líquido é o serviço menos ele: o ISS ficou com o prestador.
        expect(Math.round((vServ - vTotalRet) * 100)).toBe(Math.round(vLiq * 100));
        expect(vISSQN).toBeGreaterThan(0);
        // Portanto o leitor tem de dizer: NÃO retido.
        const lida = lerNfseNacional(xml);
        expect(lida.valores.issRetido).toBe(false);
        expect(lida.valores.tpRetISSQN).toBe('1');
    });
});

describe('o leitor e o emissor falam a mesma língua', () => {
    const base = real('5747');
    const com = (c: string) => base.replace('<tpRetISSQN>1</tpRetISSQN>', `<tpRetISSQN>${c}</tpRetISSQN>`);

    it('2 = retido pelo tomador', () => {
        expect(lerNfseNacional(com('2')).valores.issRetido).toBe(true);
    });

    it('3 = intermediário: não afirma lado nenhum, e diz', () => {
        const lida = lerNfseNacional(com('3'));
        expect(lida.valores.issRetido).toBeNull();
        expect(lida.lacunas.join(' ')).toMatch(/INTERMEDIÁRIO/);
    });

    // O emissor (DPS) é cobrado em nfseNacionalDpsBuilder.test.ts: retido → 2, não retido → 1.
});

describe('a importação pela tela grava o certo — e o código cru', () => {
    it('NFS-e 5747 (tpRetISSQN=1) entra com issRetido=false e tpRetISSQN=1', () => {
        const parsed: any = parseNFeXml(real('5747'));
        const doc: any = buildDocumentoFiscal({
            id: 'd1', parsed, xmlHash: 'h', direcao: 'entrada', empresaId: 'e1', empresaCnpj: '11222333000181',
            empresaNome: 'X', origem: 'upload', importadoPor: 'u1', storagePath: 'x/5747.xml',
        } as any);
        expect(doc.valores.issRetido).toBe(false);
        expect(doc.valores.tpRetISSQN).toBe('1');
        // E com o código gravado, a nota não volta para a fila de releitura.
        expect(precisaReleituraIssRetido(doc)).toBe(false);
    });
});

describe('a releitura do XML guardado conserta o que já foi gravado', () => {
    it('nota antiga (gravada como retida, sem código) entra na fila', () => {
        expect(precisaReleituraIssRetido({ tipo: 'NFSe', storagePath: 'a.xml', valores: { issRetido: true } })).toBe(true);
        expect(precisaReleituraIssRetido({ tipo: 'NFSe', valores: { issRetido: true } })).toBe(false); // sem XML guardado
        expect(precisaReleituraIssRetido({ tipo: 'NFe', storagePath: 'a.xml' })).toBe(false);
        expect(precisaReleituraIssRetido({ tipo: 'NFSe', storagePath: 'a.xml', valores: { issRetidoRelidoEm: 'x' } })).toBe(false);
    });

    it('o patch desfaz a inversão e guarda o código cru', () => {
        const r = patchDaReleituraIssRetido(real('5725'), '2026-10-05T00:00:00.000Z');
        expect(r.nacional).toBe(true);
        expect(r.patch).toEqual({
            'valores.issRetido': false,
            'valores.tpRetISSQN': '1',
            'valores.issRetidoRelidoEm': '2026-10-05T00:00:00.000Z',
        });
    });

    it('XML de outro leiaute (ABRASF) só ganha o carimbo — nada é reescrito', () => {
        const abrasf = '<CompNfse><Nfse><InfNfse><Numero>1</Numero><ValoresNfse><IssRetido>1</IssRetido></ValoresNfse></InfNfse></Nfse></CompNfse>';
        const r = patchDaReleituraIssRetido(abrasf, 'T');
        expect(r.nacional).toBe(false);
        expect(r.patch).toEqual({ 'valores.issRetidoRelidoEm': 'T' });
    });
});

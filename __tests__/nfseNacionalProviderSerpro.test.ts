// @ts-expect-error — modulo .js puro transformado pelo ts-jest
import { __testables, NfseNacionalApiError } from '../sefaz-backend/nfse-nacional-provider.js';

describe('nfse-nacional-provider SERPRO helpers', () => {
    it('gzipXmlToBase64 and gunzipBase64ToText round-trip XML payloads', () => {
        const xml = '<DPS versao="1.01"><infDPS Id="DPS123"/></DPS>';
        const zipped = __testables.gzipXmlToBase64(xml);

        expect(typeof zipped).toBe('string');
        expect(zipped).not.toContain('<DPS');
        expect(__testables.gunzipBase64ToText(zipped)).toBe(xml);
    });

    it('prepararDpsXmlGZipB64 accepts pre-compressed DPS without loading certificate', async () => {
        await expect(__testables.prepararDpsXmlGZipB64({ dpsXmlGZipB64: 'abc123' }))
            .resolves.toBe('abc123');
    });

    it('montarDpsXmlBasica builds DPS 1.01 from the emission form', () => {
        const xml = __testables.montarDpsXmlBasica({
            prestador: {
                cnpj: '44.388.152/0001-89',
                im: '123456',
                nome: 'SP Contabil',
                municipioIbge: '3550308',
            },
            tomador: { cnpj: '11.222.333/0001-44', nome: 'Cliente LTDA' },
            servico: {
                codigoNbs: '101010100',
                descricao: 'Servicos contabeis',
                valor: 1500,
                aliquotaIss: 5,
                issRetido: false,
                municipioPrestacao: '3550308',
                cTribNac: '171801',
            },
            serieDps: '1',
            numeroDps: '123',
            dataEmissao: '2026-06-05T10:00:00-03:00',
        });

        expect(xml).toContain('<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">');
        expect(xml).toContain('<infDPS Id="DPS355030824438815200018900001000000000000123">');
        expect(xml).toContain('<cLocEmi>3550308</cLocEmi>');
        expect(xml).toContain('<CNPJ>44388152000189</CNPJ>');
        expect(xml).toContain('<cTribNac>171801</cTribNac>');
        expect(xml).toContain('<cNBS>101010100</cNBS>');
        expect(xml).toContain('<tpRetISSQN>1</tpRetISSQN>');
        expect(xml).toContain('<indTotTrib>0</indTotTrib>');
        expect(xml).toContain('<opSimpNac>3</opSimpNac>');
        expect(__testables.xmlGetInfDpsId(xml)).toBe('DPS355030824438815200018900001000000000000123');
    });

    it('prepararDpsXmlGZipB64 rejects incomplete automatic DPS payload before certificate load', async () => {
        await expect(__testables.prepararDpsXmlGZipB64({}))
            .rejects.toThrow('Prestador.cnpj');
    });

    it('normalizarNfseSerpro maps official response into persisted NFSe shape', () => {
        const chave = '12345678901234567890123456789012345678901234567890';
        const nfseXml = `
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infNFSe Id="NFS${chave}">
    <nNFSe>900001</nNFSe>
    <dhProc>2026-06-05T10:00:00-03:00</dhProc>
    <DPS>
      <infDPS Id="DPS355030812345678901234100001">
        <serv>
          <locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest>
          <cServ>
            <cTribNac>170101</cTribNac>
            <xDescServ>Servicos contabeis</xDescServ>
            <cNBS>101010100</cNBS>
          </cServ>
        </serv>
        <valores>
          <vServPrest><vServ>1500.00</vServ></vServPrest>
          <trib><tribMun><pAliq>5.00</pAliq></tribMun></trib>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;
        const req = {
            prestador: { cnpj: '44.388.152/0001-89', nome: 'SP Contabil' },
            tomador: { cnpj: '11.222.333/0001-44', nome: 'Cliente LTDA' },
            servico: {
                codigoNbs: '101010100',
                descricao: 'Servicos contabeis',
                valor: 1500,
                aliquotaIss: 5,
                issRetido: true,
            },
        };
        const response = {
            chaveAcesso: chave,
            idDps: 'DPS355030812345678901234100001',
            dataHoraProcessamento: '2026-06-05T10:00:00-03:00',
            tipoAmbiente: 1,
            versaoAplicativo: '1.0',
            nfseXmlGZipB64: __testables.gzipXmlToBase64(nfseXml),
        };

        const result = __testables.normalizarNfseSerpro(req, response, 'dps-gzip');

        expect(result.numero).toBe('900001');
        expect(result.chave).toBe(chave);
        expect(result.dpsRecibo).toBe('DPS355030812345678901234100001');
        expect(result.fonte).toBe('serpro');
        expect(result.prestador.cnpj).toBe('44388152000189');
        expect(result.tomador.cnpj).toBe('11222333000144');
        expect(result.valores.issRetido).toBe(75);
        expect(result.valores.liquido).toBe(1425);
        expect(result.serpro.tipoAmbiente).toBe(1);
    });

    it('NfseNacionalApiError surfaces SEFIN validation messages', () => {
        const err = new NfseNacionalApiError(400, {
            erros: [{ codigo: 'E001', descricao: 'DPS invalida' }],
        });

        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('E001 - DPS invalida');
    });
});

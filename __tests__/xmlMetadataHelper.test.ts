import {
    competenciaFromDhEmi,
    extrairParticipantesNfe,
} from '../sefaz-backend/xml-metadata-helper.js';

describe('xml-metadata-helper', () => {
    it('deriva competencia de data ISO e brasileira', () => {
        expect(competenciaFromDhEmi('2026-05-14T10:20:00-03:00')).toBe('2026-05');
        expect(competenciaFromDhEmi('14/05/2026')).toBe('2026-05');
        expect(competenciaFromDhEmi('')).toBeNull();
    });

    it('extrai emitente e destinatario pelos blocos corretos', () => {
        const xml = `
            <NFe>
                <infNFe>
                    <ide><dhEmi>2026-05-14T10:20:00-03:00</dhEmi></ide>
                    <emit>
                        <CNPJ>32602701000197</CNPJ>
                        <xNome>J.N. VINATEX COMERCIO LTDA</xNome>
                    </emit>
                    <dest>
                        <CNPJ>44388152000189</CNPJ>
                        <xNome>SP ASSESSORIA CONTABIL</xNome>
                    </dest>
                </infNFe>
            </NFe>
        `;

        expect(extrairParticipantesNfe(xml)).toEqual({
            emitente: { cnpj: '32602701000197', nome: 'J.N. VINATEX COMERCIO LTDA' },
            destinatario: { cnpj: '44388152000189', nome: 'SP ASSESSORIA CONTABIL' },
        });
    });
});

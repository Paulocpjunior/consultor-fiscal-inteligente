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
            emitente: {
                cnpj: '32602701000197', nome: 'J.N. VINATEX COMERCIO LTDA',
                uf: null, codMunIBGE: null, ie: null,
            },
            destinatario: {
                cnpj: '44388152000189', nome: 'SP ASSESSORIA CONTABIL',
                uf: null, codMunIBGE: null, ie: null,
            },
        });
    });
});

describe('endereço do participante (E010 do Exportar SAGE)', () => {
    // Sem UF o E-Fiscal recusa o cadastro do participante e TODAS as notas
    // atrás dele caem em cascata (caso 04/08: 30 sem UF ⇒ 54 notas fora).
    const xmlComEndereco = `
        <NFe><infNFe>
          <emit><CNPJ>32602701000197</CNPJ><xNome>FORNECEDOR X</xNome><IE>123456</IE>
            <enderEmit><xMun>SAO PAULO</xMun><cMun>3550308</cMun><UF>SP</UF></enderEmit>
          </emit>
          <dest><CNPJ>44388152000189</CNPJ><xNome>CLIENTE Y LTDA</xNome><IE>987654</IE>
            <enderDest><xMun>BELO HORIZONTE</xMun><cMun>3106200</cMun><UF>MG</UF></enderDest>
          </dest>
        </infNFe></NFe>`;

    it('captura UF, município IBGE e IE dos DOIS lados', () => {
        const p = extrairParticipantesNfe(xmlComEndereco);
        expect(p.destinatario).toEqual({
            cnpj: '44388152000189', nome: 'CLIENTE Y LTDA',
            uf: 'MG', codMunIBGE: '3106200', ie: '987654',
        });
        expect(p.emitente.uf).toBe('SP');
        expect(p.emitente.codMunIBGE).toBe('3550308');
    });

    it('a UF do destinatário NÃO vem do emitente (era o erro que dava tudo SP)', () => {
        const p = extrairParticipantesNfe(xmlComEndereco);
        expect(p.destinatario.uf).not.toBe(p.emitente.uf);
    });
});

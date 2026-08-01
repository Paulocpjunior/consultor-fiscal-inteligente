/**
 * Bloco de identificação dos relatórios (Paulo, 01/08): responsável legal da
 * empresa + contador responsável, montados do cadastro (dadosFiscais). A casca
 * imprime "não cadastrado" quando falta — o buraco fica visível no papel.
 */
import { montarIdentificacao } from '../services/relatorioPdf';

describe('montarIdentificacao', () => {
    it('monta as duas linhas com CPF formatado, cargo e CRC', () => {
        const r = montarIdentificacao({
            respLegalNome: 'João Sócio', respLegalCpf: '52998224725', respLegalCargo: 'Sócio administrador',
            contadorNome: 'Maria Contadora', contadorCrc: '1SP123456/O-8', contadorCpf: '39053344705',
        });
        expect(r.responsavel).toBe('João Sócio — CPF 529.982.247-25 — Sócio administrador');
        expect(r.contador).toBe('Maria Contadora — CRC 1SP123456/O-8 — CPF 390.533.447-05');
    });

    it('sem NOME cadastrado a linha é null (a casca escreve "não cadastrado")', () => {
        expect(montarIdentificacao({ respLegalCpf: '52998224725' }).responsavel).toBeNull();
        expect(montarIdentificacao(null).contador).toBeNull();
        expect(montarIdentificacao(undefined).responsavel).toBeNull();
    });

    it('campos opcionais ausentes não deixam separador órfão', () => {
        expect(montarIdentificacao({ respLegalNome: 'João' }).responsavel).toBe('João');
        expect(montarIdentificacao({ contadorNome: 'Maria', contadorCrc: 'CRC-SP 9999' }).contador)
            .toBe('Maria — CRC CRC-SP 9999');
    });
});

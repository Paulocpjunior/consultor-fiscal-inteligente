/**
 * Sanitização dos dados fiscais antes de salvar.
 *
 * Bug que voltou duas vezes (26/07 DARCY, 27/07 FASTWELD/Guarulhos): limpar o
 * CCM e salvar não apagava nada. Causa: o campo vazio virava `undefined`, o
 * JSON perdia a chave e o backend nunca recebia ordem de apagar.
 * Contrato travado aqui: LIMPO = '' (apaga) · INTOCADO = ausente (não mexe).
 */
import { sanitizarDadosFiscais } from '../services/empresaDadosFiscaisSanitize';

describe('sanitizarDadosFiscais — apagar × não mexer', () => {
    it('campo LIMPO vira string vazia (a ordem de apagar chega ao backend)', () => {
        const r = sanitizarDadosFiscais({ ccmSp: '', inscricaoMunicipal: '' });
        expect(r.ccmSp).toBe('');
        expect('ccmSp' in r).toBe(true);
        expect(JSON.parse(JSON.stringify(r))).toHaveProperty('ccmSp', '');
        expect(r.inscricaoMunicipal).toBe('');
    });

    it('campo INTOCADO fica ausente do payload (não mexe no valor gravado)', () => {
        const r = sanitizarDadosFiscais({ uf: 'sp' });
        expect(r.ccmSp).toBeUndefined();
        expect(JSON.parse(JSON.stringify(r))).not.toHaveProperty('ccmSp');
    });

    it('CCM só-zeros (contorno da equipe) equivale a vazio', () => {
        expect(sanitizarDadosFiscais({ ccmSp: '000000000' }).ccmSp).toBe('');
        expect(sanitizarDadosFiscais({ ccmSp: '0' }).ccmSp).toBe('');
    });

    it('CCM válido fica só com dígitos', () => {
        expect(sanitizarDadosFiscais({ ccmSp: '8.680.431-0' }).ccmSp).toBe('86804310');
    });

    it('empresa fora de SP capital: apaga o CCM e mantém a inscrição municipal genérica', () => {
        // Caso FASTWELD (Guarulhos, 3518800): o CCM tinha sido copiado da IM.
        const r = sanitizarDadosFiscais({ codMunIBGE: '3518800', ccmSp: '', inscricaoMunicipal: '08680431' });
        expect(r.ccmSp).toBe('');
        expect(r.inscricaoMunicipal).toBe('08680431');
        expect(r.codMunIBGE).toBe('3518800');
    });

    it('UF e IE sobem em maiúsculas; CEP/telefone só dígitos', () => {
        const r = sanitizarDadosFiscais({ uf: ' sp ', inscricaoEstadual: ' isento ', cep: '07031-010', telefone: '(11) 99999-8888' });
        expect(r.uf).toBe('SP');
        expect(r.inscricaoEstadual).toBe('ISENTO');
        expect(r.cep).toBe('07031010');
        expect(r.telefone).toBe('11999998888');
    });

    it('inscrição municipal alfanumérica (varia por prefeitura) não é mutilada', () => {
        expect(sanitizarDadosFiscais({ inscricaoMunicipal: ' 12345/001-A ' }).inscricaoMunicipal).toBe('12345/001-A');
    });
});

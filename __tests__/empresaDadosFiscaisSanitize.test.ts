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

    it('condição rural: booleano desmarcado chega como false (não some do JSON)', () => {
        const r = sanitizarDadosFiscais({ condicaoRural: { adquireDeProdutor: true } } as any);
        expect(r.condicaoRural).toEqual({
            adquireDeProdutor: true, ehProdutorRuralPF: false, ehCooperativa: false,
            funruralSubRogacao: 'automatico', observacao: '',
        });
        // Bloco intocado continua ausente — não mexe no que está gravado.
        expect(sanitizarDadosFiscais({} as any).condicaoRural).toBeUndefined();
    });

    it('CNAE e data de abertura: trim, e limpar = apagar (a pendência sem tela, 31/07)', () => {
        const r = sanitizarDadosFiscais({ cnae: ' 4712-1/00 ', dataAbertura: ' 2015-03-01 ' } as any);
        expect(r.cnae).toBe('4712-1/00');
        expect(r.dataAbertura).toBe('2015-03-01');
        const limpo = sanitizarDadosFiscais({ cnae: '' } as any);
        expect(limpo.cnae).toBe('');            // '' = ordem de apagar
        expect(limpo.dataAbertura).toBeUndefined(); // intocado não vai
    });

    it('responsável legal e contador: CPFs em dígitos, CRC livre, limpar = apagar', () => {
        const r = sanitizarDadosFiscais({
            respLegalNome: ' João Sócio ', respLegalCpf: '529.982.247-25', respLegalCargo: ' Sócio administrador ',
            contadorNome: ' Maria ', contadorCrc: ' 1SP123456/O-8 ', contadorCpf: '390.533.447-05',
        } as any);
        expect(r.respLegalNome).toBe('João Sócio');
        expect(r.respLegalCpf).toBe('52998224725');
        expect(r.respLegalCargo).toBe('Sócio administrador');
        expect(r.contadorCrc).toBe('1SP123456/O-8'); // formato livre — não stripa
        expect(r.contadorCpf).toBe('39053344705');
        const limpo = sanitizarDadosFiscais({ contadorNome: '' } as any);
        expect(limpo.contadorNome).toBe('');          // '' = ordem de apagar
        expect(limpo.respLegalNome).toBeUndefined();  // intocado não vai
    });

    it('inscrição municipal alfanumérica (varia por prefeitura) não é mutilada', () => {
        expect(sanitizarDadosFiscais({ inscricaoMunicipal: ' 12345/001-A ' }).inscricaoMunicipal).toBe('12345/001-A');
    });
});

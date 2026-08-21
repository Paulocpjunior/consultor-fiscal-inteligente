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

    it('MÚLTIPLOS responsáveis: linha vazia cai fora e o 1º espelha no legado', () => {
        const r = sanitizarDadosFiscais({
            responsaveisLegais: [
                { nome: ' João ', cpf: '529.982.247-25', cargo: ' Sócio ' },
                { nome: '', cpf: '', cargo: '' },
                { nome: 'Maria', cpf: '', cargo: 'Sócia' },
            ],
        } as any);
        expect(r.responsaveisLegais).toEqual([
            { nome: 'João', cpf: '52998224725', cargo: 'Sócio' },
            { nome: 'Maria', cpf: '', cargo: 'Sócia' },
        ]);
        expect(r.respLegalNome).toBe('João');       // espelho do 1º
        expect(r.respLegalCpf).toBe('52998224725');
        // Lista tocada e esvaziada = ordem de apagar (legado zera junto)
        const vazio = sanitizarDadosFiscais({ responsaveisLegais: [{ nome: ' ' }] } as any);
        expect(vazio.responsaveisLegais).toEqual([]);
        expect(vazio.respLegalNome).toBe('');
        // Intocada não mexe em nada
        expect(sanitizarDadosFiscais({} as any).responsaveisLegais).toBeUndefined();
    });

    it('inscrição municipal alfanumérica (varia por prefeitura) não é mutilada', () => {
        expect(sanitizarDadosFiscais({ inscricaoMunicipal: ' 12345/001-A ' }).inscricaoMunicipal).toBe('12345/001-A');
    });
});

// ─── A régua do CCM só-zeros na LEITURA (21/08, caso LAV) ────────────────────
import { soZerosComoVazio } from '../services/empresaDadosFiscaisSanitize';

describe('soZerosComoVazio — CCM "00000000" vale como VAZIO em todo leitor', () => {
    it('zeros, vazio e zero solto viram null', () => {
        expect(soZerosComoVazio('00000000')).toBeNull();
        expect(soZerosComoVazio('0')).toBeNull();
        expect(soZerosComoVazio('')).toBeNull();
        expect(soZerosComoVazio(null)).toBeNull();
    });
    it('inscrição de verdade passa intacta (sem reformatar)', () => {
        expect(soZerosComoVazio('29175976')).toBe('29175976');
        expect(soZerosComoVazio('4.019.814')).toBe('4.019.814');
    });
});

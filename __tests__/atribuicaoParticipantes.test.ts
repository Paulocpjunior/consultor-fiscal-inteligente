/**
 * Atribuição por participantes (caso autXML / Grupo Nova Era, 30/07).
 *
 * Doc capturado pelo DistDFe do ESCRITÓRIO onde ele não é emit nem dest
 * (chegou pela tag autXML) ficava empresaId=escritório + direcao='desconhecida'
 * — invisível como saída do cliente. A regra travada aqui: emitente cadastrado
 * → saída daquela empresa; senão destinatário cadastrado → entrada.
 */

// @ts-expect-error — modulo .js puro
import { decidirDonoPorParticipantes } from '../sefaz-backend/atribuicao-participantes.js';

const ESCRITORIO = '44388152000189';
const NOVAERA_FILIAL = '29240822000202';
const NOVAERA_MATRIZ = '29240822000121';
const TERCEIRO = '11222333000144';

const cadastro = (...pares: Array<[string, string]>) =>
    new Map(pares.map(([cnpj, empresaId]) => [cnpj, { empresaId }]));

describe('decidirDonoPorParticipantes', () => {
    it('emitente cadastrado → SAÍDA da empresa emitente (trilho autXML)', () => {
        const r = decidirDonoPorParticipantes({
            cnpjEmit: NOVAERA_FILIAL,
            cnpjDest: TERCEIRO,
            empresaAtualCnpj: ESCRITORIO,
            empresasPorCnpj: cadastro([NOVAERA_FILIAL, 'EMP-FILIAL']),
        });
        expect(r).toEqual({
            empresaId: 'EMP-FILIAL', empresaCnpj: NOVAERA_FILIAL,
            direcao: 'saida', motivo: 'emitente-cadastrado',
        });
    });

    it('emitente cadastrado com tpNF=0 → ENTRADA (nota própria de compra de produtor)', () => {
        const r = decidirDonoPorParticipantes({
            cnpjEmit: NOVAERA_FILIAL,
            cnpjDest: TERCEIRO,
            empresaAtualCnpj: ESCRITORIO,
            empresasPorCnpj: cadastro([NOVAERA_FILIAL, 'EMP-FILIAL']),
            tpNF: '0',
        });
        expect(r?.direcao).toBe('entrada');
        expect(r?.empresaId).toBe('EMP-FILIAL');
    });

    it('emitente NÃO cadastrado mas destinatário sim → ENTRADA do destinatário', () => {
        const r = decidirDonoPorParticipantes({
            cnpjEmit: TERCEIRO,
            cnpjDest: NOVAERA_MATRIZ,
            empresaAtualCnpj: ESCRITORIO,
            empresasPorCnpj: cadastro([NOVAERA_MATRIZ, 'EMP-MATRIZ']),
        });
        expect(r).toEqual({
            empresaId: 'EMP-MATRIZ', empresaCnpj: NOVAERA_MATRIZ,
            direcao: 'entrada', motivo: 'destinatario-cadastrado',
        });
    });

    it('emitente cadastrado tem PRIORIDADE sobre destinatário cadastrado (transferência interna)', () => {
        // Transferência filial→matriz com as duas cadastradas: a nota é atribuída
        // como SAÍDA da filial (o destinatário a recebe pelo próprio DistDFe).
        const r = decidirDonoPorParticipantes({
            cnpjEmit: NOVAERA_FILIAL,
            cnpjDest: NOVAERA_MATRIZ,
            empresaAtualCnpj: ESCRITORIO,
            empresasPorCnpj: cadastro([NOVAERA_FILIAL, 'EMP-FILIAL'], [NOVAERA_MATRIZ, 'EMP-MATRIZ']),
        });
        expect(r?.empresaId).toBe('EMP-FILIAL');
        expect(r?.direcao).toBe('saida');
    });

    it('empresa atual já é participante → null (atribuição normal resolve)', () => {
        expect(decidirDonoPorParticipantes({
            cnpjEmit: NOVAERA_FILIAL,
            cnpjDest: ESCRITORIO,
            empresaAtualCnpj: ESCRITORIO,
            empresasPorCnpj: cadastro([NOVAERA_FILIAL, 'EMP-FILIAL']),
        })).toBeNull();
    });

    it('nenhum participante cadastrado → null (mantém atribuição atual)', () => {
        expect(decidirDonoPorParticipantes({
            cnpjEmit: TERCEIRO,
            cnpjDest: '55666777000188',
            empresaAtualCnpj: ESCRITORIO,
            empresasPorCnpj: cadastro(),
        })).toBeNull();
    });

    it('sem dono explícito (Consultar + Importar): venda a terceiro vira SAÍDA da emitente cadastrada', () => {
        // Caso card 4 (30/07): a rota de importar-por-chave mandava
        // empresaCnpj = destinatário. Numa VENDA a terceiro, a nota era
        // gravada como "entrada do terceiro" (nem cliente é). Sem dono
        // explícito (empresaAtualCnpj null), o cadastro decide.
        const r = decidirDonoPorParticipantes({
            cnpjEmit: NOVAERA_FILIAL,
            cnpjDest: TERCEIRO,
            empresaAtualCnpj: null,
            empresasPorCnpj: cadastro([NOVAERA_FILIAL, 'EMP-FILIAL']),
        });
        expect(r).toEqual({
            empresaId: 'EMP-FILIAL', empresaCnpj: NOVAERA_FILIAL,
            direcao: 'saida', motivo: 'emitente-cadastrado',
        });
    });

    it('tolera CNPJs formatados, vazios e mapa ausente', () => {
        const r = decidirDonoPorParticipantes({
            cnpjEmit: '29.240.822/0002-02',
            cnpjDest: null,
            empresaAtualCnpj: '44.388.152/0001-89',
            empresasPorCnpj: cadastro([NOVAERA_FILIAL, 'EMP-FILIAL']),
        });
        expect(r?.empresaId).toBe('EMP-FILIAL');
        expect(decidirDonoPorParticipantes({
            cnpjEmit: NOVAERA_FILIAL, cnpjDest: null,
            empresaAtualCnpj: null, empresasPorCnpj: null as any,
        })).toBeNull();
    });
});

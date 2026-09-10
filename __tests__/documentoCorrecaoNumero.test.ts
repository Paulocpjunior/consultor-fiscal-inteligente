// ============================================================================
// 🚨 O NÚMERO DA NOTA DIGITADA ESTAVA ERRADO — e "relançar por cima" DUPLICA
//
// (10/09, Paulo, HANAMI EMBALAGENS · NF-e de saída lançada à mão: *"precisava
// fazer uma correção em uma nota q eu lancei manualmente … O correto seria
// 9792, oq eu posso fazer nesse caso?"* — ela está gravada como **792**.)
//
// O ✍️ Lançar nota sem XML diz, ao regravar, *"Nota nº X REGRAVADA (corrigiu a
// digitação anterior)"* — e isso vale para todo campo MENOS os três que formam
// o id: número, série e a competência da emissão. O primeiro teste aqui é a
// PROVA do defeito: relançar com 9792 monta um id DIFERENTE.
//
// CNPJs FICTÍCIOS — dado de cliente não entra no repo.
// ============================================================================
import {
    corrigirNumeroDaNotaDigitada, idComOutroNumero, explicarCorrecao,
} from '../services/documentoCorrecaoNumero';
import { idNotaDigitada } from '../services/notaDigitada';
import { explicarRetirada } from '../services/documentoRetirada';

const AUTOR = { uid: 'uid-1', email: 'colaborador@exemplo.com.br' };
const AGORA = new Date('2026-09-10T12:00:00-03:00');

/** A nota do caso, na forma que o ✍️ grava. */
const NOTA_792: any = {
    id: 'digitada_emp-1_792_1_2026-08',
    origem: 'digitada',
    tipo: 'NFe',
    tipoDoc: 'NFe',
    numero: '792',
    serie: '1',
    chave: '',
    empresaId: 'emp-1',
    empresaNome: 'HANAMI TESTE LTDA',
    competencia: '2026-08',
    dhEmi: '2026-08-23T10:00:00-03:00',
    valorTotal: 3545.85,
};

describe('a razão de este módulo existir', () => {
    it('relançar a MESMA nota com outro número monta um id DIFERENTE — nasce um segundo documento', () => {
        const base = {
            empresaId: 'emp-1', empresaCnpj: '11222333000181', empresaNome: 'HANAMI TESTE LTDA',
            direcao: 'saida' as const, serie: '1', dhEmi: '2026-08-23T10:00:00-03:00',
            participanteDoc: '44555666000177', participanteNome: 'CLIENTE TESTE LTDA',
            valorTotal: 3545.85, itens: [{ cfop: '5102', vProd: 3545.85 }],
            digitadaPorEmail: 'colaborador@exemplo.com.br', createdByUid: 'uid-1',
        };
        const idErrado = idNotaDigitada({ ...base, numero: '792' } as any);
        const idCerto = idNotaDigitada({ ...base, numero: '9792' } as any);
        expect(idErrado).not.toBe(idCerto);
    });

    it('o id que a correção monta é o MESMO que a digitação montaria — nunca uma segunda fórmula', () => {
        // Se esta trava cair, o "corrigir" gravaria num id que o ✍️ não conhece:
        // a nota corrigida ficaria invisível para o relançamento e a próxima
        // digitação criaria uma TERCEIRA cópia.
        expect(idComOutroNumero(NOTA_792, '792', '1')).toBe(NOTA_792.id);
        expect(idComOutroNumero(NOTA_792, '9792', '1')).toBe('digitada_emp-1_9792_1_2026-08');
    });
});

describe('o caso HANAMI — 792 vira 9792', () => {
    const r: any = corrigirNumeroDaNotaDigitada(NOTA_792, '9792', '', AUTOR, null, AGORA);

    it('aceita, e o modo é documento NOVO porque o id muda', () => {
        expect(r.ok).toBe(true);
        expect(r.modo).toBe('novo-documento');
        expect(r.idNovo).toBe('digitada_emp-1_9792_1_2026-08');
        expect(r.numeroNovo).toBe('9792');
    });

    it('a nota antiga é ENTERRADA no mesmo ato — senão a venda conta duas vezes', () => {
        expect(r.patchAntigo._deleted).toBe(true);
        expect(r.patchAntigo._corrigidaPara).toBe('digitada_emp-1_9792_1_2026-08');
        expect(r.patchAntigo._corrigidaParaNumero).toBe('9792');
        expect(String(r.patchAntigo._deletedMotivo)).toMatch(/792.*9792/);
    });

    it('a decisão fica com AUTOR e data — reescrever identidade de documento fiscal sem dono não se confere', () => {
        expect(r.patchAntigo._deletedPorEmail).toBe('colaborador@exemplo.com.br');
        expect(r.patchAntigo._deletedPor).toBe('uid-1');
        expect(r.patchNovo.correcaoNumero.deNumero).toBe('792');
        expect(r.patchNovo.correcaoNumero.paraNumero).toBe('9792');
        expect(r.patchNovo.correcaoNumero.documentoAnterior).toBe(NOTA_792.id);
    });

    it('o documento novo nasce em nome de QUEM CORRIGE — e o digitador original fica registrado', () => {
        const comDono: any = corrigirNumeroDaNotaDigitada(
            { ...NOTA_792, createdBy: 'uid-de-quem-digitou' }, '9792', '', AUTOR, null, AGORA);
        expect(comDono.patchNovo.createdBy).toBe('uid-1');
        expect(comDono.patchNovo.correcaoNumero.createdByOriginal).toBe('uid-de-quem-digitou');
    });

    it('o aviso DIZ que a antiga saiu junto — sem isso a pessoa vai procurar a duplicata', () => {
        expect(r.avisoDepois).toMatch(/não conta duas vezes|NÃO conta duas vezes/i);
    });

    it('a série entra no de-para quando muda', () => {
        const c: any = corrigirNumeroDaNotaDigitada(NOTA_792, '9792', '2', AUTOR, null, AGORA);
        expect(c.ok).toBe(true);
        expect(c.idNovo).toBe('digitada_emp-1_9792_2_2026-08');
        expect(c.avisoDepois).toMatch(/série 1 → 2/);
    });
});

describe('o que ela RECUSA, e por quê', () => {
    it('documento com XML — o número é o que o documento declara', () => {
        const r: any = corrigirNumeroDaNotaDigitada(
            { ...NOTA_792, origem: 'sefaz' }, '9792', '', AUTOR, null, AGORA);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/Substituir/);
    });

    it('nota digitada COM chave — a chave já declara o número', () => {
        const r: any = corrigirNumeroDaNotaDigitada(
            { ...NOTA_792, chave: '3'.repeat(44) }, '9792', '', AUTOR, null, AGORA);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/chave/i);
    });

    it('já existe documento no destino — o que sobra é a DUPLICATA, e a recusa manda tirá-la', () => {
        const r: any = corrigirNumeroDaNotaDigitada(
            NOTA_792, '9792', '', AUTOR, { origem: 'digitada', numero: '9792' }, AGORA);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/já existe/i);
        expect(r.motivo).toMatch(/duas vezes/);
        // A ação é NOMEADA: tirar a errada, nunca sobrescrever a certa.
        expect(r.motivo).toMatch(/792/);
    });

    it('mesmo número e mesma série — não há o que corrigir', () => {
        const r: any = corrigirNumeroDaNotaDigitada(NOTA_792, '792', '1', AUTOR, null, AGORA);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/não há o que corrigir/i);
    });

    it('sem número, recusa em vez de gravar vazio', () => {
        const r: any = corrigirNumeroDaNotaDigitada(NOTA_792, '   ', '', AUTOR, null, AGORA);
        expect(r.ok).toBe(false);
    });

    it('sem UID (só e-mail), recusa o documento NOVO — o Firestore exige createdBy no CREATE', () => {
        // 🚨 É a regra que fez o ✍️ nunca gravar até 17/08. Sem esta trava a
        // gravação voltaria como "Missing or insufficient permissions", que
        // manda procurar um problema de permissão que não existe.
        const r: any = corrigirNumeroDaNotaDigitada(
            NOTA_792, '9792', '', { email: 'colaborador@exemplo.com.br' }, null, AGORA);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/em seu nome|Sessão expirada/);
    });

    it('sem autor, recusa — decisão sem dono não se confere depois', () => {
        const r: any = corrigirNumeroDaNotaDigitada(NOTA_792, '9792', '', null, null, AGORA);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/Sessão expirada/);
    });

    it('nota já tirada do livro não se corrige — repetir sobrescreveria a lápide', () => {
        const r: any = corrigirNumeroDaNotaDigitada(
            { ...NOTA_792, _deleted: true }, '9792', '', AUTOR, null, AGORA);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/já foi tirada/i);
    });
});

describe('NFS-e — a identidade é tomador + prestador + número', () => {
    const NFSE: any = {
        id: 'nfsesp-44555666000177-11222333000181-501',
        origem: 'digitada',
        tipo: 'NFSe',
        tipoDoc: 'NFSe',
        numero: '501',
        serie: '1',
        chave: null,
        empresaId: 'emp-2',
        competencia: '2026-08',
        prestadorCnpj: '11222333000181',
        tomadorCnpj: '44555666000177',
    };

    it('trocar o número muda o id — e a fórmula é a MESMA dos importadores', () => {
        const r: any = corrigirNumeroDaNotaDigitada(NFSE, '5010', '', AUTOR, null, AGORA);
        expect(r.ok).toBe(true);
        expect(r.modo).toBe('novo-documento');
        expect(r.idNovo).toBe('nfsesp-44555666000177-11222333000181-5010');
    });

    it('trocar SÓ a série é troca de campo no MESMO documento — nada nasce, nada é enterrado', () => {
        const r: any = corrigirNumeroDaNotaDigitada(NFSE, '501', '2', AUTOR, null, AGORA);
        expect(r.ok).toBe(true);
        expect(r.modo).toBe('patch');
        expect(r.patchAntigo).toBeNull();
        expect(r.idNovo).toBe(NFSE.id);
    });
});

describe('a frase do estado', () => {
    it('a nota corrigida NÃO diz "tirada desta empresa" — ela não saiu da empresa', () => {
        const enterrada = {
            _deleted: true,
            _corrigidaPara: 'digitada_emp-1_9792_1_2026-08',
            _corrigidaParaNumero: '9792',
            _deletedEm: AGORA.toISOString(),
            _deletedPorEmail: 'colaborador@exemplo.com.br',
            numero: '792',
        };
        const frase = explicarCorrecao(enterrada);
        expect(frase).toMatch(/CORRIGIDA/);
        expect(frase).toMatch(/9792/);
        expect(frase).not.toMatch(/tirada desta empresa/i);
        // A da retirada continua existindo e diria a causa ERRADA aqui — é por
        // isso que a tela lê a correção PRIMEIRO.
        expect(explicarRetirada(enterrada as any)).toMatch(/Tirada desta empresa/);
    });

    it('nota viva não tem frase de correção', () => {
        expect(explicarCorrecao(NOTA_792)).toBeNull();
    });
});

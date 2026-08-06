// @ts-expect-error — módulo .js puro (sem tipos)
import { montarPainelIssCarteira, farolDaCarteira } from '../sefaz-backend/iss-carteira';

/**
 * A aba 🏛️ ISS SP responde UMA empresa por vez. A onda 1 da migração são 157
 * empresas de serviço puro — perguntar "quem tem ISS a recolher?" 157 vezes não
 * acontece, então na prática ninguém pergunta. Este é o painel da carteira.
 */
const emp = (over: any = {}) => ({
    empresaId: over.empresaId || 'e1',
    nome: over.nome || 'EMPRESA',
    cnpj: over.cnpj || '13344638000191',
    ccm: over.ccm ?? '46129308',
    issFixoSup: !!over.issFixoSup,
    ...over,
});
const ap = (over: any = {}) => ({
    empresaId: over.empresaId || 'e1',
    notas: 4, issDevido: 192, issRetido: 0, aRecolher: 192, semValorGravado: 0,
    ...over,
});
const confiavel = () => true;

describe('situação de cada empresa no mês', () => {
    it('tem valor a recolher: entra no total', () => {
        const p = montarPainelIssCarteira({ empresas: [emp()], apuracoes: [ap()], zeroConfiavelPara: confiavel });
        expect(p.linhas[0].situacao).toBe('a-recolher');
        expect(p.resumo.totalARecolher).toBe(192);
    });

    it('sem CCM é BLOQUEADA, não "sem movimento" — a captura nem roda', () => {
        const p = montarPainelIssCarteira({
            empresas: [emp({ ccm: '' })], apuracoes: [ap({ notas: 0, issDevido: 0, aRecolher: 0 })],
            zeroConfiavelPara: confiavel,
        });
        expect(p.linhas[0].situacao).toBe('sem-ccm');
        expect(p.linhas[0].acao).toMatch(/nem roda/);
        expect(p.farol).toBe('atencao');
    });

    it('CCM só-zeros vale como vazio (#311)', () => {
        const p = montarPainelIssCarteira({ empresas: [emp({ ccm: '00000000' })], apuracoes: [ap()], zeroConfiavelPara: confiavel });
        expect(p.linhas[0].situacao).toBe('sem-ccm');
    });

    it('zero notas com captura NÃO confiável é incerteza, nunca "sem movimento"', () => {
        const p = montarPainelIssCarteira({
            empresas: [emp()], apuracoes: [ap({ notas: 0, issDevido: 0, aRecolher: 0 })],
            zeroConfiavelPara: () => false,
        });
        expect(p.linhas[0].situacao).toBe('captura-incerta');
        expect(p.linhas[0].acao).toMatch(/não dá pra afirmar que o cliente não emitiu/);
    });

    it('zero notas com captura confiável pode dizer "sem movimento"', () => {
        const p = montarPainelIssCarteira({
            empresas: [emp()], apuracoes: [ap({ notas: 0, issDevido: 0, aRecolher: 0 })],
            zeroConfiavelPara: confiavel,
        });
        expect(p.linhas[0].situacao).toBe('sem-movimento');
    });

    it('nota sem ISS gravado bloqueia — ausente ≠ zero', () => {
        const p = montarPainelIssCarteira({
            empresas: [emp()], apuracoes: [ap({ semValorGravado: 2 })], zeroConfiavelPara: confiavel,
        });
        expect(p.linhas[0].situacao).toBe('captura-incerta');
        expect(p.linhas[0].acao).toMatch(/2 nota\(s\) sem o ISS gravado/);
    });

    it('ISS fixo (SUP) fica FORA do total — a guia dele não sai do faturamento', () => {
        const p = montarPainelIssCarteira({
            empresas: [emp({ issFixoSup: true })], apuracoes: [ap({ aRecolher: 5000 })], zeroConfiavelPara: confiavel,
        });
        expect(p.linhas[0].situacao).toBe('iss-fixo');
        expect(p.linhas[0].aRecolher).toBe(0);
        expect(p.resumo.totalARecolher).toBe(0);
        expect(p.avisos.join(' ')).toMatch(/ficam FORA do total/);
    });

    it('tudo retido pelo tomador: não há guia do prestador', () => {
        const p = montarPainelIssCarteira({
            empresas: [emp()], apuracoes: [ap({ issRetido: 192, aRecolher: 0 })], zeroConfiavelPara: confiavel,
        });
        expect(p.linhas[0].situacao).toBe('so-retido');
        expect(p.linhas[0].acao).toMatch(/quem recolhe é quem contratou/);
    });

    it('empresa sem apuração nenhuma não some da lista', () => {
        const p = montarPainelIssCarteira({ empresas: [emp()], apuracoes: [], zeroConfiavelPara: () => false });
        expect(p.linhas).toHaveLength(1);
        expect(p.linhas[0].situacao).toBe('captura-incerta');
    });
});

describe('ordem e farol da carteira', () => {
    it('quem precisa de ação vem primeiro; empatou, o maior valor', () => {
        const p = montarPainelIssCarteira({
            empresas: [
                emp({ empresaId: 'a', nome: 'MENOR', cnpj: '1' }),
                emp({ empresaId: 'b', nome: 'MAIOR', cnpj: '2' }),
                emp({ empresaId: 'c', nome: 'SEM CCM', cnpj: '3', ccm: '' }),
            ],
            apuracoes: [
                ap({ empresaId: 'a', aRecolher: 10 }),
                ap({ empresaId: 'b', aRecolher: 900 }),
                ap({ empresaId: 'c' }),
            ],
            zeroConfiavelPara: confiavel,
        });
        expect(p.linhas.map((l: any) => l.nome)).toEqual(['SEM CCM', 'MAIOR', 'MENOR']);
    });

    it('carteira INTEIRA sem nota nenhuma não é verde — é sintoma de captura quebrada', () => {
        const p = montarPainelIssCarteira({
            empresas: [emp({ empresaId: 'a' }), emp({ empresaId: 'b', cnpj: '2' })],
            apuracoes: [
                ap({ empresaId: 'a', notas: 0, issDevido: 0, aRecolher: 0 }),
                ap({ empresaId: 'b', notas: 0, issDevido: 0, aRecolher: 0 }),
            ],
            zeroConfiavelPara: confiavel,
        });
        expect(p.farol).toBe('atencao');
        expect(p.avisos.join(' ')).toMatch(/quase nunca é mês parado/);
    });

    it('carteira saudável com movimento é verde', () => {
        const p = montarPainelIssCarteira({ empresas: [emp()], apuracoes: [ap()], zeroConfiavelPara: confiavel });
        expect(p.farol).toBe('ok');
        expect(p.avisos).toEqual([]);
    });

    it('sem empresa nenhuma não inventa farol', () => {
        expect(farolDaCarteira({ empresas: 0 })).toBe('sem-dados');
    });
});

/**
 * Varredura REAL do Paulo (06/08): "AF PET SHOP — sem movimento — 29 notas",
 * "3D PICTURES — sem movimento — 7 notas". Empresa com 29 notas não está sem
 * movimento: ela TEM movimento, o que está zerado é o ISS. Chamar isso de "sem
 * movimento" é o farol mentindo — e é a mesma classe de erro do dia inteiro.
 */
describe('nota no mês com ISS zerado NÃO é "sem movimento"', () => {
    const empresa = { empresaId: 'a', nome: 'AF PET SHOP', cnpj: '1', ccm: '123', issFixoSup: false };

    it('29 notas com ISS zerado vira pendência de conferência, não silêncio', () => {
        const p = montarPainelIssCarteira({
            empresas: [empresa],
            apuracoes: [{ empresaId: 'a', notas: 29, issDevido: 0, issRetido: 0, aRecolher: 0, semValorGravado: 0 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('iss-zerado');
        expect(p.linhas[0].acao).toMatch(/29 nota\(s\) emitida\(s\)/);
        expect(p.linhas[0].acao).toMatch(/isenção, imunidade/);
        expect(p.resumo.issZerado).toBe(1);
        expect(p.farol).toBe('atencao');
    });

    it('ZERO nota com captura confiável continua sendo "sem movimento"', () => {
        const p = montarPainelIssCarteira({
            empresas: [empresa],
            apuracoes: [{ empresaId: 'a', notas: 0, issDevido: 0, issRetido: 0, aRecolher: 0, semValorGravado: 0 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('sem-movimento');
    });

    it('o aviso da carteira nomeia quantas empresas estão nesse caso', () => {
        const p = montarPainelIssCarteira({
            empresas: [empresa, { ...empresa, empresaId: 'b', cnpj: '2' }],
            apuracoes: [
                { empresaId: 'a', notas: 7, issDevido: 0, issRetido: 0, aRecolher: 0 },
                { empresaId: 'b', notas: 1, issDevido: 0, issRetido: 0, aRecolher: 0 },
            ],
            zeroConfiavelPara: () => true,
        });
        expect(p.avisos.join(' ')).toMatch(/2 empresa\(s\) TÊM nota no mês com o ISS zerado/);
        expect(p.avisos.join(' ')).toMatch(/não é "sem movimento"/);
    });
});

/**
 * O ISS de TOMADOR entrou na tela de UMA empresa (#509) e a carteira ficou sem
 * saber dele — ou seja, empresa que só tem retenção como tomadora continuava
 * aparecendo como "sem movimento". É o MESMO falso-negativo que a gente
 * acabou de corrigir no ISS próprio, na tela do lado.
 */
describe('ISS retido como TOMADORA na carteira', () => {
    const base = { empresaId: 'a', nome: 'TOMADORA', cnpj: '1', ccm: '123', issFixoSup: false };

    it('empresa SEM nota emitida mas COM retenção não é "sem movimento"', () => {
        const p = montarPainelIssCarteira({
            empresas: [base],
            apuracoes: [{ empresaId: 'a', notas: 0, issDevido: 0, issRetido: 0, aRecolher: 0, tomadoRetido: 800, tomadoNotas: 3 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('so-tomado');
        expect(p.linhas[0].acao).toMatch(/reteve ISS de 3 prestador\(es\)/);
        expect(p.linhas[0].acao).toMatch(/é outra guia/);
    });

    it('o tomado NÃO entra no total a recolher — são guias diferentes', () => {
        const p = montarPainelIssCarteira({
            empresas: [base],
            apuracoes: [{ empresaId: 'a', notas: 2, issDevido: 100, issRetido: 0, aRecolher: 100, tomadoRetido: 800, tomadoNotas: 3 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.resumo.totalARecolher).toBe(100);
        expect(p.resumo.totalIssTomado).toBe(800);
        expect(p.resumo.comIssTomado).toBe(1);
        expect(p.avisos.join(' ')).toMatch(/Não soma com o ISS próprio/);
    });

    it('carteira só com tomado NÃO acende o alarme de "ninguém teve nota"', () => {
        // Ali o alarme existe pra denunciar captura quebrada. Com retenção
        // apurada, houve movimento — acender seria alarme falso.
        const p = montarPainelIssCarteira({
            empresas: [base],
            apuracoes: [{ empresaId: 'a', notas: 0, issDevido: 0, issRetido: 0, aRecolher: 0, tomadoRetido: 800, tomadoNotas: 1 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.avisos.join(' ')).not.toMatch(/quase nunca é mês parado/);
    });

    it('sem tomado, nada muda no comportamento antigo', () => {
        const p = montarPainelIssCarteira({ empresas: [emp()], apuracoes: [ap()], zeroConfiavelPara: confiavel });
        expect(p.resumo.comIssTomado).toBe(0);
        expect(p.linhas[0].situacao).toBe('a-recolher');
    });
});

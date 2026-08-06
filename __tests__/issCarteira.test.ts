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
        expect(p.avisos.join(' ')).toMatch(/2 empresa\(s\) com ISS zerado que a própria nota NÃO explica/);
        // Carteira COM nota (ainda que zerada) não pode disparar o alarme de
        // "ninguém teve nota" — esse alarme é de captura quebrada.
        expect(p.avisos.join(' ')).not.toMatch(/quase nunca é mês parado/);
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

/**
 * A CONTA do ISS saiu de dentro da rota e virou núcleo — porque agora são DOIS
 * painéis lendo a mesma coisa (a aba 🏛️ ISS SP e a Rotina do mês), e a forma
 * como se lê é justamente a armadilha que já mordeu seis vezes: a NFS-e do
 * PORTAL vem ACHATADA e a do XML vem em OBJETO.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { acumularIssPorEmpresa } from '../sefaz-backend/iss-carteira';

describe('acumularIssPorEmpresa — as DUAS formas do documento', () => {
    const resolver = (d: any) => d.empresaId || null;

    it('lê a NFS-e ACHATADA do portal (valorIss/issDevido)', () => {
        const [a] = acumularIssPorEmpresa([
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'saida', valorIss: 120 },
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'saida', issDevido: 80 },
        ], resolver);
        expect(a.notas).toBe(2);
        expect(a.issDevido).toBe(200);
        expect(a.aRecolher).toBe(200);
    });

    it('lê a NFS-e em OBJETO do XML (valores.iss)', () => {
        const [a] = acumularIssPorEmpresa([
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'saida', valores: { iss: 55.5 } },
        ], resolver);
        expect(a.issDevido).toBe(55.5);
    });

    it('nota SEM nenhum campo de ISS é "sem valor gravado", não ISS zero', () => {
        const [a] = acumularIssPorEmpresa([
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'saida' },
        ], resolver);
        expect(a.semValorGravado).toBe(1);
        expect(a.issDevido).toBe(0);
    });

    it('ISS zero EXPLÍCITO não conta como ausente', () => {
        const [a] = acumularIssPorEmpresa([
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'saida', valorIss: 0 },
        ], resolver);
        expect(a.semValorGravado).toBe(0);
        expect(a.notas).toBe(1);
    });

    it('retido pelo tomador sai do a recolher (Lei 13.701/03)', () => {
        const [a] = acumularIssPorEmpresa([
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'saida', valorIss: 500, issRetido: true },
        ], resolver);
        expect(a.issDevido).toBe(500);
        expect(a.issRetido).toBe(500);
        expect(a.aRecolher).toBe(0);
    });

    it('ENTRADA com retenção vira ISS de TOMADORA, nunca ISS próprio', () => {
        const [a] = acumularIssPorEmpresa([
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'entrada', valorIss: 300, issRetido: true },
        ], resolver);
        expect(a.tomadoRetido).toBe(300);
        expect(a.tomadoNotas).toBe(1);
        expect(a.notas).toBe(0);
        expect(a.issDevido).toBe(0);
    });

    it('entrada SEM retenção não gera obrigação nenhuma', () => {
        expect(acumularIssPorEmpresa([
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'entrada', valorIss: 300 },
        ], resolver)).toEqual([]);
    });

    it('cancelada e não-NFS-e ficam de fora', () => {
        expect(acumularIssPorEmpresa([
            { empresaId: 'e1', tipoDoc: 'NFSe', direcao: 'saida', valorIss: 10, status: 'cancelado' },
            { empresaId: 'e1', tipoDoc: 'NFe', direcao: 'saida', valorIss: 10 },
        ], resolver)).toEqual([]);
    });

    it('documento sem dono não entra na conta de ninguém', () => {
        expect(acumularIssPorEmpresa([
            { tipoDoc: 'NFSe', direcao: 'saida', valorIss: 10 },
        ], () => null)).toEqual([]);
    });
});

/**
 * ACHADO 06/08: o painel somava no "a recolher" da carteira o ISS de empresas
 * do SIMPLES. Optante não recolhe o ISS próprio em guia do município — ele já
 * está DENTRO do DAS (LC 123 art. 13). Cobrar essa guia é cobrar duas vezes: o
 * DAS da mesma competência já contém aquele ISS.
 */
describe('optante do Simples: ISS próprio vai DENTRO do DAS', () => {
    const base = (over: any = {}) => ({ empresaId: 'a', nome: 'SERVIÇOS ME', cnpj: '1', ccm: '123', issFixoSup: false, ...over });

    it('Simples com ISS nas notas fica FORA do total a recolher', () => {
        const p = montarPainelIssCarteira({
            empresas: [base({ regime: 'simples' })],
            apuracoes: [{ empresaId: 'a', notas: 5, issDevido: 940, issRetido: 0, aRecolher: 940 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('iss-no-das');
        expect(p.linhas[0].aRecolher).toBe(0);
        expect(p.linhas[0].issForaDoTotal).toBe(940);
        expect(p.resumo.totalARecolher).toBe(0);
        expect(p.resumo.totalIssNoDas).toBe(940);
        expect(p.avisos.join(' ')).toMatch(/DENTRO do DAS/);
        expect(p.linhas[0].acao).toMatch(/sublimite/);
    });

    it('a MESMA nota no Lucro Presumido continua sendo guia do município', () => {
        const p = montarPainelIssCarteira({
            empresas: [base({ regime: 'lucro' })],
            apuracoes: [{ empresaId: 'a', notas: 5, issDevido: 940, issRetido: 0, aRecolher: 940 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('a-recolher');
        expect(p.resumo.totalARecolher).toBe(940);
    });

    it('optante que retém como TOMADORA continua tendo guia — essa não é do DAS', () => {
        const p = montarPainelIssCarteira({
            empresas: [base({ regime: 'simples' })],
            apuracoes: [{ empresaId: 'a', notas: 3, issDevido: 200, issRetido: 0, aRecolher: 200, tomadoRetido: 700, tomadoNotas: 2 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('iss-no-das');
        expect(p.resumo.totalIssTomado).toBe(700);
        expect(p.resumo.comIssTomado).toBe(1);
    });

    it('ISS fixo (SUP) de optante continua sendo guia do município, não o DAS', () => {
        const p = montarPainelIssCarteira({
            empresas: [base({ regime: 'simples', issFixoSup: true })],
            apuracoes: [{ empresaId: 'a', notas: 3, issDevido: 200, issRetido: 0, aRecolher: 200 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('iss-fixo');
    });

    it('carteira só de optantes com ISS no DAS não acende "ninguém teve nota"', () => {
        const p = montarPainelIssCarteira({
            empresas: [base({ regime: 'simples' })],
            apuracoes: [{ empresaId: 'a', notas: 5, issDevido: 940, issRetido: 0, aRecolher: 940 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.avisos.join(' ')).not.toMatch(/quase nunca é mês parado/);
    });
});

/**
 * 2ª varredura real (06/08, com o ISS já ligado): "dentro do DAS" deu ZERO
 * empresa e "ISS zerado" pulou de 35 pra 67. A NFS-e do optante sai com o ISS
 * ZERADO — justamente PORQUE ele vai no DAS. Ou seja, o caso real do optante
 * não é "ISS destacado que não vira guia": é NOTA SEM ISS DESTACADO.
 *
 * Mandar conferir isso é alarme sem ação — o valor do ISS na nota de um
 * optante não muda guia nenhuma, porque o DAS sai do faturamento.
 */
describe('optante do Simples com a nota de ISS zerado', () => {
    const optante = { empresaId: 'a', nome: 'SERVIÇOS ME', cnpj: '1', ccm: '123', issFixoSup: false, regime: 'simples' };

    it('nota com ISS zerado no optante NÃO é conferência pendente', () => {
        const p = montarPainelIssCarteira({
            empresas: [optante],
            apuracoes: [{ empresaId: 'a', notas: 12, issDevido: 0, issRetido: 0, aRecolher: 0 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('iss-no-das');
        expect(p.linhas[0].acao).toMatch(/é o ESPERADO/);
        expect(p.resumo.issZerado).toBe(0);
        expect(p.resumo.issNoDas).toBe(1);
    });

    it('a MESMA nota zerada no Lucro continua sendo conferência', () => {
        const p = montarPainelIssCarteira({
            empresas: [{ ...optante, regime: 'lucro' }],
            apuracoes: [{ empresaId: 'a', notas: 12, issDevido: 0, issRetido: 0, aRecolher: 0 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('iss-zerado');
    });

    it('optante com ISS zerado e valor NÃO GRAVADO continua bloqueando — ausente ≠ zero', () => {
        const p = montarPainelIssCarteira({
            empresas: [optante],
            apuracoes: [{ empresaId: 'a', notas: 12, issDevido: 0, issRetido: 0, aRecolher: 0, semValorGravado: 3 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('captura-incerta');
    });

    it('optante com ISS RETIDO pelo tomador diz isso, que é mais específico', () => {
        const p = montarPainelIssCarteira({
            empresas: [optante],
            apuracoes: [{ empresaId: 'a', notas: 4, issDevido: 300, issRetido: 300, aRecolher: 0 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('so-retido');
    });

    it('optante SEM nota nenhuma continua "sem movimento" — não se inventa DAS', () => {
        const p = montarPainelIssCarteira({
            empresas: [optante],
            apuracoes: [{ empresaId: 'a', notas: 0, issDevido: 0, issRetido: 0, aRecolher: 0 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.linhas[0].situacao).toBe('sem-movimento');
    });

    it('o aviso não anuncia valor quando o ISS das notas é zero', () => {
        const p = montarPainelIssCarteira({
            empresas: [optante],
            apuracoes: [{ empresaId: 'a', notas: 12, issDevido: 0, issRetido: 0, aRecolher: 0 }],
            zeroConfiavelPara: () => true,
        });
        expect(p.avisos.join(' ')).toMatch(/nota sai com ISS zerado, que é o esperado/);
        expect(p.avisos.join(' ')).not.toMatch(/R\$ 0\.00 destacado/);
    });
});

/**
 * A ligação entre a varredura e a CAUSA do zero. Sem isto, "ISS zerado" é um
 * balde de 67 empresas com a mesma frase — e não dá pra começar por lugar
 * nenhum, que é o meio-farol que a gente vem fechando o dia inteiro.
 */
describe('a varredura diz POR QUE o ISS está zerado', () => {
    const empresa = { empresaId: 'a', nome: 'X', cnpj: '1', ccm: '123', issFixoSup: false, regime: 'lucro' };
    const nfse = (over: any = {}) => ({
        empresaId: 'a', tipoDoc: 'NFSe', direcao: 'saida', valorIss: 0,
        valorServicos: 1000, valorDeducoes: 0, municipioPrestacaoIbge: '3550308', ...over,
    });
    const painel = (docs: any[]) => montarPainelIssCarteira({
        empresas: [empresa],
        apuracoes: acumularIssPorEmpresa(docs, (d: any) => d.empresaId),
        zeroConfiavelPara: () => true,
    });

    it('zero que a nota EXPLICA sai da fila de pendência', () => {
        const p = painel([nfse({ aliquotaServicos: 0 }), nfse({ municipioPrestacaoIbge: '3509502' })]);
        expect(p.linhas[0].situacao).toBe('iss-zerado-explicado');
        expect(p.resumo.issZerado).toBe(0);
        expect(p.resumo.issZeradoExplicado).toBe(1);
        expect(p.avisos.join(' ')).toMatch(/não é pendência, não precisa conferir/);
    });

    it('nota que diz tributar com ISS zero continua sendo conferência, com o motivo', () => {
        const p = painel([nfse({ aliquotaServicos: 5 })]);
        expect(p.linhas[0].situacao).toBe('iss-zerado');
        expect(p.linhas[0].acao).toMatch(/se contradiz/);
        expect(p.linhas[0].causasIssZerado.exigemAcao).toBe(1);
    });

    it('uma nota inconsistente no meio de dez explicadas não some', () => {
        const p = painel([
            ...Array.from({ length: 10 }, () => nfse({ aliquotaServicos: 0 })),
            nfse({ aliquotaServicos: 5 }),
        ]);
        expect(p.linhas[0].situacao).toBe('iss-zerado');
        expect(p.linhas[0].causasIssZerado.dominante.causa).toBe('inconsistente');
    });

    it('nota SEM o campo de ISS continua bloqueando antes de tudo — ausente ≠ zero', () => {
        const p = painel([nfse({ valorIss: undefined, aliquotaServicos: 0 })]);
        expect(p.linhas[0].situacao).toBe('captura-incerta');
    });

    it('cadastro Lucro com nota de OPTANTE acende a divergência na linha', () => {
        const p = painel([nfse({ aliquotaServicos: 0, prestadorOptanteSimples: true })]);
        expect(p.linhas[0].divergenciaRegime.divergente).toBe(true);
        expect(p.resumo.divergenciaRegime).toBe(1);
        expect(p.farol).toBe('atencao');
        expect(p.avisos.join(' ')).toMatch(/CADASTRO e a NOTA discordam/);
    });
});

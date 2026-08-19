/**
 * F600 — Contribuição Retida na Fonte (EFD-Contribuições).
 *
 * Era um STUB permanente (F001|1) e o Paulo pegou pelo caso HS PROJETOS
 * (19/08): *"ela é retido de PIS/COFINS, então quando eu informo no EFD
 * CONTRIBUIÇÕES ele me dá o F600 para preencher, na SAGE ele já puxava"*.
 *
 * 🚨 TUDO AQUI É PROVADO CONTRA ARQUIVO ACEITO — o EFD do E-Fiscal da própria
 * HS (0304, 05/2026, assinado) que ele mandou no mesmo dia. As 5 linhas F600
 * de lá, o M200 |0|0|0|0|0|0|0|114,4|114,4|0|0|0| e o M600 idem com 528 são o
 * gabarito destes testes. Regra da casa: arquivo aceito > leiaute deduzido.
 */
// @ts-ignore — módulo JS do backend
import { buildBlocoF, buildBlocoM, coletarRetencoesF600 } from '../sefaz-backend/sped-contrib-blocos.js';

const campos = (l: string) => l.split('|');

/** NFS-e prestada com retenção coerente (PIS 0,65% · COFINS 3% da base). */
const nfseRetida = (numero: number, dia: string, base: number, cnpjTomador: string) => ({
    tipo: 'NFSe', direcao: 'saida', status: 'autorizado',
    numero: String(numero),
    dhEmi: `2026-05-${dia}T10:00:00-03:00`,
    valorTotal: base,
    tomador: { cnpjCpf: cnpjTomador, nome: 'FONTE PAGADORA' },
    valores: { baseCalculo: base, pis: +(base * 0.0065).toFixed(2), cofins: +(base * 0.03).toFixed(2) },
});

// As 5 retenções do arquivo real da HS 05/2026, na ordem do arquivo.
const NOTAS_HS = [
    nfseRetida(1, '02', 5200, '47252373000113'),
    nfseRetida(2, '04', 2000, '58609045000148'),
    nfseRetida(3, '05', 3500, '36491568000108'),
    nfseRetida(4, '05', 1500, '61787373000149'),
    nfseRetida(5, '13', 5400, '47252373000113'),
];

const DADOS_HS = {
    empresa: { cnpj: '05.147.016/0001-45' },
    regimeApuracao: '2',   // HS é Presumido — cumulativo, como no arquivo aceito
    notas: NOTAS_HS,
    warnings: [] as string[],
};

describe('F600 reproduz o arquivo aceito da HS PROJETOS (05/2026)', () => {
    const linhas: string[] = buildBlocoF({ ...DADOS_HS, warnings: [] });

    it('F001 declara bloco COM dados quando há retenção', () => {
        expect(linhas[0].trim()).toBe('|F001|0|');
    });

    it('F010 leva o CNPJ do estabelecimento, só dígitos', () => {
        expect(linhas[1].trim()).toBe('|F010|05147016000145|');
    });

    it('a primeira linha F600 bate campo a campo com a do arquivo aceito', () => {
        // Arquivo real: |F600|03|02052026|5200|189,8|5952|1|47252373000113|33,8|156|0|
        const f = campos(linhas[2]);
        expect(f[1]).toBe('F600');
        expect(f[2]).toBe('03');              // IND_NAT_RET — PJ direito privado
        expect(f[3]).toBe('02052026');        // DT_RET
        expect(f[4]).toBe('5200,00');         // VL_BC_RET
        expect(f[5]).toBe('189,80');          // VL_RET = PIS+COFINS (nunca a CSRF inteira)
        expect(f[6]).toBe('5952');            // COD_REC (CSRF)
        expect(f[7]).toBe('1');               // IND_NAT_REC — cumulativa (Presumido)
        expect(f[8]).toBe('47252373000113');  // CNPJ da fonte pagadora
        expect(f[9]).toBe('33,80');           // VL_RET_PIS
        expect(f[10]).toBe('156,00');         // VL_RET_COFINS
        expect(f[11]).toBe('0');              // IND_DEC
    });

    it('são 5 F600 e o F990 conta o bloco inteiro (8, como no arquivo aceito)', () => {
        expect(linhas.filter((l) => l.startsWith('|F600|'))).toHaveLength(5);
        expect(linhas[linhas.length - 1].trim()).toBe('|F990|8|');
    });

    it('sem retenção nenhuma o bloco volta ao mínimo — F001|1', () => {
        const vazio: string[] = buildBlocoF({ ...DADOS_HS, notas: [], warnings: [] });
        expect(vazio[0].trim()).toBe('|F001|1|');
        expect(vazio).toHaveLength(2);
    });
});

describe('M200/M600 abatem a retenção do F600 — os totais fecham centavo a centavo', () => {
    // Arquivo real: contribuição PIS 114,40 (17.600 × 0,65%) TODA abatida
    // pela retenção → a recolher 0. COFINS idem com 528,00.
    const linhas: string[] = buildBlocoM({ ...DADOS_HS, warnings: [] });
    const m200 = campos(linhas.find((l) => l.startsWith('|M200|'))!);
    const m600 = campos(linhas.find((l) => l.startsWith('|M600|'))!);

    it('M200 igual ao aceito: |0|0|0|0|0|0|0|114,4|114,4|0|0|0|', () => {
        expect(m200.slice(2, 9)).toEqual(['0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00']);
        expect(m200[9]).toBe('114,40');    // VL_TOT_CONT_CUM_PER
        expect(m200[10]).toBe('114,40');   // VL_RET_CUM = Σ VL_RET_PIS dos F600
        expect(m200[12]).toBe('0,00');     // VL_CONT_CUM_REC — retenção cobriu tudo
        expect(m200[13]).toBe('0,00');     // VL_TOT_CONT_REC
    });

    it('M600 igual ao aceito: contribuição 528,00 · retenção 528,00 · a recolher 0', () => {
        expect(m600[9]).toBe('528,00');
        expect(m600[10]).toBe('528,00');
        expect(m600[13]).toBe('0,00');
    });

    it('retenção MAIOR que a contribuição não produz "a recolher" negativo', () => {
        // Uma nota só, com retenção integral: contribuição = retenção. Se a
        // retenção viesse maior (mês com estorno), o rec não desce de zero.
        const soUma: string[] = buildBlocoM({
            ...DADOS_HS,
            notas: [nfseRetida(9, '10', 1000, '47252373000113')],
            retencoesF600: { eventos: [], totalPis: 99, totalCofins: 99 },
            warnings: [],
        });
        const m = campos(soUma.find((l) => l.startsWith('|M200|'))!);
        expect(m[10]).toBe('99,00');     // a retenção declarada é a REAL
        expect(m[12]).toBe('0,00');      // o "a recolher" é que não desce de zero
    });
});

describe('a régua do R-4020 vale no F600 — tributo da operação NÃO é retenção', () => {
    it('nota com assinatura 1,65%+7,60% (não-cumulativo do prestador) fica FORA, nomeada', () => {
        const warnings: string[] = [];
        const naoCumulativa = {
            tipo: 'NFSe', direcao: 'saida', status: 'autorizado', numero: '375235',
            dhEmi: '2026-05-07T10:00:00-03:00', valorTotal: 3413.24,
            tomador: { cnpjCpf: '47252373000113', nome: 'TOMADOR' },
            // O caso ATLAS SCHINDLER (07/08): PIS 1,65% e COFINS 7,60% são o
            // tributo do PRESTADOR, não retenção.
            valores: { baseCalculo: 3413.24, pis: 56.32, cofins: 259.41 },
        };
        const { eventos } = coletarRetencoesF600([naoCumulativa], warnings);
        expect(eventos).toHaveLength(0);
        expect(warnings.join(' ')).toMatch(/tributo\s+da OPERAÇÃO|da OPERAÇÃO/);
        expect(warnings.join(' ')).toMatch(/375235/);
    });

    it('nota cancelada não gera F600', () => {
        const cancelada = { ...nfseRetida(7, '02', 1000, '47252373000113'), status: 'cancelado' };
        expect(coletarRetencoesF600([cancelada], null).eventos).toHaveLength(0);
    });

    it('serviço TOMADO (entrada) não entra — a retenção que abate é a que a declarante SOFREU', () => {
        const tomada = { ...nfseRetida(8, '02', 1000, '47252373000113'), direcao: 'entrada' };
        expect(coletarRetencoesF600([tomada], null).eventos).toHaveLength(0);
    });

    it('fonte pagadora sem CNPJ legível fica fora e é DITA — abatimento a menor não é silencioso', () => {
        const warnings: string[] = [];
        const semFonte = { ...nfseRetida(6, '02', 1000, ''), tomador: { cnpjCpf: '', nome: 'X' } };
        const { eventos } = coletarRetencoesF600([semFonte], warnings);
        expect(eventos).toHaveLength(0);
        expect(warnings.join(' ')).toMatch(/sem CNPJ da fonte pagadora/);
    });
});

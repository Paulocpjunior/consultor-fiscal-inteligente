import { compararEspelho, chaveDocumento, ausenciaEsperada, compararE510 } from '../services/spedEspelho';
import type { SpedFiscalParseResult, SpedDocumentoC100 } from '../types';

/**
 * Conferência-espelho: o SPED do CFI contra o do E-Fiscal, MESMA empresa e
 * MESMA competência. É a prova que a onda de migração exige — o E-Fiscal segue
 * vivo, então o gabarito está do lado e a migração é conferência, não fé.
 */
const doc = (over: Partial<SpedDocumentoC100> = {}): SpedDocumentoC100 => ({
    tipo: 'C100',
    indOper: '0',
    codMod: '55',
    serie: '1',
    numDoc: '100',
    valorDocumento: 1000,
    valorIcms: 180,
    itens: [],
    resumos: [],
    ...over,
});

const arquivo = (over: Partial<SpedFiscalParseResult> = {}): SpedFiscalParseResult => ({
    arquivo: { nome: 'x.txt', tamanho: 0, linhas: 0 } as any,
    registro0000: { tipo: '0000', cnpj: '44388152000189', dtIni: '01072026', dtFin: '31072026' },
    participantes: [],
    produtos: [],
    documentosC100: [doc()],
    documentosD100: [],
    apuracaoIcms: { tipo: 'E110', valorTotalDebitos: 180, valorTotalCreditos: 0, valorIcmsRecolher: 180 },
    consolidacaoIpiE510: [],
    erros: [],
    avisos: [],
    ...over,
});

describe('chave de casamento entre os dois arquivos', () => {
    it('a chave da NF-e manda quando existe', () => {
        const k = chaveDocumento(doc({ chave: '3'.repeat(44) }));
        expect(k).toBe('3'.repeat(44));
    });

    it('sem chave, casa por modelo+série+número+sentido', () => {
        expect(chaveDocumento(doc({ chave: '' }))).toBe('55|1|100|0');
    });

    it('NÃO usa COD_PART — ele é interno de cada sistema', () => {
        // Se entrasse, um arquivo idêntico daria 100% de divergência: o 0150
        // do E-Fiscal numera de um jeito e o do CFI de outro.
        expect(chaveDocumento(doc({ chave: '', codPart: 'A1' })))
            .toBe(chaveDocumento(doc({ chave: '', codPart: 'Z9' })));
    });
});

describe('ausência esperada — a ponte .FML só leva 55 e 65', () => {
    it('modelo fora da ponte tem motivo', () => {
        expect(ausenciaEsperada(doc({ codMod: '01' }))).toMatch(/só leva NF-e \(55\) e NFC-e \(65\)/);
    });
    it('NF-e e NFC-e não têm motivo de ausência', () => {
        expect(ausenciaEsperada(doc({ codMod: '55' }))).toBeNull();
        expect(ausenciaEsperada(doc({ codMod: '65' }))).toBeNull();
    });
});

describe('guardas antes de comparar', () => {
    it('CNPJs diferentes: recusa em vez de gerar divergência falsa', () => {
        const r = compararEspelho(arquivo(), arquivo({
            registro0000: { tipo: '0000', cnpj: '11222333000181', dtIni: '01072026', dtFin: '31072026' },
        }));
        expect(r.veredicto).toBe('nao-conferivel');
        expect(r.motivo).toMatch(/CNPJs diferentes/);
        expect(r.documentos).toHaveLength(0);
    });

    it('períodos diferentes: recusa igual', () => {
        const r = compararEspelho(arquivo(), arquivo({
            registro0000: { tipo: '0000', cnpj: '44388152000189', dtIni: '01062026', dtFin: '30062026' },
        }));
        expect(r.veredicto).toBe('nao-conferivel');
        expect(r.motivo).toMatch(/períodos diferentes/);
    });

    it('lado sem documento nenhum não vira "0 divergências"', () => {
        const r = compararEspelho(arquivo(), arquivo({ documentosC100: [] }));
        expect(r.veredicto).toBe('nao-conferivel');
        expect(r.motivo).toMatch(/E-Fiscal não tem documento nenhum/);
    });
});

describe('veredicto', () => {
    it('arquivos iguais: espelho bate', () => {
        const r = compararEspelho(arquivo(), arquivo());
        expect(r.veredicto).toBe('espelho-bate');
        expect(r.resumoDocumentos.iguais).toBe(1);
    });

    it('valor diferente no documento vira divergência com os dois lados', () => {
        const r = compararEspelho(arquivo(), arquivo({
            documentosC100: [doc({ valorDocumento: 1100 })],
        }));
        expect(r.veredicto).toBe('divergente');
        expect(r.documentos[0].valores[0]).toMatchObject({
            campo: 'Valor do documento', cfi: 1000, efiscal: 1100, diferenca: -100,
        });
    });

    it('diferença de centavo é arredondamento, não divergência', () => {
        const r = compararEspelho(arquivo(), arquivo({
            documentosC100: [doc({ valorDocumento: 1000.004 })],
        }));
        expect(r.veredicto).toBe('espelho-bate');
    });

    it('documento só no E-Fiscal aponta as DUAS leituras possíveis', () => {
        const r = compararEspelho(arquivo(), arquivo({
            documentosC100: [doc(), doc({ numDoc: '200', chave: '' })],
        }));
        expect(r.veredicto).toBe('divergente');
        expect(r.resumoDocumentos.soEfiscal).toBe(1);
        expect(r.documentos.find(d => d.classe === 'so-efiscal')?.motivo)
            .toMatch(/lançado à mão lá ou buraco de captura aqui/);
    });

    it('modelo fora da ponte só no CFI é ESPERADO — não derruba o veredicto', () => {
        const r = compararEspelho(
            arquivo({ documentosC100: [doc(), doc({ codMod: '01', numDoc: '9', chave: '' })] }),
            arquivo(),
        );
        expect(r.veredicto).toBe('espelho-bate');
        expect(r.resumoDocumentos.soCfiEsperado).toBe(1);
        expect(r.avisos.join(' ')).toMatch(/esperado, não é erro/);
    });

    it('E110 ausente de um lado é NÃO APURADO, nunca zero', () => {
        const r = compararEspelho(arquivo(), arquivo({ apuracaoIcms: undefined }));
        expect(r.veredicto).toBe('nao-conferivel');
        expect(r.apuracao.every(l => l.naoApurado)).toBe(true);
        expect(r.avisos.join(' ')).toMatch(/não tem E110/);
        expect(r.motivo).toMatch(/o número que fecha o mês não foi conferido/);
    });

    it('apuração divergente derruba mesmo com todos os documentos iguais', () => {
        const r = compararEspelho(arquivo(), arquivo({
            apuracaoIcms: { tipo: 'E110', valorTotalDebitos: 180, valorTotalCreditos: 0, valorIcmsRecolher: 200 },
        }));
        expect(r.veredicto).toBe('divergente');
        expect(r.motivo).toMatch(/a apuração do E110 não bate/);
    });

    it('CT-e do bloco D vira aviso — a ponte não o leva', () => {
        const r = compararEspelho(
            arquivo({ documentosD100: [{ tipo: 'D100', codMod: '57', valorDocumento: 500 } as any] }),
            arquivo(),
        );
        expect(r.avisos.join(' ')).toMatch(/1 CT-e no bloco D/);
        expect(r.veredicto).toBe('espelho-bate');
    });

    it('documento repetido no E-Fiscal avisa em vez de contar duas vezes', () => {
        const r = compararEspelho(arquivo(), arquivo({
            documentosC100: [doc({ chave: '' }), doc({ chave: '' })],
        }));
        expect(r.avisos.join(' ')).toMatch(/mais de uma vez/);
        expect(r.veredicto).toBe('espelho-bate');
    });
});

describe('compararE510 — prova ponta a ponta do IPI (CFI × E-Fiscal)', () => {
    const l = (cfop: string, cstIpi: string, vc: number, vb: number, vi: number) =>
        ({ tipo: 'E510' as const, cfop, cstIpi, valorContabil: vc, valorBcIpi: vb, valorIpi: vi });

    it('linhas iguais (valores reais do arquivo aceito) batem', () => {
        const cfi = [l('5101', '50', 317806.19, 286092.21, 9298.08), l('1101', '00', 142785.85, 135051.20, 4389.15)];
        const efi = [l('1101', '00', 142785.85, 135051.20, 4389.15), l('5101', '50', 317806.19, 286092.21, 9298.08)];
        const r = compararE510(cfi, efi);
        expect(r.every((x) => x.classe === 'igual')).toBe(true);
    });

    it('divergência de VL_IPI é apontada; centavo é tolerado', () => {
        const cfi = [l('5101', '50', 317806.19, 286092.21, 9000.00)];
        const efi = [l('5101', '50', 317806.19, 286092.21, 9298.08)];
        expect(compararE510(cfi, efi)[0].classe).toBe('divergente');
        const centavo = compararE510([l('5101', '50', 317806.19, 286092.21, 9298.08)], [l('5101', '50', 317806.19, 286092.21, 9298.083)]);
        expect(centavo[0].classe).toBe('igual');
    });

    it('linha só de um lado é so-cfi / so-efiscal (ausente ≠ zero)', () => {
        expect(compararE510([l('6101', '50', 100, 90, 3)], [])[0].classe).toBe('so-cfi');
        expect(compararE510([], [l('6101', '50', 100, 90, 3)])[0].classe).toBe('so-efiscal');
    });
});

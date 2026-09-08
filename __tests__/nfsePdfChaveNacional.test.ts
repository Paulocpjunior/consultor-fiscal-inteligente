/**
 * 🚨 O PDF DA NFS-e SUBIA SEM PRESTADOR E SEM TOMADOR — "apenas com valores"
 * (08/09, Paulo, LEGACY 0360 · 08/2026: sete notas na lista com a contraparte
 * "— -", e no modal a CHAVE NACIONAL preenchida com os dois blocos vazios).
 *
 * A chave carrega o prestador (é a inscrição de quem emitiu) e a empresa
 * selecionada responde o tomador quando o prestador não é ela. O que sai daí
 * vai CARIMBADO com a origem — nunca se apresenta como lido do papel.
 *
 * E o mesmo PDF subia com "Valor dos serviços 0,00 · líquido 60,00": o leitor
 * errou o leiaute e a tela deixava salvar. Agora ela DIZ e BLOQUEIA.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { lerChaveNfseNacional, completarParticipantesDaNfsePdf } from '../services/nfsePdfChaveNacional';
import { conferirValoresDaNfsePdf } from '../services/nfsePdfValores';

// CNPJs FICTÍCIOS — dado de cliente nunca entra no repositório.
const PRESTADOR = '11222333000181';
const EMPRESA = '44555666000177';
// 7 + 1 + 1 + 14 + 15 + 12 = 50 dígitos (é o que o leitor captura do PDF).
const CHAVE = `3550308` + `1` + `2` + PRESTADOR + `000000000041943` + `260812345678`;

describe('a chave nacional responde quem EMITIU', () => {
    it('50 dígitos: município, ambiente, tipo de inscrição, CNPJ do prestador e número', () => {
        const c = lerChaveNfseNacional(CHAVE)!;
        expect(CHAVE).toHaveLength(50);
        expect(c.cMun).toBe('3550308');
        expect(c.ambiente).toBe('1');
        expect(c.tpInsc).toBe('2');
        expect(c.inscricaoEmitente).toBe(PRESTADOR);
        expect(c.numero).toBe('41943');
    });

    it('o nome do arquivo da DANFSe traz 53 dígitos — as posições que importam são as mesmas', () => {
        expect(lerChaveNfseNacional(CHAVE + '221')!.inscricaoEmitente).toBe(PRESTADOR);
    });

    it('tipo 1 é CPF: os 11 últimos da inscrição de 14', () => {
        const chaveCpf = `3550308` + `1` + `1` + `00012345678901` + `000000000000001` + `260812345678`;
        expect(lerChaveNfseNacional(chaveCpf)!.inscricaoEmitente).toBe('12345678901');
    });

    it('chave de NF-e (44) e chave vazia NÃO viram CNPJ — foi o defeito de 02/09', () => {
        expect(lerChaveNfseNacional('3'.repeat(44))).toBeNull();
        expect(lerChaveNfseNacional('')).toBeNull();
        expect(lerChaveNfseNacional(null)).toBeNull();
    });
});

describe('completar prestador/tomador — só o que está VAZIO, carimbado', () => {
    it('sem prestador no papel: o CNPJ sai da chave e o tomador vira a empresa selecionada, os dois DITOS', () => {
        const r = completarParticipantesDaNfsePdf({
            prestadorCnpj: '', tomadorCnpj: '', chaveAcesso: CHAVE,
            empresaCnpj: EMPRESA, empresaNome: 'EMPRESA TOMADORA LTDA',
        });
        expect(r.prestadorCnpj).toBe(PRESTADOR);
        expect(r.prestadorOrigem).toBe('chave-nacional');
        expect(r.tomadorCnpj).toBe(EMPRESA);
        expect(r.tomadorNome).toBe('EMPRESA TOMADORA LTDA');
        expect(r.tomadorOrigem).toBe('empresa-selecionada');
        expect(r.direcao).toBe('entrada');
        expect(r.avisos.join(' ')).toMatch(/CHAVE NACIONAL/);
        expect(r.avisos.join(' ')).toMatch(/EMPRESA SELECIONADA/);
        expect(r.avisos.join(' ')).toMatch(/Confira no papel/);
    });

    it('a empresa é quem EMITIU (chave): saída, e o tomador continua vazio — não se inventa', () => {
        const chaveDaEmpresa = `3550308` + `1` + `2` + EMPRESA + `000000000000007` + `260812345678`;
        const r = completarParticipantesDaNfsePdf({ prestadorCnpj: '', tomadorCnpj: '', chaveAcesso: chaveDaEmpresa, empresaCnpj: EMPRESA });
        expect(r.prestadorCnpj).toBe(EMPRESA);
        expect(r.direcao).toBe('saida');
        expect(r.tomadorCnpj).toBe('');
        expect(r.tomadorOrigem).toBeNull();
    });

    it('o que o papel disse VENCE a chave — e a divergência entre os dois vira aviso', () => {
        const r = completarParticipantesDaNfsePdf({
            prestadorCnpj: '99.888.777/0001-66', tomadorCnpj: EMPRESA, chaveAcesso: CHAVE, empresaCnpj: EMPRESA,
        });
        expect(r.prestadorCnpj).toBe('99888777000166');
        expect(r.prestadorOrigem).toBe('documento');
        expect(r.direcao).toBe('entrada');
        expect(r.avisos.join(' ')).toMatch(/não é o emitente da chave/);
    });

    it('sem chave e sem papel: nada é preenchido e a direção fica em aberto', () => {
        const r = completarParticipantesDaNfsePdf({ prestadorCnpj: '', tomadorCnpj: '', chaveAcesso: '', empresaCnpj: EMPRESA });
        expect(r.prestadorCnpj).toBe('');
        expect(r.tomadorCnpj).toBe('');
        expect(r.direcao).toBeNull();
    });

    it('tomador lido no papel que NÃO é a empresa nem o prestador: ninguém é sobrescrito (a posse decide)', () => {
        const r = completarParticipantesDaNfsePdf({
            prestadorCnpj: '', tomadorCnpj: '99888777000166', chaveAcesso: CHAVE, empresaCnpj: EMPRESA,
        });
        expect(r.prestadorCnpj).toBe(PRESTADOR);
        expect(r.tomadorCnpj).toBe('99888777000166');
        expect(r.tomadorOrigem).toBe('documento');
        expect(r.direcao).toBeNull();
    });
});

describe('os valores lidos fazem sentido entre si?', () => {
    it('o caso real: serviços 0,00 com líquido 60,00 BLOQUEIA e manda digitar do papel', () => {
        const c = conferirValoresDaNfsePdf({
            valorServicos: 0, baseCalculo: 1.74, valorIss: 1.74,
            valorDescIncondicional: 60, valorDescCondicional: 60, valorLiquido: 60,
        });
        expect(c.bloquear).toBe(true);
        expect(c.motivo).toMatch(/SERVIÇOS está 0,00/);
        expect(c.motivo).toMatch(/digite/i);
    });

    it('nota coerente passa sem aviso', () => {
        const c = conferirValoresDaNfsePdf({ valorServicos: 60, baseCalculo: 60, valorIss: 1.74, valorLiquido: 60 });
        expect(c.bloquear).toBe(false);
        expect(c.avisos).toEqual([]);
    });

    it('zero de verdade (serviço e líquido zero) não bloqueia — zero digitado é resposta', () => {
        expect(conferirValoresDaNfsePdf({ valorServicos: 0, valorLiquido: 0 }).bloquear).toBe(false);
    });

    it('base maior que o serviço e ISS maior que a base saem como AVISO, não como bloqueio', () => {
        const c = conferirValoresDaNfsePdf({ valorServicos: 60, baseCalculo: 100, valorIss: 150, valorLiquido: 60 });
        expect(c.bloquear).toBe(false);
        expect(c.avisos).toHaveLength(2);
    });
});

describe('🔌 a tela de importação USA as duas réguas — régua que ninguém chama é flag que ninguém lê', () => {
    const f = readFileSync(join(__dirname, '..', 'components', 'xml', 'NfsePdfImportacao.tsx'), 'utf8')
        .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

    it('completa os participantes ANTES de conferir a empresa', () => {
        const iCompleta = f.indexOf('completarParticipantesDaNfsePdf({');
        const iMatch = f.indexOf('matchNfseEmpresa(result');
        expect(iCompleta).toBeGreaterThan(0);
        expect(iMatch).toBeGreaterThan(iCompleta);
    });

    it('bloqueia o salvar quando os valores não se sustentam', () => {
        expect(f).toMatch(/const valores = conferirValoresDaNfsePdf\(parsed\);\s*\n\s*if \(valores\.bloquear\)/);
    });

    it('grava o bruto e os participantes nas formas que a apuração e o R-4020 leem', () => {
        for (const campo of ['valorServicos: parsed.valorServicos', 'valorTotal: parsed.valorServicos',
            "prestadorCnpj: parsed.prestador.cnpj || ''", "tomadorCnpj: parsed.tomador.cnpj || ''",
            'valorServicos: parsed.valorServicos,']) {
            expect(f).toContain(campo);
        }
        // vNF é o BRUTO do serviço, nunca o líquido depois das retenções.
        expect(f).toMatch(/vNF: parsed\.valorServicos \|\| 0/);
        expect(f).not.toMatch(/vNF: parsed\.valorLiquido/);
    });
});

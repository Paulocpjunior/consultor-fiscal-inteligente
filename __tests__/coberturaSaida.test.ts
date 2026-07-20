/**
 * Testes do relatorio de cobertura de saida (autXML).
 * Regra: empresa "sem saida" na janela = provavelmente falta o CNPJ do
 * escritorio no <autXML> do emissor dela → entra na lista acionavel.
 */
// @ts-expect-error — módulo .js puro
import { analisarCoberturaSaida, ehSaidaMod55, modeloDaChave, dentroJanela } from '../sefaz-backend/cobertura-saida.js';

// Chave de 44 digitos com o modelo nas posicoes 21-22 (indices 20-21).
function chave(modelo: string): string {
  // 20 + modelo(2) + 22 = 44
  return '3'.repeat(20) + modelo + '9'.repeat(22);
}

const HOJE = Date.parse('2026-07-20T12:00:00-03:00');
const iso = (dias: number) => new Date(HOJE - dias * 24 * 3600 * 1000).toISOString();

describe('modeloDaChave / ehSaidaMod55', () => {
  it('extrai o modelo das posicoes 21-22', () => {
    expect(modeloDaChave(chave('55'))).toBe('55');
    expect(modeloDaChave(chave('65'))).toBe('65');
  });

  it('so conta saida modelo 55', () => {
    expect(ehSaidaMod55({ direcao: 'saida', chave: chave('55') })).toBe(true);
    expect(ehSaidaMod55({ direcao: 'saida', chave: chave('65') })).toBe(false); // NFC-e nao
    expect(ehSaidaMod55({ direcao: 'entrada', chave: chave('55') })).toBe(false);
    expect(ehSaidaMod55({ direcao: 'saida', chave: '' })).toBe(false);
  });
});

describe('dentroJanela', () => {
  it('aceita nota dentro da janela e rejeita a mais antiga', () => {
    expect(dentroJanela(iso(10), HOJE, 90)).toBe(true);
    expect(dentroJanela(iso(89), HOJE, 90)).toBe(true);
    expect(dentroJanela(iso(120), HOJE, 90)).toBe(false);
  });
  it('tolera nota de hoje/fuso (ate +1 dia) e rejeita dhEmi invalido', () => {
    expect(dentroJanela(iso(-0.5), HOJE, 90)).toBe(true);
    expect(dentroJanela('sem-data', HOJE, 90)).toBe(false);
  });
});

describe('analisarCoberturaSaida', () => {
  const empresas = [
    { empresaId: 'A', cnpj: '11111111000191', nome: 'Alfa', regime: 'simples' },
    { empresaId: 'B', cnpj: '22222222000172', nome: 'Beta', regime: 'lucro' },
    { empresaId: 'C', cnpj: '33333333000153', nome: 'Gama', regime: 'simples' },
  ];

  it('separa quem tem saida de quem nao tem', () => {
    const docs = [
      { empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(5) },
      { empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(2) },
      // B so tem entrada → conta como SEM saida
      { empresaId: 'B', direcao: 'entrada', chave: chave('55'), dhEmi: iso(3) },
      // C nao aparece em nada
    ];
    const r = analisarCoberturaSaida({ empresas, docs, hojeMs: HOJE, janelaDias: 90 });
    expect(r.totalEmpresas).toBe(3);
    expect(r.comSaida).toBe(1);
    expect(r.semSaida).toBe(2);
    expect(r.empresasSemSaida.map((e: any) => e.empresaId).sort()).toEqual(['B', 'C']);
    expect(r.percentualCobertura).toBe(33);
  });

  it('nota de saida fora da janela nao cobre a empresa', () => {
    const docs = [{ empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(200) }];
    const r = analisarCoberturaSaida({ empresas, docs, hojeMs: HOJE, janelaDias: 90 });
    expect(r.empresasSemSaida.map((e: any) => e.empresaId)).toContain('A');
  });

  it('NFC-e (mod 65) de saida NAO conta como cobertura de mod 55', () => {
    const docs = [{ empresaId: 'A', direcao: 'saida', chave: chave('65'), dhEmi: iso(1) }];
    const r = analisarCoberturaSaida({ empresas, docs, hojeMs: HOJE, janelaDias: 90 });
    expect(r.empresasSemSaida.map((e: any) => e.empresaId)).toContain('A');
  });

  it('atribui pela raiz do emitente quando empresaId nao casa (filial)', () => {
    // doc sem empresaId, emitido por filial 0002 da raiz de Alfa (11111111)
    const docs = [{ cnpjEmit: '11111111000272', direcao: 'saida', chave: chave('55'), dhEmi: iso(4) }];
    const r = analisarCoberturaSaida({ empresas, docs, hojeMs: HOJE, janelaDias: 90 });
    expect(r.empresasComSaida.map((e: any) => e.empresaId)).toContain('A');
  });

  it('registra a data da ultima saida (mais recente)', () => {
    const docs = [
      { empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(30) },
      { empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(3) },
    ];
    const r = analisarCoberturaSaida({ empresas, docs, hojeMs: HOJE, janelaDias: 90 });
    const alfa = r.empresasComSaida.find((e: any) => e.empresaId === 'A');
    expect(alfa.qtdSaida).toBe(2);
    expect(alfa.ultimaSaida).toBe(iso(3));
    expect(alfa).not.toHaveProperty('ultimaSaidaMs'); // ms interno nao vaza
  });

  it('base vazia nao quebra e cobertura = 0', () => {
    const r = analisarCoberturaSaida({ empresas: [], docs: [], hojeMs: HOJE, janelaDias: 90 });
    expect(r.totalEmpresas).toBe(0);
    expect(r.percentualCobertura).toBe(0);
    expect(r.empresasSemSaida).toEqual([]);
  });
});

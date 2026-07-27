/**
 * Testes do relatorio de cobertura de saida (autXML).
 * Regra: empresa "sem saida" na janela = provavelmente falta o CNPJ do
 * escritorio no <autXML> do emissor dela → entra na lista acionavel.
 */
// @ts-expect-error — módulo .js puro
import { analisarCoberturaSaida, ehSaidaMod55, modeloDaChave, dentroJanela, trilhoDaOrigem } from '../sefaz-backend/cobertura-saida.js';

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

  it('prioriza sem-saida por evidencia historica: quem emitia (fora da janela) vem antes de quem nunca emitiu', () => {
    // Beta tem 3 saidas historicas (todas fora da janela de 90d) → emite mod 55,
    // so paramos de capturar. Gama nunca teve saida. Alfa tem saida na janela.
    const docs = [
      { empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(5) },   // Alfa: coberta
      { empresaId: 'B', direcao: 'saida', chave: chave('55'), dhEmi: iso(150) },  // Beta: historico
      { empresaId: 'B', direcao: 'saida', chave: chave('55'), dhEmi: iso(160) },
      { empresaId: 'B', direcao: 'saida', chave: chave('55'), dhEmi: iso(200) },
    ];
    const r = analisarCoberturaSaida({ empresas, docs, hojeMs: HOJE, janelaDias: 90 });
    // Alfa coberta; Beta e Gama sem saida na janela.
    expect(r.comSaida).toBe(1);
    expect(r.semSaida).toBe(2);
    // Priorizacao: Beta (3 historicas) antes de Gama (0) na lista sem-saida.
    expect(r.empresasSemSaida.map((e: any) => e.empresaId)).toEqual(['B', 'C']);
    // Recortes prontos: Beta e prioritaria; Gama e sem-evidencia.
    expect(r.prioritarias.map((e: any) => e.empresaId)).toEqual(['B']);
    expect(r.prioritariasCount).toBe(1);
    expect(r.semEvidenciaSaida.map((e: any) => e.empresaId)).toEqual(['C']);
    expect(r.semEvidenciaCount).toBe(1);
    // Beta carrega o sinal de volume e a ultima saida historica; sem ms interno.
    const beta = r.prioritarias.find((e: any) => e.empresaId === 'B');
    expect(beta.qtdSaidaTotal).toBe(3);
    expect(beta.qtdSaida).toBe(0); // 0 na janela
    expect(beta.ultimaSaidaHistorica).toBe(iso(150));
    expect(beta).not.toHaveProperty('ultimaSaidaHistoricaMs');
    expect(beta).not.toHaveProperty('ultimaSaidaMs');
  });

  it('empresa coberta na janela tambem soma o total historico', () => {
    const docs = [
      { empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(200) }, // historica
      { empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(3) },   // na janela
    ];
    const r = analisarCoberturaSaida({ empresas, docs, hojeMs: HOJE, janelaDias: 90 });
    const alfa = r.empresasComSaida.find((e: any) => e.empresaId === 'A');
    expect(alfa.qtdSaida).toBe(1);       // so 1 na janela
    expect(alfa.qtdSaidaTotal).toBe(2);  // 2 na historia
  });
});

// ---------------------------------------------------------------------------
// CONFIRMAÇÃO da ligação do cliente (Paulo, 27/07): "são 2 opções para ligação
// das empresas de XML mod 55 — inserir nosso e-mail no cofre OU autXML com
// nosso CNPJ". O cliente avisa que ligou; o app tem de PROVAR qual das duas
// está valendo, com data — ou dizer o que cobrar.
// ---------------------------------------------------------------------------
describe('trilhoDaOrigem — de onde a saída chegou', () => {
  it('cofre = origem email; autXML = carimbo próprio ou DistDFe', () => {
    expect(trilhoDaOrigem('email')).toBe('cofre');
    expect(trilhoDaOrigem('autxml')).toBe('autxml');
    // A SEFAZ não devolve ao emissor a saída que ele emitiu (Rejeição 641):
    // se veio pelo DistDFe do escritório, é porque o autXML está lá.
    expect(trilhoDaOrigem('sefaz')).toBe('autxml');
  });

  it('importação humana NÃO conta como ligação (mesmo gravando origem sefaz)', () => {
    expect(trilhoDaOrigem('sefaz', 'conferencia-chaves')).toBe('manual');
    expect(trilhoDaOrigem('sefaz', 'consulta-chave-importar')).toBe('manual');
    expect(trilhoDaOrigem('sharepoint_auto')).toBe('manual');
    expect(trilhoDaOrigem('manual')).toBe('manual');
  });

  it('origem ausente não vira confirmação falsa', () => {
    expect(trilhoDaOrigem(null)).toBe('desconhecido');
  });
});

describe('confirmação por cliente — as duas ligações possíveis', () => {
  const empresas = [
    { empresaId: 'A', cnpj: '11111111000191', nome: 'Alfa', regime: 'simples' },
    { empresaId: 'B', cnpj: '22222222000172', nome: 'Beta', regime: 'lucro' },
    { empresaId: 'C', cnpj: '33333333000153', nome: 'Gama', regime: 'simples' },
    { empresaId: 'D', cnpj: '44444444000134', nome: 'Delta', regime: 'lucro' },
  ];
  const docs = [
    // A: cliente apontou o emissor pro cofre → confirmado pelo cofre.
    { empresaId: 'A', direcao: 'saida', chave: chave('55'), dhEmi: iso(3), origem: 'email' },
    // B: cliente pôs nosso CNPJ no autXML → confirmado pelo autXML.
    { empresaId: 'B', direcao: 'saida', chave: chave('55'), dhEmi: iso(1), origem: 'autxml' },
    // C: só entrou porque alguém importou à mão → NÃO confirma nada.
    { empresaId: 'C', direcao: 'saida', chave: chave('55'), dhEmi: iso(4), origem: 'sefaz', capturadoPor: { fonte: 'conferencia-chaves' } },
    // D: emitia antes (fora da janela) e parou de chegar.
    { empresaId: 'D', direcao: 'saida', chave: chave('55'), dhEmi: iso(200), origem: 'sefaz' },
  ];
  const r = analisarCoberturaSaida({ empresas, docs, hojeMs: HOJE, janelaDias: 90 });
  const porNome = (n: string) => r.confirmacoes.find((c: any) => c.nome === n);

  it('cofre ligado: confirmado, com o trilho e a data', () => {
    const c = porNome('Alfa');
    expect(c.confirmado).toBe(true);
    expect(c.trilhos).toEqual(['cofre']);
    expect(c.titulo).toMatch(/cofre de e-mail/);
    expect(c.cofre.qtd).toBe(1);
    expect(c.acao).toBeNull();
  });

  it('autXML ligado: confirmado pelo autXML', () => {
    const c = porNome('Beta');
    expect(c.confirmado).toBe(true);
    expect(c.trilhos).toEqual(['autxml']);
    expect(c.autxml.qtd).toBe(1);
  });

  it('só importação manual: NÃO confirmado, com a cobrança das duas opções', () => {
    const c = porNome('Gama');
    expect(c.confirmado).toBe(false);
    expect(c.trilhos).toEqual(['manual']);
    expect(c.acao).toMatch(/xml@spassessoriacontabil\.com\.br/);
    expect(c.acao).toMatch(/44\.388\.152\/0001-89/);
  });

  it('emitia e parou: aponta a última conhecida e o que checar com o cliente', () => {
    const c = porNome('Delta');
    expect(c.confirmado).toBe(false);
    expect(c.titulo).toMatch(/nada chega/);
    expect(c.acao).toMatch(/autXML DA NOTA/);
    expect(c.acao).toMatch(/Bloco 0100/); // erro real da TI da 4BZ
  });

  it('conta quantas empresas estão confirmadas (as duas ligações valem)', () => {
    expect(r.confirmadas).toBe(2); // Alfa (cofre) + Beta (autXML)
  });
});

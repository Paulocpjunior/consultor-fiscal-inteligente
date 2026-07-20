/**
 * Testes das métricas (Fase 1) e alertas (Fase 2) do cofre de e-mail.
 */
// @ts-expect-error — módulo .js puro
import { agregarKpisDeRuns, diaBRT, mesBRT } from '../sefaz-backend/cofre-email-metrics.js';
// @ts-expect-error — módulo .js puro
import { detectarInatividade, decidirAlertasCofre, montarCorpoAlerta } from '../sefaz-backend/cofre-alerta.js';

const HOJE = Date.parse('2026-07-20T12:00:00-03:00');
const DIA = 24 * 3600 * 1000;

describe('métricas — diaBRT/mesBRT', () => {
  it('fatia o dia no fuso BRT', () => {
    // 01:00 UTC de 21/07 = 22:00 BRT de 20/07
    expect(diaBRT(Date.parse('2026-07-21T01:00:00Z'))).toBe('2026-07-20');
    expect(mesBRT(HOJE)).toBe('2026-07');
  });
});

describe('agregarKpisDeRuns', () => {
  const runs = [
    { ranAtMs: HOJE - 0.2 * DIA, saida: 3, entrada: 1, erros: 0 },   // hoje
    { ranAtMs: HOJE - 0.5 * DIA, saida: 2, entrada: 0, erros: 1 },   // hoje
    { ranAtMs: HOJE - 5 * DIA, saida: 4, entrada: 2, erros: 0 },     // mês, dia -5
    { ranAtMs: HOJE - 40 * DIA, saida: 9, entrada: 9, erros: 0 },    // fora do mês
  ];
  it('soma hoje, mês e total corretamente', () => {
    const k = agregarKpisDeRuns(runs, HOJE, 14);
    expect(k.hoje).toEqual({ saida: 5, entrada: 1, erros: 1 });
    expect(k.mes.saida).toBe(9);   // 3+2+4
    expect(k.total.saida).toBe(18);
    expect(k.total.execucoes).toBe(4);
  });
  it('série diária tem o tamanho pedido e inclui zeros', () => {
    const k = agregarKpisDeRuns(runs, HOJE, 14);
    expect(k.porDia).toHaveLength(14);
    expect(k.porDia[k.porDia.length - 1]).toEqual({ dia: '2026-07-20', saida: 5, entrada: 1 });
    expect(k.porDia.some((d: any) => d.saida === 0 && d.entrada === 0)).toBe(true);
  });
  it('base vazia não quebra', () => {
    const k = agregarKpisDeRuns([], HOJE, 7);
    expect(k.total.saida).toBe(0);
    expect(k.ultimaExecMs).toBeNull();
  });
});

describe('detectarInatividade', () => {
  const mapa = {
    ativa: { nome: 'Ativa', ms: HOJE - 2 * DIA },
    parada: { nome: 'Parada', ms: HOJE - 15 * DIA },
    limite: { nome: 'Limite', ms: HOJE - 7 * DIA - 1 },
  };
  it('flag só quem passou da janela', () => {
    const inativos = detectarInatividade(mapa, HOJE, 7);
    const ids = inativos.map((i: any) => i.empresaId);
    expect(ids).toContain('parada');
    expect(ids).toContain('limite');
    expect(ids).not.toContain('ativa');
  });
  it('calcula diasSem', () => {
    const inativos = detectarInatividade({ x: { nome: 'X', ms: HOJE - 10 * DIA } }, HOJE, 7);
    expect(inativos[0].diasSem).toBe(10);
  });
});

describe('decidirAlertasCofre + anti-spam', () => {
  it('junta erros, pendências e inatividade', () => {
    const d = decidirAlertasCofre({
      run: { erros: 2, errosDetalhe: ['a.xml: x', 'b.xml: y'] },
      pendencias: [{ assunto: 'Nota', from: 'z@x.com', anexos: ['danfe.pdf [fileAttachment]'] }],
      inativos: [{ empresaId: 'p', nome: 'Parada', diasSem: 15 }],
      estadoAnterior: null,
    });
    expect(d.enviar).toBe(true);
    expect(d.alertas.map((a: any) => a.tipo).sort()).toEqual(['erros_import', 'inatividade', 'pendencias']);
  });
  it('não reenvia quando a assinatura não mudou', () => {
    const args = { run: { erros: 1, errosDetalhe: ['a.xml: x'] }, pendencias: [], inativos: [] };
    const first = decidirAlertasCofre({ ...args, estadoAnterior: null });
    const second = decidirAlertasCofre({ ...args, estadoAnterior: { assinatura: first.assinatura } });
    expect(first.enviar).toBe(true);
    expect(second.enviar).toBe(false); // mesma assinatura -> silencia
  });
  it('sem alertas -> não envia', () => {
    const d = decidirAlertasCofre({ run: { erros: 0 }, pendencias: [], inativos: [], estadoAnterior: null });
    expect(d.enviar).toBe(false);
    expect(d.assinatura).toBe('sem_alerta');
  });
  it('novo alerta depois de silêncio volta a enviar', () => {
    const sohErro = decidirAlertasCofre({ run: { erros: 1, errosDetalhe: ['a'] }, pendencias: [], inativos: [], estadoAnterior: null });
    const comPendencia = decidirAlertasCofre({
      run: { erros: 1, errosDetalhe: ['a'] },
      pendencias: [{ assunto: 'p' }],
      inativos: [],
      estadoAnterior: { assinatura: sohErro.assinatura },
    });
    expect(comPendencia.enviar).toBe(true); // assinatura mudou (surgiu pendência)
  });
});

describe('montarCorpoAlerta', () => {
  it('gera HTML e escapa conteúdo', () => {
    const html = montarCorpoAlerta([
      { tipo: 'pendencias', qtd: 1, detalhe: [{ assunto: '<b>x</b>', from: 'a@b.com', anexos: ['f.pdf'] }] },
      { tipo: 'inatividade', qtd: 1, empresas: [{ empresaId: 'p', nome: 'Parada', diasSem: 9 }] },
    ]);
    expect(html).toContain('Cofre CFI');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;'); // escapado
    expect(html).toContain('9 dia(s)');
  });
});

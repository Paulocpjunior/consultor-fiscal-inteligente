import { drenarReconferencia, fraseDaDrenagem } from '../services/reconferenciaEncadeada';

// ============================================================================
// 🚨 "PEDE PARA EU RECONFERIR 3 VEZES DE 1 EM 1" (02/09, Paulo, MV LIDER 0639)
//
// *"tenho 3 canceladas e não considerou, pede para eu reconferi 3 vezes de 1
// em 1, isso que precisa verificar, já imaginou uma NOVA ERA da vida?"*
//
// O teto por rodada (~60) EXISTE E FICA: cada consulta é uma chamada com o
// certificado do cliente, e varrer centenas de uma vez arrisca o cStat 656. O
// que não pode é o TETO virar tarefa do colaborador — 126 notas eram 3 cliques,
// e uma carteira grande seria dezenas. Ninguém clica dezenas de vezes: na
// prática a reconferência não roda, e "0 cancelada(s)" continua sendo o que o
// app SABE, não o que a SEFAZ diz.
// ============================================================================
const rodada = (consultadas: number, cortadas: number, canceladas = 0, extra: any = {}) => ({
    ok: true,
    selecao: { aConsultar: consultadas, total: 126, cortadas },
    resultados: [],
    resumo: {
        consultadas, canceladas, naoCanceladas: consultadas - canceladas,
        naoCanceladasPorRecusa: 0, indeterminadas: 0, valorRemovido: canceladas * 100, avisos: [],
    },
    ...extra,
});

const fila = (rs: any[]) => {
    let i = 0;
    return () => Promise.resolve(rs[i++] || rodada(0, 0));
};

describe('🔁 a reconferência drena a competência com UM clique', () => {
    it('três rodadas encadeadas, com o ACUMULADO das três', async () => {
        const chamar = jest.fn(fila([rodada(60, 66, 1), rodada(60, 6, 2), rodada(6, 0, 0)]));
        const fim = await drenarReconferencia({ chamar });
        expect(chamar).toHaveBeenCalledTimes(3);
        expect(fim.motivo).toBe('drenou');
        // 🚨 O número é o das TRÊS: mostrar o da última faria "6 consultadas"
        // aparecer depois de 126 perguntas.
        expect(fim.acumulado.consultadas).toBe(126);
        expect(fim.acumulado.canceladas).toBe(3);
        expect(fim.acumulado.valorRemovido).toBe(300);
        expect(fraseDaDrenagem(fim)).toMatch(/drenada em 3 rodada/);
    });

    // ⚠️ PARA NO cStat 656: é a SEFAZ dizendo "consulta demais". Insistir é
    // colecionar recusa e ESTENDER o bloqueio (a régua do respiro, 27/08).
    it('para no bloqueio por excesso e DIZ que a espera é de ~1h', async () => {
        const chamar = jest.fn(fila([rodada(60, 66, 0, { abortou656: true }), rodada(60, 6)]));
        const fim = await drenarReconferencia({ chamar });
        expect(chamar).toHaveBeenCalledTimes(1);
        expect(fim.motivo).toBe('rate-limit');
        const frase = fraseDaDrenagem(fim);
        expect(frase).toMatch(/cStat 656/);
        expect(frase).toMatch(/1 hora/);
        // ⚠️ E DIZ que é limite da SEFAZ — senão a pessoa procura defeito no app.
        expect(frase).toMatch(/limite DELA/);
        // ⚠️ E que o já perguntado não se perde: o carimbo faz a fila andar.
        expect(frase).toMatch(/continua de onde parou/);
    });

    // ⚠️ Rodada sem progresso NÃO vira laço — o teto sozinho gastaria 40
    // chamadas à SEFAZ para não perguntar nada.
    it('para quando a rodada não consulta nada', async () => {
        const chamar = jest.fn(fila([rodada(0, 66), rodada(60, 6)]));
        const fim = await drenarReconferencia({ chamar });
        expect(chamar).toHaveBeenCalledTimes(1);
        expect(fim.motivo).toBe('sem-progresso');
    });

    it('erro na rodada para na hora e devolve a resposta', async () => {
        const chamar = jest.fn(async () => ({ ok: false, error: 'Sessão expirada' } as any));
        const fim = await drenarReconferencia({ chamar });
        expect(chamar).toHaveBeenCalledTimes(1);
        expect(fim.motivo).toBe('erro');
        expect(fim.ultima?.error).toBe('Sessão expirada');
    });

    it('o botão "parar" é respeitado entre rodadas', async () => {
        const chamar = jest.fn(fila([rodada(60, 66), rodada(60, 6), rodada(6, 0)]));
        const fim = await drenarReconferencia({ chamar, parar: () => true });
        expect(chamar).toHaveBeenCalledTimes(1);
        expect(fim.motivo).toBe('parado-pelo-usuario');
        expect(fraseDaDrenagem(fim)).toMatch(/Clique de novo para continuar/);
    });

    // ⚠️ TETO DEFENSIVO: backend que parasse de progredir com `cortadas` sempre
    // > 0 viraria laço infinito no navegador do colaborador.
    it('o teto de rodadas segura o laço infinito', async () => {
        const chamar = jest.fn(async () => rodada(60, 66) as any);
        const fim = await drenarReconferencia({ chamar, maxRodadas: 5 });
        expect(chamar).toHaveBeenCalledTimes(5);
        expect(fim.motivo).toBe('teto-de-rodadas');
        expect(fraseDaDrenagem(fim)).toMatch(/teto de 5 rodadas/);
    });

    it('o progresso é reportado a cada rodada, ao vivo', async () => {
        const vistos: number[] = [];
        await drenarReconferencia({
            chamar: fila([rodada(60, 66), rodada(60, 6), rodada(6, 0)]),
            onProgresso: (acc) => vistos.push(acc.consultadas),
        });
        expect(vistos).toEqual([60, 120, 126]);
    });
});

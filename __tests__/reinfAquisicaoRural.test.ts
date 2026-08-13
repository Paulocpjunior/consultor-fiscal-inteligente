// ============================================================================
// R-2055 — as aquisições de produção rural no formato do EFD-Reinf.
//
// O que estes testes protegem: o eixo muda (a aba 🌾 responde por NOTA e por
// MUNICÍPIO; o R-2055 é declarado por PRODUTOR), mas o CÁLCULO não se refaz.
// Dois números diferentes pro mesmo fato é o pior defeito de um arquivo fiscal.
// ============================================================================
import {
    montarPayloadR2055, normalizarAquisicao,
    CODIGOS_RECEITA_FUNRURAL, conferirTotalizadorR2099,
} from '../sefaz-backend/reinf-aquisicao-rural.js';

/** Bloco `funrural` como sai de montarDipamCompetencia. */
const funruralDe = (notas: any[]) => ({ notas, revisarAliquotas: false });

const nota = (over: any = {}) => ({
    chave: '3526...0001', numero: '425231', dhEmi: '2026-07-15',
    fornecedor: 'JOAO DA SILVA', doc: '11122233344', uf: 'SP',
    base: 1000, inss: 12, gilrat: 1, senar: 2, total: 15,
    aliquotas: { inss: 1.2, gilrat: 0.1, senar: 0.2 },
    declarado: null, divergencia: null,
    ...over,
});

describe('o eixo vira PRODUTOR, e o cálculo não se refaz', () => {
    test('duas notas do mesmo produtor viram UM bloco somado', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44.388.152/0001-89',
            competencia: '2026-07',
            funrural: funruralDe([nota(), nota({ numero: '425232', base: 500, inss: 6, gilrat: 0.5, senar: 1, total: 7.5 })]),
        });
        expect(r.produtores).toHaveLength(1);
        const p = r.produtores[0];
        expect(p.aquisicoes).toHaveLength(2);
        expect(p.base).toBe(1500);
        expect(p.total).toBe(22.5);
        expect(r.resumo.aquisicoes).toBe(2);
    });

    test('os valores vêm PRONTOS — nenhuma alíquota é multiplicada aqui', () => {
        // Valores propositalmente "errados" pra alíquota: se a casca recalculasse,
        // ela os corrigiria. Ela não pode: quem apura é o núcleo da DIPAM.
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([nota({ base: 1000, inss: 99, gilrat: 88, senar: 77, total: 264 })]),
        });
        expect(r.produtores[0].inss).toBe(99);
        expect(r.produtores[0].total).toBe(264);
    });

    test('produtores diferentes viram blocos diferentes, ordenados por nome', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([
                nota({ doc: '99988877766', fornecedor: 'ZEBEDEU' }),
                nota({ doc: '11122233344', fornecedor: 'ANTONIO' }),
            ]),
        });
        expect(r.produtores.map((p: any) => p.nome)).toEqual(['ANTONIO', 'ZEBEDEU']);
    });
});

/**
 * A RÉGUA DE QUEM É PRODUTOR PF NÃO MORA AQUI.
 *
 * Caso VINCENZO GUERRA 07/2026 (Paulo, 12/08): *"ta puxando aqui os valores de
 * FUNRURAL certinho, mas quando vou CCI ele, fala que não tem"*. A aba 🌾
 * apurava R$ 308,07 de 4 notas de ANTONIO DIAS DA SILVA (08.507.490/0001-29) e
 * esta casca respondia "NENHUMA aquisição encontrada", porque descartava tudo
 * que não tivesse 11 dígitos.
 *
 * Eram DUAS RÉGUAS PRO MESMO FATO: o 🌾 honra o cadastro do produtor e a IE
 * paulista com "P" (CNPJ não descaracteriza produtor rural PF — Comunicado CAT
 * 45/2008), esta casca contava dígitos. Se a nota entrou no FUNRURAL, a
 * sub-rogação já foi decidida lá.
 */
describe('produtor rural PF com CNPJ (caso VINCENZO × ANTONIO DIAS DA SILVA)', () => {
    const comCnpj = nota({
        doc: '08507490000129', fornecedor: 'ANTONIO DIAS DA SILVA', ie: 'P4111111111',
        naturezaConfianca: 'confirmada',
        naturezaMotivo: 'Confirmado no cadastro como Produtor Rural (Pessoa Física).',
    });

    test('ele ENTRA no payload — descartar era ignorar a apuração do 🌾', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07', funrural: funruralDe([comCnpj]),
        });
        expect(r.produtores).toHaveLength(1);
        expect(r.produtores[0].docProdutor).toBe('08507490000129');
        expect(r.produtores[0].total).toBe(15);
        // O que NÃO pode voltar: a resposta "não tem aquisição" pra quem tem.
        expect(r.ressalvas.join(' ')).not.toMatch(/NENHUMA aquisição/);
    });

    test('CNPJ NUNCA sai num campo chamado "cpf" — é a mentira do csllOuTotal', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07', funrural: funruralDe([comCnpj]),
        });
        expect(r.produtores[0].cpfProdutor).toBeNull();
        expect(r.produtores[0].tipoInscricao).toBe('cnpj');
        expect(r.produtores[0].inscricaoAtipica).toBe(true);
    });

    test('CPF normal segue preenchendo cpfProdutor', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07', funrural: funruralDe([nota()]),
        });
        expect(r.produtores[0].cpfProdutor).toBe('11122233344');
        expect(r.produtores[0].tipoInscricao).toBe('cpf');
        expect(r.produtores[0].inscricaoAtipica).toBe(false);
    });

    test('a PROVA da natureza viaja carimbada com a origem', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07', funrural: funruralDe([comCnpj]),
        });
        expect(r.produtores[0].provaDeProdutorPF.confianca).toBe('confirmada');
        expect(r.produtores[0].provaDeProdutorPF.motivo).toMatch(/Produtor Rural/);
        expect(r.produtores[0].ie).toBe('P4111111111');
    });

    test('a ressalva nomeia o produtor, cita a CAT 45/2008 e PROÍBE descartar', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07', funrural: funruralDe([comCnpj]),
        });
        expect(r.resumo.comCnpj).toBe(1);
        const txt = r.ressalvas.join(' ');
        expect(txt).toMatch(/ANTONIO DIAS DA SILVA/);
        expect(txt).toMatch(/45\/2008/);
        expect(txt).toMatch(/NÃO descarte/);
        // O tipo de inscrição do ideProdutor não se deduz — e a ressalva não
        // para no diagnóstico: ela diz COMO resolver.
        expect(txt).toMatch(/tpInscProd=2/);
        expect(txt).toMatch(/COMO RESOLVER/);
        expect(txt).toMatch(/CPF do titular/);
    });
});

describe('o que fica de fora NÃO some em silêncio', () => {
    test('doc ilegível fica fora, mas NOMEADO — nunca contador mudo', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([nota(), nota({ doc: '123', fornecedor: 'SEM DOC' })]),
        });
        expect(r.produtores).toHaveLength(1);
        expect(r.resumo.semInscricao).toBe(1);
        expect(r.semInscricao[0].fornecedor).toBe('SEM DOC');
        expect(r.ressalvas.join(' ')).toMatch(/sem CPF\/CNPJ legível/);
    });

    test('zero aquisição NÃO é sucesso — pode ser buraco de captura', () => {
        const r = montarPayloadR2055({ cnpjAdquirente: '44388152000189', competencia: '2026-07', funrural: funruralDe([]) });
        expect(r.produtores).toHaveLength(0);
        expect(r.ressalvas.join(' ')).toMatch(/problema é de CAPTURA/);
        expect(r.ressalvas.join(' ')).toMatch(/condicaoRural/);
    });
});

describe('o que o app NÃO sabe vai nulo, e o que ele sabe viaja', () => {
    test('indAquis é NULO: a tabela oficial não está neste app', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07', funrural: funruralDe([nota()]),
        });
        expect(r.produtores[0].indAquis).toBeNull();
        expect(r.ressalvas[0]).toMatch(/indAquis/);
        expect(r.ressalvas[0]).toMatch(/não se inventa/);
    });

    test('mas SEGURADO ESPECIAL viaja — é ele que decide a natureza da aquisição', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([nota()]),
            produtores: { '11122233344': { seguradoEspecial: true } },
        });
        expect(r.produtores[0].seguradoEspecial).toBe(true);
        expect(r.resumo.seguradoEspecial).toBe(1);
    });

    test('sem cadastro, seguradoEspecial é false — nunca undefined viajando como "talvez"', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07', funrural: funruralDe([nota()]),
        });
        expect(r.produtores[0].seguradoEspecial).toBe(false);
    });

    test('a ressalva PROÍBE recalcular do outro lado', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07', funrural: funruralDe([nota()]),
        });
        expect(r.ressalvas.join(' ')).toMatch(/NÃO recalcule/);
        expect(r.ressalvas.join(' ')).toMatch(/LC 224\/2025/);
    });
});

describe('a divergência com a própria nota chega do outro lado', () => {
    test('nota com FUNRURAL declarado diferente do calculado acende', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([nota({ declarado: 20, divergencia: { calculado: 15, declarado: 20 } })]),
        });
        expect(r.produtores[0].comDivergencia).toBe(1);
        expect(r.resumo.comDivergencia).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/discordam sobre quanto foi retido/);
    });

    test('a aquisição carrega o valor declarado na nota, não só o calculado', () => {
        const a = normalizarAquisicao(nota({ declarado: 20 }));
        expect(a.declaradoNaNota).toBe(20);
        expect(a.total).toBe(15);
    });
});

describe('nomes de campo não fingem ser do leiaute', () => {
    test('a quebra usa os nomes do CÁLCULO (inss/gilrat/senar)', () => {
        const a = normalizarAquisicao(nota());
        expect(Object.keys(a)).toEqual(expect.arrayContaining(['inss', 'gilrat', 'senar', 'total']));
        // Nome que finge ser do leiaute faria o outro lado escrever no campo
        // errado achando que conferiu — é a lição do `csllOuTotal`.
        expect(Object.keys(a)).not.toEqual(expect.arrayContaining(['vlrCPDescPR', 'vlrRatDescPR', 'vlrSenarDesc']));
    });
});

/**
 * O CPF DO TITULAR — o que destrava o produtor inscrito por CNPJ.
 *
 * O `ideProdutor` do R-2055 identifica a PESSOA, e a única forma provada contra
 * evento aceito é tpInscProd=2 (CPF). O produtor rural PF pode estar inscrito
 * por CNPJ (Com. CAT 45/2008) e a NOTA traz o CNPJ do estabelecimento rural —
 * quem sabe o CPF é o CADESP, e ele entra no cadastro do produtor.
 *
 * Não é dedução nem contorno: é o cadastro trazendo o que a nota não traz,
 * exatamente como o `seguradoEspecial` e a opção pela folha.
 */
describe('CPF do titular vindo do cadastro do produtor', () => {
    const comCnpj = nota({ doc: '08507490000129', fornecedor: 'ANTONIO DIAS DA SILVA' });
    const cadastro = { '08507490000129': { cpfTitular: '12345678901' } };

    test('com o CPF cadastrado, o produtor passa a declarar por CPF', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07',
            funrural: funruralDe([comCnpj]), produtores: cadastro,
        });
        expect(r.produtores[0].cpfProdutor).toBe('12345678901');
        expect(r.produtores[0].tipoInscricao).toBe('cpf');
        // O documento da NOTA continua visível — trocar sem dizer seria pior.
        expect(r.produtores[0].docProdutor).toBe('08507490000129');
        expect(r.resumo.comCnpj).toBe(0);
    });

    test('a ORIGEM do CPF viaja carimbada — ele não veio do documento', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07',
            funrural: funruralDe([comCnpj]), produtores: cadastro,
        });
        expect(r.produtores[0].origemDoCpf).toBe('cadastro-do-produtor');
        const txt = r.ressalvas.join(' ');
        expect(txt).toMatch(/CPF vindo do CADASTRO, não da nota/);
        expect(txt).toMatch(/CNPJ 08507490000129 → CPF 12345678901/);
        expect(txt).toMatch(/declarar em nome da pessoa errada não se desfaz/);
    });

    test('CPF que veio da própria nota é carimbado como tal', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07', funrural: funruralDe([nota()]),
        });
        expect(r.produtores[0].origemDoCpf).toBe('nota');
        expect(r.ressalvas.join(' ')).not.toMatch(/vindo do CADASTRO/);
    });

    test('sem CPF cadastrado, segue bloqueado — e a ressalva DIZ como resolver', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07', funrural: funruralDe([comCnpj]),
        });
        expect(r.produtores[0].cpfProdutor).toBeNull();
        expect(r.produtores[0].origemDoCpf).toBeNull();
        expect(r.ressalvas.join(' ')).toMatch(/COMO RESOLVER/);
        expect(r.ressalvas.join(' ')).toMatch(/CADESP/);
    });

    test('CPF cadastrado torto é ignorado — não se declara com documento inválido', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '63027940000194', competencia: '2026-07',
            funrural: funruralDe([comCnpj]), produtores: { '08507490000129': { cpfTitular: '123' } },
        });
        expect(r.produtores[0].cpfProdutor).toBeNull();
        expect(r.produtores[0].tipoInscricao).toBe('cnpj');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROVADO EM PRODUÇÃO — VINCENZO GUERRA, PA 07/2026, 13/08/2026 10:47:37.
//
// O R-2055 foi transmitido e o R-2099 fechou o período (MS7001, recibo
// 11774083-10-2099-2607-11774083). O "Totalizador das contribuições sociais
// incidentes sobre a aquisição de produção rural" devolveu, por código:
//
//   1656-01 → R$ 249,48   ·   1646-03 → R$ 20,79   ·   1213-06 → R$ 37,80
//
// A aba 🌾 tinha apurado sobre base de R$ 18.900,00 (LC 224/2025):
//   INSS 1,32% = 249,48 · GILRAT 0,11% = 20,79 · SENAR 0,20% = 37,80
//
// As três alíquotas são diferentes entre si, então o casamento é ÚNICO: o
// de-para código→componente fica provado por recibo, não por dedução. E o
// total (R$ 308,07) bater nos dois caminhos é CORROBORAÇÃO — a Receita e o
// CFI chegaram no mesmo número por vias independentes.
// ═══════════════════════════════════════════════════════════════════════════
describe('conferência contra o totalizador do R-2099', () => {
    const APURADO = { inss: 249.48, gilrat: 20.79, senar: 37.80 };
    const TOTALIZADOR_REAL = [
        { codigoReceita: '1213-06', valor: 37.80 },
        { codigoReceita: '1646-03', valor: 20.79 },
        { codigoReceita: '1656-01', valor: 249.48 },
    ];

    it('o de-para dos códigos de receita é o do recibo aceito', () => {
        expect(CODIGOS_RECEITA_FUNRURAL).toEqual({
            inss: '1656-01', gilrat: '1646-03', senar: '1213-06',
        });
    });

    it('bate componente a componente com o caso real', () => {
        const c = conferirTotalizadorR2099({ apurado: APURADO, totalizador: TOTALIZADOR_REAL });
        expect(c.situacao).toBe('confere');
        expect(c.linhas).toHaveLength(3);
        for (const l of c.linhas) expect(l.confere).toBe(true);
        expect(c.codigosDesconhecidos).toEqual([]);
        expect(c.resumo).toMatch(/308,07|308\.07/);
        expect(c.resumo).toMatch(/caminhos independentes/);
    });

    // ─── AS TRAVAS ──────────────────────────────────────────────────────────
    it('SEM totalizador não existe "conferido" — sucesso não é conferência', () => {
        const c = conferirTotalizadorR2099({ apurado: APURADO, totalizador: [] });
        expect(c.situacao).toBe('nao-conferido');
        expect(c.resumo).toMatch(/prova que o XML foi aceito, não que a Receita entendeu/);
        expect(c.resumo).toMatch(/contra o totalizador que a guia é paga/);
    });

    it('divergência de UM centavo é divergência — o FUNRURAL já vem sem centavo', () => {
        const c = conferirTotalizadorR2099({
            apurado: APURADO,
            totalizador: [...TOTALIZADOR_REAL.slice(0, 2), { codigoReceita: '1656-01', valor: 249.47 }],
        });
        expect(c.situacao).toBe('divergente');
        const inss = c.linhas.find((l: any) => l.componente === 'inss');
        expect(inss!.confere).toBe(false);
        expect(inss!.diferenca).toBe(-0.01);
    });

    it('código que a Receita não totalizou é AUSENTE, nunca "bateu em zero"', () => {
        const c = conferirTotalizadorR2099({
            apurado: APURADO,
            totalizador: TOTALIZADOR_REAL.filter(t => t.codigoReceita !== '1213-06'),
        });
        expect(c.situacao).toBe('divergente');
        const senar = c.linhas.find((l: any) => l.componente === 'senar');
        expect(senar!.totalizado).toBeNull();
        expect(senar!.confere).toBe(false);
        expect(c.resumo).toMatch(/Ausente não é zero/);
    });

    it('código desconhecido fica FORA da conta e NOMEADO — somar inventaria divergência', () => {
        const c = conferirTotalizadorR2099({
            apurado: APURADO,
            totalizador: [...TOTALIZADOR_REAL, { codigoReceita: '9999-99', valor: 500 }],
        });
        expect(c.situacao).toBe('divergente');
        expect(c.codigosDesconhecidos).toEqual([{ codigoReceita: '9999-99', valor: 500 }]);
        expect(c.resumo).toMatch(/este app\s+não conhece|não conhece/);
        // As três linhas conhecidas continuam batendo — o desconhecido não as contamina.
        for (const l of c.linhas) expect(l.confere).toBe(true);
    });
});

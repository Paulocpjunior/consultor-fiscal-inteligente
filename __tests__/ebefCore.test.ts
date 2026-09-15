import {
  analisarEbef,
  novoEbef,
  documentoValido,
  validarAcaoEbef,
} from "../sefaz-backend/ebef-core.js";
import type { EbefDraft, EbefPessoa, EbefRecord } from "../services/ebefTypes";
const docs = [
  {
    id: "doc",
    nome: "Contrato",
    tamanho: 10,
    sha256: "hash",
    criadoEm: "2026-01-01",
    autor: "a",
  },
];
function pf(id: string, cpf: string): EbefPessoa {
  return {
    id,
    tipo: "PF",
    papelScp: "nenhum",
    beneficiariosScp: [],
    fundamentoScp: "",
    nome: id,
    documento: cpf,
    pais: "BR",
    administrador: false,
    controle: false,
    fundamentoControle: "",
    evidenciaId: "doc",
    assinatura: "pendente",
    assinaturaEvidenciaId: "",
    assinaturaJustificativa: "",
  };
}
function base(): EbefDraft {
  return {
    ...novoEbef(2026),
    natureza: "sa_fechada",
    domicilio: "BR",
    evidenciaEnquadramentoId: "doc",
    enquadramentoConferido: true,
    matrizConferida: true,
    dataBase: "2026-09-15",
    responsavel: "Equipe",
    cadeiaConferida: true,
    controleConferido: true,
    pessoas: [pf("A", "52998224725"), pf("B", "11144477735")],
    vinculos: [
      {
        id: "a",
        titularId: "A",
        entidadeId: "matriz",
        capital: "75",
        votos: "75",
        inicio: "2025-01-01",
        fim: "",
        evidenciaId: "doc",
      },
      {
        id: "b",
        titularId: "B",
        entidadeId: "matriz",
        capital: "25",
        votos: "25",
        inicio: "2025-01-01",
        fim: "",
        evidenciaId: "doc",
      },
    ],
  };
}
const a = (d: EbefDraft) => analisarEbef(d, docs);
describe("e-BEF — decisões, evidências e fronteiras legais", () => {
  test("CNPJ do cliente e documentos inválidos", () => {
    expect(documentoValido("PJ", "61.343.420/0001-65", "BR")).toBe(true);
    expect(documentoValido("PF", "11111111111", "BR")).toBe(false);
  });
  test("25% exatos não bastam; >25 não depende de arredondamento", () => {
    const d = base();
    expect(a(d).beneficiarios.map((x) => x.id)).toEqual(["A"]);
    d.vinculos[1]!.capital = "25.000001";
    d.vinculos[0]!.capital = "74.999999";
    expect(a(d).beneficiarios.map((x) => x.id)).toEqual(["A", "B"]);
  });
  test("controle abaixo do limite é analisado separadamente", () => {
    const d = base();
    d.pessoas[1]!.controle = true;
    d.pessoas[1]!.fundamentoControle = "Acordo, cláusula 4";
    expect(a(d).beneficiarios).toHaveLength(2);
  });
  test("incompletude impede aprovação; não transforma sócios em administradores", () => {
    const d = base();
    d.vinculos[0]!.capital = "20";
    d.vinculos[0]!.votos = "20";
    d.vinculos[1]!.capital = "20";
    d.vinculos[1]!.votos = "20";
    expect(a(d).beneficiarios).toHaveLength(0);
    expect(a(d).pendencias.some((p) => p.includes("100%"))).toBe(true);
  });
  test("admin real só na ausência de demais critérios e com cadeia completa", () => {
    const d = base();
    d.vinculos[0]!.capital = "50";
    d.vinculos[1]!.capital = "50";
    d.pessoas[1]!.administrador = true;
    expect(
      a(d).beneficiarios.every(
        (b) => !b.criterios.some((c) => c.includes("subsidiária")),
      ),
    ).toBe(true);
  });
  test("receita de 300 milhões não antecipa Ltda. sem PJ para 2026", () => {
    const d = base();
    Object.assign(d, {
      natureza: "ltda",
      socioPJ: "nao",
      receitaAnterior: "300000001",
      receitaAno: 2025,
      evidenciaReceitaId: "doc",
    });
    expect(a(d).enquadramento).toBe("futura");
    expect(a(d).prazoLegal).toBeNull();
    d.socioPJ = "sim";
    expect(a(d).inicioObrigacao).toBe("2026-01-01");
  });
  test("receita ausente não é zero; exercício errado não fundamenta dispensa", () => {
    const d = base();
    Object.assign(d, { natureza: "ltda", socioPJ: "nao", receitaAnterior: "" });
    expect(a(d).enquadramento).toBe("inconclusivo");
    d.receitaAnterior = "1";
    d.receitaAno = 2026;
    expect(a(d).enquadramento).toBe("inconclusivo");
  });
  test("dispensa até 4,8 milhões e marco de 78 milhões", () => {
    const d = base();
    Object.assign(d, {
      natureza: "ltda",
      socioPJ: "nao",
      receitaAnterior: "4800000",
      evidenciaReceitaId: "doc",
    });
    expect(a(d).enquadramento).toBe("dispensada");
    d.receitaAnterior = "78000000";
    expect(a(d).inicioObrigacao).toBe("2028-01-01");
    d.receitaAnterior = "78000000.01";
    expect(a(d).inicioObrigacao).toBe("2027-01-01");
  });
  test("30 dias por evento cruza ano e não usa data de hoje", () => {
    const d = base();
    Object.assign(d, {
      evento: "alteracao",
      dataEvento: "2026-12-20",
      evidenciaEventoId: "doc",
    });
    expect(a(d).prazoLegal).toBe("2027-01-19");
    d.dataEvento = "";
    expect(a(d).prazoLegal).toBeNull();
  });
  test("datas inexistentes e percentuais negativos são recusados", () => {
    const d = base();
    d.dataBase = "2026-02-30";
    expect(() => a(d)).toThrow();
    d.dataBase = "2026-02-01";
    d.vinculos[0]!.capital = "-1";
    expect(() => a(d)).toThrow();
  });
  test("caminhos diretos e indiretos somam sem fundir homônimos", () => {
    const d = base();
    d.pessoas.push({ ...pf("H", "61343420000165"), tipo: "PJ" });
    d.pessoas[0]!.nome = "Mesmo nome";
    d.pessoas[1]!.nome = "Mesmo nome";
    d.vinculos = [
      { ...d.vinculos[0]!, capital: "10", votos: "10" },
      { ...d.vinculos[1]!, capital: "50", votos: "50" },
      {
        ...d.vinculos[0]!,
        id: "h",
        titularId: "H",
        capital: "40",
        votos: "40",
      },
      {
        ...d.vinculos[0]!,
        id: "ha",
        entidadeId: "H",
        capital: "50",
        votos: "50",
      },
      {
        ...d.vinculos[1]!,
        id: "hb",
        entidadeId: "H",
        capital: "50",
        votos: "50",
      },
    ];
    expect(a(d).beneficiarios.map((x) => [x.id, x.percentual])).toEqual([
      ["A", "30.00000000"],
      ["B", "70.00000000"],
    ]);
  });
  test("identidade duplicada e cadeia circular bloqueiam", () => {
    const d = base();
    d.pessoas[1]!.documento = d.pessoas[0]!.documento;
    expect(a(d).pendencias.some((p) => p.includes("duplicado"))).toBe(true);
    d.pessoas.push({ ...pf("H", "61343420000165"), tipo: "PJ" });
    d.vinculos.push(
      { ...d.vinculos[0]!, id: "h", titularId: "H" },
      { ...d.vinculos[0]!, id: "hh", titularId: "H", entidadeId: "H" },
    );
    expect(a(d).pendencias.some((p) => p.includes("circular"))).toBe(true);
  });
  test("evidência de outro dossiê não valida a análise", () => {
    expect(
      analisarEbef(base(), []).pendencias.some((p) => p.includes("Anexar")),
    ).toBe(true);
  });
  test("SCP inclui participante PF com 1% e não depende de faturamento", () => {
    const d = base();
    d.natureza = "scp";
    d.pessoas[0]!.papelScp = "ostensivo";
    d.pessoas[1]!.papelScp = "participante";
    d.vinculos[0]!.capital = "99";
    d.vinculos[1]!.capital = "1";
    expect(a(d).enquadramento).toBe("obrigada");
    expect(a(d).beneficiarios.map((b) => b.id)).toEqual(["A", "B"]);
    expect(a(d).pendencias).toEqual([]);
  });
  test("SCP com sócio PJ exige identificação documental dos beneficiários", () => {
    const d = base();
    d.natureza = "scp";
    d.pessoas[0]!.tipo = "PJ";
    d.pessoas[0]!.documento = "61343420000165";
    d.pessoas[0]!.papelScp = "ostensivo";
    d.pessoas[1]!.papelScp = "participante";
    expect(a(d).pendencias.some((p) => p.includes("sócio PJ"))).toBe(true);
  });
  test("conclusão sem entrega e aprovação sem permissão são impedidas", () => {
    const d = base();
    const r = {
      draft: d,
      documentos: docs,
      analise: a(d),
      status: "em_revisao",
      entrega: null,
    } as EbefRecord;
    expect(() => validarAcaoEbef(r, "aprovar", "colaborador")).toThrow(
      "administrador",
    );
    expect(validarAcaoEbef(r, "aprovar", "admin")).toBe("aprovado");
    r.status = "entrega_registrada";
    expect(() => validarAcaoEbef(r, "concluir", "admin")).toThrow(
      "comprovante",
    );
  });
  test("SCP sem percentual documentado não inventa zero", () => {
    const d = base();
    d.natureza = "scp";
    d.pessoas[0]!.papelScp = "ostensivo";
    d.pessoas[1]!.papelScp = "participante";
    for (const v of d.vinculos) {
      v.capital = "";
      v.votos = "";
    }
    expect(a(d).pendencias).toEqual([]);
    expect(
      a(d).beneficiarios.every((b) => b.percentual === "não quantificado"),
    ).toBe(true);
  });
  test("estrangeiro sem dados complementares não pode ser aprovado", () => {
    const d = base();
    d.pessoas[0]!.pais = "US";
    d.pessoas[0]!.documento = "PASS1234";
    expect(a(d).pendencias.some((p) => p.includes("estrangeiro"))).toBe(true);
  });
  test("matriz precisa ser comprovada, não deduzida do sufixo", () => {
    const d = base();
    d.matrizConferida = false;
    expect(a(d).pendencias.some((p) => p.includes("matriz"))).toBe(true);
  });
});

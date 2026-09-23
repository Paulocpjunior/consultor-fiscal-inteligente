// e-BEF: regras puras, cálculo racional e decisões rastreáveis. Sem IO.
import { z } from "zod";
export const EBEF_REGRA = "RFB-2290-2025/manual-v2-2026.1";
export const EBEF_FONTE =
  "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/cadastros/cnpj/Manual_eBEF_V02_rev060426.pdf";
const txt = (n = 2000) => z.string().max(n);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const ref = z.union([id, z.literal("")]);
const date = z
  .string()
  .refine(
    (v) =>
      !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    "Data inválida",
  );
const decimal = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$|^$/,
    "Use valor positivo com ponto decimal",
  );
const percent = decimal.refine(
  (v) => !v || Number(v) <= 100,
  "Percentual acima de 100",
);
export const ebefSchema = z
  .object({
    ano: z.number().int().min(2026).max(2100),
    dataBase: date,
    natureza: z.enum([
      "nao_informada",
      "ltda",
      "simples",
      "scp",
      "sa_fechada",
      "slu",
      "empresario_individual",
      "outra",
    ]),
    domicilio: z.enum(["BR", "exterior", "nao_informado"]),
    receitaAnterior: decimal,
    receitaAno: z.number().int().min(2025).max(2100),
    evidenciaReceitaId: ref,
    socioPJ: z.enum(["sim", "nao", "nao_confirmado"]),
    evidenciaEnquadramentoId: ref,
    enquadramentoConferido: z.boolean(),
    matrizConferida: z.boolean(),
    evento: z.enum(["anual", "inscricao", "alteracao", "passou_obrigada"]),
    dataEvento: date,
    evidenciaEventoId: ref,
    prazoInterno: date,
    responsavel: txt(200),
    observacoes: txt(5000),
    cadeiaConferida: z.boolean(),
    controleConferido: z.boolean(),
    pessoas: z
      .array(
        z
          .object({
            id,
            exterior: z
              .object({
                nascimento: date,
                naturalidade: txt(200),
                residenciaFiscal: txt(2),
                nif: txt(100),
                endereco: txt(1000),
                email: txt(200),
                representante: txt(1000),
              })
              .strict()
              .optional(),
            tipo: z.enum(["PF", "PJ"]),
            papelScp: z.enum(["nenhum", "ostensivo", "participante"]),
            beneficiariosScp: z.array(id).max(150),
            fundamentoScp: txt(),
            nome: txt(200),
            documento: txt(100),
            pais: txt(2),
            administrador: z.boolean(),
            controle: z.boolean(),
            fundamentoControle: txt(),
            evidenciaId: ref,
            assinatura: z.enum(["pendente", "confirmada", "nao_aplicavel"]),
            assinaturaEvidenciaId: ref,
            assinaturaJustificativa: txt(),
          })
          .strict(),
      )
      .max(150),
    vinculos: z
      .array(
        z
          .object({
            id,
            titularId: id,
            entidadeId: id,
            capital: percent,
            votos: percent,
            inicio: date,
            fim: date,
            evidenciaId: ref,
          })
          .strict(),
      )
      .max(400),
  })
  .strict();
export function novoEbef(ano = new Date().getUTCFullYear()) {
  return {
    ano,
    dataBase: "",
    natureza: "nao_informada",
    domicilio: "nao_informado",
    receitaAnterior: "",
    receitaAno: ano - 1,
    evidenciaReceitaId: "",
    socioPJ: "nao_confirmado",
    evidenciaEnquadramentoId: "",
    enquadramentoConferido: false,
    matrizConferida: false,
    evento: "anual",
    dataEvento: "",
    evidenciaEventoId: "",
    prazoInterno: "",
    responsavel: "",
    observacoes: "",
    cadeiaConferida: false,
    controleConferido: false,
    pessoas: [],
    vinculos: [],
  };
}
// Seis casas por vínculo; a multiplicação/soma usa frações BigInt, nunca floats.
const SCALE = 1000000n;
function decimalInt(s) {
  const [a, b = ""] = s.split(".");
  return BigInt(a || "0") * SCALE + BigInt(b.padEnd(6, "0"));
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function frac(n, d) {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
function add(a, b) {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}
function mul(a, s) {
  return frac(a.n * decimalInt(s), a.d * 100n * SCALE);
}
function show(a) {
  const scaled = (a.n * 100n * 100000000n) / a.d;
  return `${scaled / 100000000n}.${String(scaled % 100000000n).padStart(8, "0")}`;
}
export function documentoValido(tipo, value, pais) {
  if (pais !== "BR") return /^[A-Z]{2}$/.test(pais) && value.trim().length >= 3;
  const s = value.replace(/[.\/\-\s]/g, "");
  if (tipo === "PF") {
    if (!/^\d{11}$/.test(s) || /^(\d)\1+$/.test(s)) return false;
    for (let k = 9; k < 11; k++) {
      let n = 0;
      for (let i = 0; i < k; i++) n += Number(s[i]) * (k + 1 - i);
      const d = (n * 10) % 11;
      if (Number(s[k]) !== (d === 10 ? 0 : d)) return false;
    }
    return true;
  }
  // CNPJ numérico e alfanumérico: pesos e conversão ASCII-48 oficiais.
  if (!/^[A-Z0-9]{12}\d{2}$/.test(s) || /^(\d)\1+$/.test(s)) return false;
  for (let k = 12; k < 14; k++) {
    let n = 0;
    for (let i = 0; i < k; i++)
      n += (s.charCodeAt(i) - 48) * (((k - i - 1) % 8) + 2);
    const r = n % 11;
    if (Number(s[k]) !== (r < 2 ? 0 : 11 - r)) return false;
  }
  return true;
}
export function analisarEbef(input, documentos = []) {
  const d = ebefSchema.parse(input);
  const pendencias = [];
  const docs = new Set(documentos.map((x) => x.id));
  const evidence = (value, label) => {
    if (!docs.has(value)) pendencias.push(label);
  };
  let enquadramento = "inconclusivo",
    motivo = "Informe os dados e revise o enquadramento.",
    inicioObrigacao = null,
    prazoLegal = null;
  if (d.domicilio === "BR") {
    if (["slu", "empresario_individual"].includes(d.natureza)) {
      enquadramento = "dispensada";
      motivo =
        "Dispensa pela natureza jurídica, sujeita à conferência documental (art. 54).";
    } else if (d.natureza === "scp") {
      enquadramento = "obrigada";
      inicioObrigacao = "2026-01-01";
      motivo =
        "SCP: sócios ostensivos e participantes independentemente da participação (art. 53, § 4º). Sócios PJ exigem identificação documental das pessoas físicas finais.";
    } else if (d.natureza === "sa_fechada") {
      enquadramento = "obrigada";
      inicioObrigacao = "2026-01-01";
      motivo =
        "Sociedade anônima fechada: regra geral desde 2026, após conferência de eventuais dispensas.";
    } else if (["ltda", "simples"].includes(d.natureza)) {
      if (d.natureza === "ltda" && d.socioPJ === "sim") {
        enquadramento = "obrigada";
        inicioObrigacao = "2026-01-01";
        motivo =
          "Ltda. com PJ no QSA: fora do faseamento (art. 55-G, parágrafo único).";
      } else if (
        d.socioPJ === "nao" &&
        d.receitaAnterior !== "" &&
        d.receitaAno === d.ano - 1
      ) {
        const r = decimalInt(d.receitaAnterior);
        if (r <= 4800000n * SCALE) {
          enquadramento = "dispensada";
          motivo =
            "Receita anterior até R$ 4,8 milhões e ausência de PJ no QSA (art. 54).";
        } else {
          inicioObrigacao = r > 78000000n * SCALE ? "2027-01-01" : "2028-01-01";
          enquadramento =
            d.ano < Number(inicioObrigacao.slice(0, 4)) ? "futura" : "obrigada";
          motivo =
            "Faseamento conforme receita do ano anterior e QSA (Anexo XVI). A receita será reavaliada a cada exercício.";
        }
      } else {
        motivo =
          "Confirme o QSA e a receita do ano anterior. Sociedade simples com PJ requer análise específica.";
      }
    } else
      motivo =
        "Natureza jurídica exige análise específica; não há conclusão automática nesta versão.";
  } else
    motivo =
      "Confirme o domicílio. Entidades do exterior exigem análise específica.";
  evidence(
    d.evidenciaEnquadramentoId,
    "Anexar documento do enquadramento e QSA.",
  );
  if (!d.matrizConferida)
    pendencias.push(
      "Conferir a condição de matriz no comprovante cadastral; o número do estabelecimento não substitui essa conferência.",
    );
  if (!d.enquadramentoConferido)
    pendencias.push("Revisar dispensas e enquadramento com os documentos.");
  if (
    ["ltda", "simples"].includes(d.natureza) &&
    !(d.natureza === "ltda" && d.socioPJ === "sim")
  ) {
    if (d.receitaAnterior === "" || d.receitaAno !== d.ano - 1)
      pendencias.push(
        "Informar receita comprovada do ano imediatamente anterior.",
      );
    evidence(d.evidenciaReceitaId, "Anexar comprovação da receita anterior.");
  }
  if (enquadramento === "inconclusivo") pendencias.push(motivo);
  if (!d.responsavel.trim())
    pendencias.push("Definir responsável pelo atendimento.");
  if (enquadramento === "obrigada") {
    if (d.evento === "anual") prazoLegal = `${d.ano}-12-31`;
    else if (!d.dataEvento || !d.dataEvento.startsWith(`${d.ano}-`))
      pendencias.push("Informar a data comprovada do evento no exercício.");
    else {
      const t = new Date(d.dataEvento + "T12:00:00Z");
      t.setUTCDate(t.getUTCDate() + 30);
      prazoLegal = t.toISOString().slice(0, 10);
      evidence(
        d.evidenciaEventoId,
        "Anexar documento que comprove o evento do prazo.",
      );
    }
  }
  if (
    d.socioPJ === "nao" &&
    d.vinculos.some(
      (v) =>
        v.entidadeId === "matriz" &&
        d.pessoas.some((p) => p.id === v.titularId && p.tipo === "PJ"),
    )
  )
    pendencias.push("QSA informado sem PJ diverge da estrutura cadastrada.");
  if (d.prazoInterno && prazoLegal && d.prazoInterno > prazoLegal)
    pendencias.push("Prazo interno não pode ultrapassar o prazo legal.");
  const beneficiarios = [];
  if (!["obrigada", "futura"].includes(enquadramento))
    return {
      regra: EBEF_REGRA,
      enquadramento,
      motivo,
      inicioObrigacao,
      prazoLegal,
      pendencias: [...new Set(pendencias)],
      beneficiarios,
      fonte: EBEF_FONTE,
    };
  if (
    d.evento !== "anual" &&
    d.dataEvento &&
    d.dataBase &&
    d.dataBase < d.dataEvento
  )
    pendencias.push("Data-base não pode anteceder o evento analisado.");
  if (!d.dataBase || !d.dataBase.startsWith(`${d.ano}-`))
    pendencias.push("Definir data-base válida no exercício.");
  if (!d.cadeiaConferida)
    pendencias.push("Conferir a completude da cadeia societária.");
  if (!d.controleConferido)
    pendencias.push(
      "Revisar direitos de voto, controle e transações em nome de pessoa física.",
    );
  const pessoas = new Map();
  const identidades = new Set();
  for (const p of d.pessoas) {
    if (pessoas.has(p.id) || p.id === "matriz")
      pendencias.push("Identificador de participante duplicado ou reservado.");
    pessoas.set(p.id, p);
    const key =
      p.pais + ":" + p.documento.replace(/[.\/\-\s]/g, "").toUpperCase();
    if (identidades.has(key))
      pendencias.push(
        "Documento de participante duplicado: consolide os vínculos da mesma pessoa.",
      );
    identidades.add(key);
    if (p.tipo === "PF" && p.pais !== "BR") {
      const x = p.exterior;
      if (
        !x ||
        !x.nascimento ||
        x.nascimento > d.dataBase ||
        !x.naturalidade.trim() ||
        !/^([A-Z]{2})$/.test(x.residenciaFiscal) ||
        !x.nif.trim() ||
        !x.endereco.trim() ||
        !/^\S+@\S+\.\S+$/.test(x.email)
      )
        pendencias.push(
          `Completar identificação, nascimento, residência fiscal, NIF, endereço e contato do estrangeiro: ${p.nome}.`,
        );
    }
    if (!p.nome.trim() || !documentoValido(p.tipo, p.documento, p.pais))
      pendencias.push(
        `Identificação incompleta ou inválida: ${p.nome || p.id}.`,
      );
    evidence(
      p.evidenciaId,
      `Anexar evidência da identificação/condição: ${p.nome || p.id}.`,
    );
    if (p.controle && !p.fundamentoControle.trim())
      pendencias.push(`Fundamentar o controle: ${p.nome || p.id}.`);
  }
  const ativos = [];
  const ids = new Set();
  const pairs = new Set();
  for (const v of d.vinculos) {
    if (ids.has(v.id)) pendencias.push("Vínculo duplicado.");
    ids.add(v.id);
    if (!v.inicio || (v.fim && v.fim < v.inicio)) {
      pendencias.push("Revisar as datas dos vínculos.");
      continue;
    }
    if (v.fim && v.fim.startsWith(`${d.ano}-`) && v.fim < d.dataBase)
      pendencias.push(
        "Há vínculo encerrado no exercício: prepare a versão na data do evento e comprove seu tratamento antes da análise anual.",
      );
    if (v.inicio > d.dataBase || (v.fim && v.fim < d.dataBase)) continue;
    const titular = pessoas.get(v.titularId),
      entidade = pessoas.get(v.entidadeId);
    if (!titular || (v.entidadeId !== "matriz" && entidade?.tipo !== "PJ")) {
      pendencias.push(
        "Vínculo aponta para participante inexistente ou pessoa física como sociedade.",
      );
      continue;
    }
    if (
      !(d.natureza === "scp" && v.entidadeId === "matriz") &&
      (v.capital === "" || v.votos === "")
    )
      pendencias.push(
        "Informar capital e direitos de voto em todos os vínculos ativos.",
      );
    evidence(
      v.evidenciaId,
      "Anexar instrumento societário de cada vínculo ativo.",
    );
    const pair = v.titularId + ":" + v.entidadeId;
    if (pairs.has(pair))
      pendencias.push(
        "Vínculos simultâneos repetidos: consolide por titular e entidade.",
      );
    pairs.add(pair);
    ativos.push(v);
  }
  const totals = new Map(),
    reached = new Set();
  let steps = 0;
  function walk(entity, weight, path, seen, conhecido = true) {
    if (++steps > 5000) {
      throw new Error(
        "Estrutura excede o limite de caminhos; requer análise específica.",
      );
    }
    if (seen.has(entity) || seen.size > 30) {
      pendencias.push(
        "Cadeia circular ou profunda: análise específica obrigatória.",
      );
      return;
    }
    const next = new Set(seen);
    next.add(entity);
    const edges = ativos.filter((v) => v.entidadeId === entity);
    if (!edges.length) {
      pendencias.push(
        `Cadeia incompleta em ${entity === "matriz" ? "empresa declarante" : pessoas.get(entity)?.nome || entity}.`,
      );
      return;
    }
    for (const field of ["capital", "votos"])
      if (
        !(d.natureza === "scp" && entity === "matriz") &&
        edges.reduce((a, v) => a + decimalInt(v[field]), 0n) !== 100n * SCALE
      )
        pendencias.push(
          `Percentuais de ${field} não fecham 100% em ${entity === "matriz" ? "empresa declarante" : pessoas.get(entity)?.nome || entity}.`,
        );
    for (const v of edges) {
      const p = pessoas.get(v.titularId);
      reached.add(p.id);
      const w = mul(weight, v.capital);
      const route = [
        ...path,
        `${p.nome} (${v.capital === "" ? "participação não quantificada" : v.capital + "%"})`,
      ];
      if (p.tipo === "PJ")
        walk(p.id, w, route, next, conhecido && v.capital !== "");
      else {
        const t = totals.get(p.id) || {
          value: { n: 0n, d: 1n },
          caminhos: [],
          directVotes: false,
        };
        t.incompleto = t.incompleto || !conhecido || v.capital === "";
        t.value = add(t.value, w);
        t.caminhos.push(route.join(" ← "));
        if (entity === "matriz" && decimalInt(v.votos) > 25n * SCALE)
          t.directVotes = true;
        totals.set(p.id, t);
      }
    }
  }
  try {
    walk("matriz", { n: 1n, d: 1n }, [], new Set());
  } catch (e) {
    pendencias.push(e.message);
  }
  // Voto indireto não é multiplicado como capital: requer análise de controle documentada.
  for (const p of d.pessoas.filter((p) => p.tipo === "PF")) {
    const t = totals.get(p.id);
    const criterios = [];
    if (t && !t.incompleto && t.value.n * 4n > t.value.d)
      criterios.push("Capital superior a 25%");
    if (t?.directVotes)
      criterios.push("Direitos de voto diretos superiores a 25%");
    if (p.controle)
      criterios.push(
        "Controle/influência ou transação em seu nome, documentados",
      );
    if (
      d.natureza === "scp" &&
      p.papelScp !== "nenhum" &&
      ativos.some((v) => v.entidadeId === "matriz" && v.titularId === p.id)
    )
      criterios.push(`Sócio ${p.papelScp} da SCP — independente do percentual`);
    if (d.natureza === "scp")
      for (const pj of d.pessoas.filter(
        (x) =>
          x.tipo === "PJ" &&
          x.papelScp !== "nenhum" &&
          x.beneficiariosScp.includes(p.id),
      ))
        criterios.push(
          `Pessoa física final do sócio ${pj.nome}, por análise documental`,
        );
    if (d.natureza === "scp")
      for (const pj of d.pessoas.filter(
        (x) => x.tipo === "PJ" && x.beneficiariosScp.includes(p.id),
      )) {
        if (
          !ativos.some(
            (v) => v.entidadeId === "matriz" && v.titularId === pj.id,
          )
        )
          pendencias.push(
            `Sócio PJ da SCP sem vínculo ativo com a matriz: ${pj.nome}.`,
          );
      }
    if (criterios.length)
      beneficiarios.push({
        id: p.id,
        nome: p.nome,
        percentual: t?.incompleto
          ? "não quantificado"
          : show(t?.value || { n: 0n, d: 1n }),
        caminhos: t?.caminhos || [],
        criterios,
      });
    if (!reached.has(p.id) && !p.controle && !p.administrador)
      pendencias.push(`Participante sem vínculo ou condição: ${p.nome}.`);
  }
  if (d.natureza === "scp") {
    const socios = ativos
      .filter((v) => v.entidadeId === "matriz")
      .map((v) => pessoas.get(v.titularId));
    if (!socios.some((p) => p.papelScp === "ostensivo"))
      pendencias.push("Identificar o sócio ostensivo da SCP.");
    if (!socios.some((p) => p.papelScp === "participante"))
      pendencias.push(
        "Identificar os sócios participantes da SCP, inclusive os não expostos no QSA público.",
      );
    for (const p of socios) {
      if (p.papelScp === "nenhum")
        pendencias.push(`Definir a condição do sócio da SCP: ${p.nome}.`);
      if (
        p.tipo === "PJ" &&
        (!p.beneficiariosScp.length ||
          !p.fundamentoScp.trim() ||
          p.beneficiariosScp.some((x) => pessoas.get(x)?.tipo !== "PF"))
      )
        pendencias.push(
          `Identificar e fundamentar as pessoas físicas finais do sócio PJ da SCP: ${p.nome}.`,
        );
    }
  }
  if (
    !beneficiarios.length &&
    d.natureza !== "scp" &&
    d.controleConferido &&
    d.cadeiaConferida &&
    !pendencias.length
  ) {
    for (const p of d.pessoas.filter((p) => p.tipo === "PF" && p.administrador))
      beneficiarios.push({
        id: p.id,
        nome: p.nome,
        percentual: show(totals.get(p.id)?.value || { n: 0n, d: 1n }),
        caminhos: totals.get(p.id)?.caminhos || [],
        criterios: [
          "Administrador efetivo: hipótese subsidiária (art. 54, § 4º)",
        ],
      });
  }
  if (!beneficiarios.length)
    pendencias.push(
      "Identificar beneficiários ou administradores efetivos após análise completa.",
    );
  return {
    regra: EBEF_REGRA,
    enquadramento,
    motivo,
    inicioObrigacao,
    prazoLegal,
    pendencias: [...new Set(pendencias)],
    beneficiarios,
    fonte: EBEF_FONTE,
  };
}
export function validarAcaoEbef(record, action, role) {
  const a = analisarEbef(record.draft, record.documentos);
  const deny = (msg) => {
    throw Object.assign(new Error(msg), { status: 422 });
  };
  if (action === "reabrir") {
    if (
      ["concluido", "dispensa_revisada"].includes(record.status) &&
      role !== "admin"
    )
      throw Object.assign(
        new Error("Reabrir dossiê concluído exige administrador."),
        { status: 403 },
      );
    return "rascunho";
  }
  if (action === "revisar") {
    if (record.status !== "rascunho")
      deny("Somente rascunho pode ser enviado à revisão.");
    if (a.pendencias.length || a.enquadramento === "futura")
      deny("Resolva as pendências e confira a vigência antes da revisão.");
    return "em_revisao";
  }
  if (action === "aprovar") {
    if (role !== "admin")
      throw Object.assign(new Error("A revisão final exige administrador."), {
        status: 403,
      });
    if (record.status !== "em_revisao" || a.pendencias.length)
      deny("Aprovação exige revisão sem pendências.");
    return a.enquadramento === "dispensada" ? "dispensa_revisada" : "aprovado";
  }
  if (action === "entregar") {
    if (record.status !== "aprovado" || a.pendencias.length)
      deny("Registre a entrega somente após aprovação válida.");
    return "entrega_registrada";
  }
  if (action === "concluir") {
    if (role !== "admin")
      throw Object.assign(new Error("A conclusão exige administrador."), {
        status: 403,
      });
    if (
      record.status !== "entrega_registrada" ||
      a.pendencias.length ||
      !record.entrega
    )
      deny("Faltam aprovação válida e comprovante de entrega.");
    for (const b of a.beneficiarios) {
      const p = record.draft.pessoas.find((p) => p.id === b.id);
      if (
        p.assinatura === "pendente" ||
        !record.documentos.some((x) => x.id === p.assinaturaEvidenciaId) ||
        (p.assinatura === "nao_aplicavel" && !p.assinaturaJustificativa.trim())
      )
        deny(`Comprovar confirmação ou exceção fundamentada: ${b.nome}.`);
    }
    return "concluido";
  }
  deny("Ação desconhecida.");
}

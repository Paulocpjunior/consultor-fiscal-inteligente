import React, { useEffect, useRef, useState } from "react";
import { useEmpresaAtiva } from "../../services/empresaAtivaContext";
import { analisarEbef } from "../../sefaz-backend/ebef-core.js";
import type {
  EbefContext,
  EbefDraft,
  EbefRecord,
  EbefHistorico,
  EbefPessoa,
  EbefExterior,
} from "../../services/ebefTypes";
import {
  carregarEbef,
  comandarEbef,
  anexarEbef,
  historicoEbef,
  versaoEbef,
  baixarDocumentoEbef,
} from "../../services/ebefService";
import { imprimirEbef } from "../../services/ebefRelatorio";
import type { User } from "../../types";
const STATUS: Record<string, string> = {
  rascunho: "Em preparação",
  em_revisao: "Em revisão",
  aprovado: "Aprovado para entrega",
  entrega_registrada: "Entrega registrada · acompanhar confirmações",
  concluido: "Concluído",
  dispensa_revisada: "Dispensa revisada",
};
const ABAS = [
  "Resumo",
  "Enquadramento",
  "Estrutura societária",
  "Documentos",
  "Preparação e entrega",
  "Histórico",
];
const ic =
  "w-full rounded border px-3 py-2 text-sm bg-white text-slate-900 border-slate-300 disabled:bg-slate-100";
const bc =
  "px-3 py-2 rounded bg-blue-700 text-white text-sm font-semibold disabled:opacity-40";
function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium space-y-1">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Workspace({
  context,
  currentUser,
}: {
  context: EbefContext;
  currentUser: User;
}) {
  const [ano, setAno] = useState(new Date().getFullYear()),
    [record, setRecord] = useState<EbefRecord | null>(null),
    [draft, setDraft] = useState<EbefDraft | null>(null),
    [aba, setAba] = useState(0),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [erro, setErro] = useState(""),
    [msg, setMsg] = useState(""),
    [history, setHistory] = useState<EbefHistorico[]>([]),
    [snapshot, setSnapshot] = useState<EbefRecord | null>(null);
  const [protocolo, setProtocolo] = useState(""),
    [dataEntrega, setDataEntrega] = useState(""),
    [docEntrega, setDocEntrega] = useState("");
  const [confirmacao, setConfirmacao] = useState({
    pessoaId: "",
    assinatura: "confirmada",
    documentoId: "",
    justificativa: "",
  });
  const alive = useRef(true),
    seq = useRef(0),
    locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current++;
    };
  }, []);
  const apply = (r: EbefRecord) => {
    setRecord(r);
    setDraft(r.draft);
    setDirty(false);
  };
  const load = async () => {
    const s = ++seq.current;
    setBusy(true);
    setErro("");
    setRecord(null);
    setDraft(null);
    try {
      const r = await carregarEbef(context, ano);
      if (alive.current && s === seq.current) apply(r);
    } catch (e) {
      if (alive.current && s === seq.current) setErro((e as Error).message);
    } finally {
      if (alive.current && s === seq.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    setSnapshot(null);
    setHistory([]);
    setProtocolo("");
    setDataEntrega("");
    setDocEntrega("");
  }, [ano]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const operation = async (fn: () => Promise<void>) => {
    if (locked.current || busy) return;
    locked.current = true;
    setBusy(true);
    setErro("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setErro((e as Error).message);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const change = <K extends keyof EbefDraft>(key: K, value: EbefDraft[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
    setDirty(true);
    setMsg("");
  };
  const command = async (
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!record) return;
    const r = await comandarEbef(context, ano, {
      revision: record.revision,
      action,
      ...extra,
    });
    if (alive.current) {
      apply(r);
      setMsg("Operação salva no servidor.");
    }
  };
  const evidence = (value: string, onChange: (v: string) => void) => (
    <select
      className={ic}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Selecione o documento</option>
      {record?.documentos.map((d) => (
        <option key={d.id} value={d.id}>
          {d.nome}
        </option>
      ))}
    </select>
  );
  const personChange = (id: string, patch: Partial<EbefPessoa>) => {
    if (draft)
      change(
        "pessoas",
        draft.pessoas.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
  };
  const analysis = (() => {
    try {
      return draft ? analisarEbef(draft, record?.documentos) : null;
    } catch {
      return null;
    }
  })();
  const editable =
    !!record && ["rascunho", "em_revisao"].includes(record.status);
  function exportar(r: EbefRecord) {
    const a = document.createElement("a");
    const u = URL.createObjectURL(
      new Blob([JSON.stringify({ empresa: context, ...r }, null, 2)], {
        type: "application/json",
      }),
    );
    a.href = u;
    a.download = `ebef-${context.cnpj.replace(/\W/g, "")}-${ano}-v${r.revision}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  return (
    <section className="space-y-5" aria-label="Beneficiários finais e-BEF">
      <header
        className="rounded-xl border p-5"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border-default)",
        }}
      >
        <h2 className="text-xl font-bold">Beneficiários finais · e-BEF</h2>
        <p className="mt-1">
          {context.nome} · {context.cnpj}
        </p>
        <p className="text-sm mt-2">
          Dossiê societário, revisão e acompanhamento da obrigação.
        </p>
        <div className="flex flex-wrap gap-3 mt-4 items-end">
          <Campo label="Exercício">
            <input
              className={ic}
              type="number"
              min="2026"
              max="2100"
              value={ano}
              disabled={busy || dirty}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 2026 && n <= 2100) setAno(n);
              }}
            />
          </Campo>
          <button
            className={bc}
            disabled={busy || !dirty || !editable}
            onClick={() => void operation(() => command("salvar", { draft }))}
          >
            Salvar alterações
          </button>
          <button
            className={bc}
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "Descartar alterações não salvas e carregar a versão do servidor?",
                )
              )
                void load();
            }}
          >
            Recarregar
          </button>
          <span className="text-sm" role="status">
            {busy
              ? "Processando…"
              : dirty
                ? "Alterações não salvas — salve antes de trocar de empresa."
                : record
                  ? `Versão ${record.revision} · ${STATUS[record.status]}`
                  : ""}
          </span>
        </div>
      </header>
      {erro && (
        <div
          role="alert"
          className="p-4 rounded bg-red-50 border border-red-300 text-red-900"
        >
          {erro}
        </div>
      )}
      {msg && (
        <p role="status" className="p-3 rounded bg-green-50 text-green-900">
          {msg}
        </p>
      )}
      <nav className="flex flex-wrap gap-2" aria-label="Etapas do dossiê">
        {ABAS.map((a, i) => (
          <button
            key={a}
            disabled={busy}
            className={`px-3 py-2 rounded text-sm ${aba === i ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-800"}`}
            onClick={() => {
              setAba(i);
              if (i === 5)
                void operation(async () => {
                  const h = await historicoEbef(context, ano);
                  if (alive.current) setHistory(h);
                });
            }}
          >
            {a}
          </button>
        ))}
      </nav>
      {record && draft && (
        <>
          {aba === 0 && analysis && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                {[
                  ["Enquadramento", analysis.enquadramento],
                  [
                    "Prazo legal",
                    analysis.prazoLegal || "Sem prazo confirmado",
                  ],
                  ["Responsável", draft.responsavel || "Definir responsável"],
                ].map(([k, v]) => (
                  <div key={k} className="border rounded p-4">
                    <div className="text-sm">{k}</div>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <p>{analysis.motivo}</p>
              {analysis.inicioObrigacao && (
                <p>
                  Início da exigência indicado: {analysis.inicioObrigacao}.
                  Reavaliar os dados a cada exercício.
                </p>
              )}
              <h3 className="font-bold">Próximas ações</h3>
              {analysis.pendencias.length ? (
                <ul className="list-disc pl-6 space-y-1">
                  {analysis.pendencias.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  Dados sem pendências automáticas. A revisão documental
                  permanece obrigatória.
                </p>
              )}
              <p className="text-sm">
                Prazo interno: {draft.prazoInterno || "não definido"} · Regra{" "}
                {analysis.regra}
              </p>
              <a
                className="text-blue-600 underline"
                href={analysis.fonte}
                target="_blank"
                rel="noopener noreferrer"
              >
                Manual oficial da Receita
              </a>
              <p className="text-sm">
                Entrega e confirmações são feitas no portal oficial, com
                comprovantes anexados aqui.
              </p>
            </div>
          )}
          {aba === 1 && (
            <fieldset
              disabled={!editable || busy}
              className="grid md:grid-cols-2 gap-4"
            >
              <Campo label="Natureza jurídica">
                <select
                  className={ic}
                  value={draft.natureza}
                  onChange={(e) =>
                    change("natureza", e.target.value as EbefDraft["natureza"])
                  }
                >
                  {Object.entries({
                    nao_informada: "Não informada",
                    ltda: "Sociedade limitada",
                    simples: "Sociedade simples",
                    scp: "Sociedade em Conta de Participação (SCP)",
                    sa_fechada: "S.A. fechada",
                    slu: "Sociedade limitada unipessoal",
                    empresario_individual: "Empresário individual / MEI",
                    outra: "Outra — análise específica",
                  }).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Domicílio da entidade">
                <select
                  className={ic}
                  value={draft.domicilio}
                  onChange={(e) =>
                    change(
                      "domicilio",
                      e.target.value as EbefDraft["domicilio"],
                    )
                  }
                >
                  <option value="nao_informado">Não confirmado</option>
                  <option value="BR">Brasil</option>
                  <option value="exterior">
                    Exterior — análise específica
                  </option>
                </select>
              </Campo>
              <Campo label="Receita anterior em R$ (sem separador de milhar)">
                <input
                  className={ic}
                  inputMode="decimal"
                  value={draft.receitaAnterior}
                  placeholder="Ex.: 300000000.00"
                  onChange={(e) =>
                    change("receitaAnterior", e.target.value.replace(",", "."))
                  }
                />
              </Campo>
              <Campo label="Ano da receita">
                <input
                  className={ic}
                  type="number"
                  value={draft.receitaAno}
                  onChange={(e) => change("receitaAno", Number(e.target.value))}
                />
              </Campo>
              <Campo label="Comprovação da receita">
                {evidence(draft.evidenciaReceitaId, (v) =>
                  change("evidenciaReceitaId", v),
                )}
              </Campo>
              <Campo label="Há pessoa jurídica no QSA?">
                <select
                  className={ic}
                  value={draft.socioPJ}
                  onChange={(e) =>
                    change("socioPJ", e.target.value as EbefDraft["socioPJ"])
                  }
                >
                  <option value="nao_confirmado">Não confirmado</option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              </Campo>
              <Campo label="Contrato/QSA do enquadramento">
                {evidence(draft.evidenciaEnquadramentoId, (v) =>
                  change("evidenciaEnquadramentoId", v),
                )}
              </Campo>
              <Campo label="Data-base da análise">
                <input
                  className={ic}
                  type="date"
                  value={draft.dataBase}
                  onChange={(e) => change("dataBase", e.target.value)}
                />
              </Campo>
              <Campo label="Motivo da apresentação">
                <select
                  className={ic}
                  value={draft.evento}
                  onChange={(e) =>
                    change("evento", e.target.value as EbefDraft["evento"])
                  }
                >
                  <option value="anual">
                    Anual — sem evento que antecipe o prazo
                  </option>
                  <option value="inscricao">Inscrição no CNPJ</option>
                  <option value="alteracao">Alteração de beneficiários</option>
                  <option value="passou_obrigada">
                    Passou à condição de obrigada
                  </option>
                </select>
              </Campo>
              {draft.evento !== "anual" && (
                <>
                  <Campo label="Data comprovada do evento">
                    <input
                      className={ic}
                      type="date"
                      value={draft.dataEvento}
                      onChange={(e) => change("dataEvento", e.target.value)}
                    />
                  </Campo>
                  <Campo label="Documento do evento">
                    {evidence(draft.evidenciaEventoId, (v) =>
                      change("evidenciaEventoId", v),
                    )}
                  </Campo>
                </>
              )}
              <Campo label="Prazo interno">
                <input
                  className={ic}
                  type="date"
                  value={draft.prazoInterno}
                  onChange={(e) => change("prazoInterno", e.target.value)}
                />
              </Campo>
              <Campo label="Responsável pelo atendimento">
                <input
                  className={ic}
                  value={draft.responsavel}
                  maxLength={200}
                  onChange={(e) => change("responsavel", e.target.value)}
                />
              </Campo>
              <Campo label="Observações e fundamento">
                <textarea
                  className={ic}
                  rows={4}
                  maxLength={5000}
                  value={draft.observacoes}
                  onChange={(e) => change("observacoes", e.target.value)}
                />
              </Campo>
              <label className="flex gap-2 items-start">
                <input
                  type="checkbox"
                  checked={draft.enquadramentoConferido}
                  onChange={(e) =>
                    change("enquadramentoConferido", e.target.checked)
                  }
                />
                Conferi natureza, QSA, dispensas e eventos que definem o prazo
                nos documentos.
              </label>
              <label className="flex gap-2 items-start">
                <input
                  type="checkbox"
                  checked={draft.matrizConferida}
                  onChange={(e) => change("matrizConferida", e.target.checked)}
                />
                Conferi no comprovante cadastral que a empresa ativa é a matriz.
              </label>
            </fieldset>
          )}
          {aba === 2 && (
            <div className="space-y-4">
              <p>
                Cadastre cada participante uma vez. Capital e direitos de voto
                são distintos. Votos indiretos exigem análise documentada de
                controle.
              </p>
              <fieldset disabled={!editable || busy} className="space-y-4">
                <button
                  className={bc}
                  onClick={() =>
                    change("pessoas", [
                      ...draft.pessoas,
                      {
                        id: crypto.randomUUID(),
                        tipo: "PF",
                        papelScp: "nenhum",
                        beneficiariosScp: [],
                        fundamentoScp: "",
                        nome: "",
                        documento: "",
                        pais: "BR",
                        administrador: false,
                        controle: false,
                        fundamentoControle: "",
                        evidenciaId: "",
                        assinatura: "pendente",
                        assinaturaEvidenciaId: "",
                        assinaturaJustificativa: "",
                      },
                    ])
                  }
                >
                  Adicionar participante
                </button>
                {draft.pessoas.map((p) => (
                  <div key={p.id} className="rounded border p-4 space-y-3">
                    <div className="grid md:grid-cols-3 gap-3">
                      <Campo label="Tipo">
                        <select
                          className={ic}
                          value={p.tipo}
                          onChange={(e) =>
                            personChange(p.id, {
                              tipo: e.target.value as "PF" | "PJ",
                            })
                          }
                        >
                          <option value="PF">Pessoa física</option>
                          <option value="PJ">Pessoa jurídica / holding</option>
                        </select>
                      </Campo>
                      <Campo label="Nome">
                        <input
                          className={ic}
                          value={p.nome}
                          maxLength={200}
                          onChange={(e) =>
                            personChange(p.id, { nome: e.target.value })
                          }
                        />
                      </Campo>
                      <Campo label="CPF / CNPJ / identificação estrangeira">
                        <input
                          className={ic}
                          value={p.documento}
                          maxLength={100}
                          onChange={(e) =>
                            personChange(p.id, {
                              documento: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </Campo>
                      <Campo label="País (2 letras)">
                        <input
                          className={ic}
                          maxLength={2}
                          value={p.pais}
                          onChange={(e) =>
                            personChange(p.id, {
                              pais: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </Campo>
                      <Campo label="Evidência da identificação e condição">
                        {evidence(p.evidenciaId, (v) =>
                          personChange(p.id, { evidenciaId: v }),
                        )}
                      </Campo>
                    </div>
                    {p.tipo === "PF" && p.pais !== "BR" && (
                      <div className="grid md:grid-cols-2 gap-3">
                        {Object.entries({
                          nascimento: "Data de nascimento",
                          naturalidade: "Naturalidade",
                          residenciaFiscal:
                            "País de residência fiscal (2 letras)",
                          nif: "Número de identificação fiscal (NIF)",
                          endereco:
                            "Endereço residencial completo, incluindo país",
                          email: "E-mail de contato",
                          representante:
                            "Representante no Brasil, se houver: nome, CPF e endereço",
                        }).map(([field, label]) => (
                          <Campo key={field} label={label}>
                            <input
                              className={ic}
                              type={field === "nascimento" ? "date" : "text"}
                              value={
                                p.exterior?.[field as keyof EbefExterior] || ""
                              }
                              onChange={(e) =>
                                personChange(p.id, {
                                  exterior: {
                                    nascimento: "",
                                    naturalidade: "",
                                    residenciaFiscal: "",
                                    nif: "",
                                    endereco: "",
                                    email: "",
                                    representante: "",
                                    ...p.exterior,
                                    [field]: e.target.value,
                                  },
                                })
                              }
                            />
                          </Campo>
                        ))}
                      </div>
                    )}
                    {draft.natureza === "scp" && (
                      <div className="space-y-3">
                        <Campo label="Condição na SCP">
                          <select
                            className={ic}
                            value={p.papelScp}
                            onChange={(e) =>
                              personChange(p.id, {
                                papelScp: e.target
                                  .value as EbefPessoa["papelScp"],
                              })
                            }
                          >
                            <option value="nenhum">
                              Não é sócio direto da SCP
                            </option>
                            <option value="ostensivo">Sócio ostensivo</option>
                            <option value="participante">
                              Sócio participante
                            </option>
                          </select>
                        </Campo>
                        {p.tipo === "PJ" && p.papelScp !== "nenhum" && (
                          <>
                            <p className="text-sm">
                              Identifique as pessoas físicas finais deste sócio
                              PJ após analisar a cadeia e o contrato da SCP.
                            </p>
                            {draft.pessoas
                              .filter((x) => x.tipo === "PF")
                              .map((pf) => (
                                <label className="block" key={pf.id}>
                                  <input
                                    type="checkbox"
                                    checked={p.beneficiariosScp.includes(pf.id)}
                                    onChange={(e) =>
                                      personChange(p.id, {
                                        beneficiariosScp: e.target.checked
                                          ? [...p.beneficiariosScp, pf.id]
                                          : p.beneficiariosScp.filter(
                                              (x) => x !== pf.id,
                                            ),
                                      })
                                    }
                                  />{" "}
                                  {pf.nome || "Pessoa sem nome"}
                                </label>
                              ))}
                            <Campo label="Fundamento e trecho do contrato da SCP">
                              <textarea
                                className={ic}
                                value={p.fundamentoScp}
                                onChange={(e) =>
                                  personChange(p.id, {
                                    fundamentoScp: e.target.value,
                                  })
                                }
                              />
                            </Campo>
                          </>
                        )}
                      </div>
                    )}
                    {p.tipo === "PF" && (
                      <>
                        <label className="block">
                          <input
                            type="checkbox"
                            checked={p.administrador}
                            onChange={(e) =>
                              personChange(p.id, {
                                administrador: e.target.checked,
                              })
                            }
                          />{" "}
                          Administrador efetivo, comprovado no instrumento
                        </label>
                        <label className="block">
                          <input
                            type="checkbox"
                            checked={p.controle}
                            onChange={(e) =>
                              personChange(p.id, { controle: e.target.checked })
                            }
                          />{" "}
                          Controle/influência significativa ou transação em seu
                          nome, documentados
                        </label>
                        {p.controle && (
                          <Campo label="Fundamento e trecho do documento">
                            <textarea
                              className={ic}
                              value={p.fundamentoControle}
                              onChange={(e) =>
                                personChange(p.id, {
                                  fundamentoControle: e.target.value,
                                })
                              }
                            />
                          </Campo>
                        )}
                      </>
                    )}
                    <button
                      className="text-red-700 text-sm underline"
                      onClick={() => {
                        if (
                          draft.vinculos.some(
                            (v) =>
                              v.titularId === p.id || v.entidadeId === p.id,
                          )
                        ) {
                          setErro(
                            "Ajuste os vínculos antes de remover este participante.",
                          );
                          return;
                        }
                        change(
                          "pessoas",
                          draft.pessoas.filter((x) => x.id !== p.id),
                        );
                      }}
                    >
                      Remover participante do rascunho
                    </button>
                  </div>
                ))}
                <h3 className="font-bold">Vínculos societários</h3>
                <button
                  className={bc}
                  disabled={!draft.pessoas.length}
                  onClick={() =>
                    change("vinculos", [
                      ...draft.vinculos,
                      {
                        id: crypto.randomUUID(),
                        titularId: draft.pessoas[0]?.id || "",
                        entidadeId: "matriz",
                        capital: "",
                        votos: "",
                        inicio: "",
                        fim: "",
                        evidenciaId: "",
                      },
                    ])
                  }
                >
                  Adicionar vínculo
                </button>
                {draft.vinculos.map((v) => (
                  <div
                    key={v.id}
                    className="rounded border p-4 grid md:grid-cols-3 gap-3"
                  >
                    {(["titularId", "entidadeId"] as const).map((field) => (
                      <Campo
                        key={field}
                        label={
                          field === "titularId"
                            ? "Titular da participação"
                            : "Participação em qual empresa?"
                        }
                      >
                        <select
                          className={ic}
                          value={v[field]}
                          onChange={(e) =>
                            change(
                              "vinculos",
                              draft.vinculos.map((x) =>
                                x.id === v.id
                                  ? { ...x, [field]: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        >
                          {field === "entidadeId" && (
                            <option value="matriz">Empresa declarante</option>
                          )}
                          {draft.pessoas
                            .filter(
                              (p) => field === "titularId" || p.tipo === "PJ",
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nome || "Participante sem nome"}
                              </option>
                            ))}
                        </select>
                      </Campo>
                    ))}
                    {(["capital", "votos", "inicio", "fim"] as const).map(
                      (field) => (
                        <Campo
                          key={field}
                          label={
                            {
                              capital: "Capital (%)",
                              votos: "Direitos de voto (%)",
                              inicio: "Início comprovado",
                              fim: "Fim (vazio se vigente)",
                            }[field]
                          }
                        >
                          <input
                            className={ic}
                            type={
                              field === "inicio" || field === "fim"
                                ? "date"
                                : "text"
                            }
                            value={v[field]}
                            onChange={(e) =>
                              change(
                                "vinculos",
                                draft.vinculos.map((x) =>
                                  x.id === v.id
                                    ? {
                                        ...x,
                                        [field]: e.target.value.replace(
                                          ",",
                                          ".",
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </Campo>
                      ),
                    )}
                    <Campo label="Instrumento societário">
                      {evidence(v.evidenciaId, (value) =>
                        change(
                          "vinculos",
                          draft.vinculos.map((x) =>
                            x.id === v.id ? { ...x, evidenciaId: value } : x,
                          ),
                        ),
                      )}
                    </Campo>
                    <button
                      className="text-red-700 underline text-sm"
                      onClick={() =>
                        change(
                          "vinculos",
                          draft.vinculos.filter((x) => x.id !== v.id),
                        )
                      }
                    >
                      Remover vínculo do rascunho
                    </button>
                  </div>
                ))}
                <label className="block">
                  <input
                    type="checkbox"
                    checked={draft.cadeiaConferida}
                    onChange={(e) =>
                      change("cadeiaConferida", e.target.checked)
                    }
                  />{" "}
                  Conferi a cadeia completa na data-base.
                </label>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={draft.controleConferido}
                    onChange={(e) =>
                      change("controleConferido", e.target.checked)
                    }
                  />{" "}
                  Analisei votos diretos/indiretos, acordos, controle e
                  transações em nome de pessoas físicas.
                </label>
              </fieldset>
              <h3 className="font-bold">Indicações da análise</h3>
              {analysis?.beneficiarios.map((b) => (
                <div key={b.id} className="p-3 border rounded">
                  <strong>
                    {b.nome} · {b.percentual}
                    {b.percentual === "não quantificado" ? "" : "%"} do capital
                  </strong>
                  <p>{b.criterios.join("; ")}</p>
                  {b.caminhos.map((c, i) => (
                    <p className="text-sm" key={i}>
                      {c}
                    </p>
                  ))}
                </div>
              ))}
              {!analysis?.beneficiarios.length && (
                <p>
                  Nenhuma indicação concluída. Confira as pendências no resumo.
                </p>
              )}
            </div>
          )}
          {aba === 3 && (
            <div className="space-y-4">
              <p>
                PDF, PNG ou JPEG, até 10 MB. Documentos privados, preservados e
                vinculados ao dossiê.
              </p>
              <Campo label="Adicionar documento">
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={
                    busy ||
                    dirty ||
                    ["concluido", "dispensa_revisada"].includes(record.status)
                  }
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file)
                      void operation(async () => {
                        if (file.size > 10 * 1024 * 1024)
                          throw new Error("O arquivo excede 10 MB.");
                        const r = await anexarEbef(
                          context,
                          ano,
                          record.revision,
                          file,
                        );
                        if (alive.current) {
                          apply(r);
                          setMsg("Documento salvo no servidor.");
                        }
                      });
                  }}
                />
              </Campo>
              {dirty && <p>Salve o rascunho antes de anexar.</p>}
              {record.documentos.map((d) => (
                <div key={d.id} className="border rounded p-3">
                  <button
                    className="underline text-blue-700"
                    disabled={busy}
                    onClick={() =>
                      void operation(() =>
                        baixarDocumentoEbef(context, ano, d.id, d.nome),
                      )
                    }
                  >
                    {d.nome}
                  </button>
                  <p className="text-xs break-all">
                    {Math.ceil(d.tamanho / 1024)} KB · {d.criadoEm} · SHA-256{" "}
                    {d.sha256}
                  </p>
                </div>
              ))}
            </div>
          )}
          {aba === 4 && (
            <div className="space-y-4">
              <p>
                Revisão final e conclusão por administrador. Entrega e
                confirmações exigem comprovantes.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  className={bc}
                  disabled={
                    busy ||
                    dirty ||
                    record.status !== "rascunho" ||
                    !analysis ||
                    analysis.pendencias.length > 0 ||
                    analysis.enquadramento === "futura"
                  }
                  onClick={() => void operation(() => command("revisar"))}
                >
                  Enviar para revisão
                </button>
                <button
                  className={bc}
                  disabled={
                    busy ||
                    dirty ||
                    record.status !== "em_revisao" ||
                    currentUser.role !== "admin"
                  }
                  onClick={() => void operation(() => command("aprovar"))}
                >
                  Aprovar revisão
                </button>
                <button
                  className={bc}
                  disabled={busy || dirty || record.status === "rascunho"}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Reabrir? O histórico será preservado; aprovações, entrega e confirmações atuais serão reiniciadas.",
                      )
                    )
                      void operation(() => command("reabrir"));
                  }}
                >
                  Reabrir dossiê
                </button>
              </div>
              <a
                className="block underline text-blue-700"
                target="_blank"
                rel="noopener noreferrer"
                href="https://www.gov.br/pt-br/servicos/informar-beneficiario-final-a-receita-federal"
              >
                Serviço oficial da Receita
              </a>
              {record.status === "aprovado" && (
                <fieldset disabled={busy} className="grid md:grid-cols-2 gap-3">
                  <Campo label="Protocolo da entrega">
                    <input
                      className={ic}
                      value={protocolo}
                      onChange={(e) => setProtocolo(e.target.value)}
                    />
                  </Campo>
                  <Campo label="Data da entrega">
                    <input
                      className={ic}
                      type="date"
                      value={dataEntrega}
                      onChange={(e) => setDataEntrega(e.target.value)}
                    />
                  </Campo>
                  <Campo label="Comprovante da entrega">
                    {evidence(docEntrega, setDocEntrega)}
                  </Campo>
                  <button
                    className={bc}
                    onClick={() =>
                      void operation(() =>
                        command("entregar", {
                          protocolo,
                          data: dataEntrega,
                          documentoId: docEntrega,
                        }),
                      )
                    }
                  >
                    Registrar entrega comprovada
                  </button>
                </fieldset>
              )}
              {record.entrega && (
                <p>
                  Entrega: {record.entrega.protocolo} · {record.entrega.data}
                </p>
              )}
              {record.status === "entrega_registrada" && (
                <fieldset disabled={busy} className="grid md:grid-cols-2 gap-3">
                  <Campo label="Beneficiário">
                    <select
                      className={ic}
                      value={confirmacao.pessoaId}
                      onChange={(e) =>
                        setConfirmacao({
                          ...confirmacao,
                          pessoaId: e.target.value,
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {analysis?.beneficiarios.map((b) => (
                        <option value={b.id} key={b.id}>
                          {b.nome} ·{" "}
                          {draft.pessoas.find((p) => p.id === b.id)?.assinatura}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Confirmação">
                    <select
                      className={ic}
                      value={confirmacao.assinatura}
                      onChange={(e) =>
                        setConfirmacao({
                          ...confirmacao,
                          assinatura: e.target.value,
                        })
                      }
                    >
                      <option value="confirmada">Confirmada no portal</option>
                      <option value="nao_aplicavel">
                        Exceção para estrangeiro — fundamentar
                      </option>
                    </select>
                  </Campo>
                  <Campo label="Comprovante">
                    {evidence(confirmacao.documentoId, (v) =>
                      setConfirmacao({ ...confirmacao, documentoId: v }),
                    )}
                  </Campo>
                  <Campo label="Justificativa da exceção">
                    <textarea
                      className={ic}
                      value={confirmacao.justificativa}
                      onChange={(e) =>
                        setConfirmacao({
                          ...confirmacao,
                          justificativa: e.target.value,
                        })
                      }
                    />
                  </Campo>
                  <button
                    className={bc}
                    onClick={() =>
                      void operation(() => command("confirmar", confirmacao))
                    }
                  >
                    Registrar confirmação
                  </button>
                  <button
                    className={bc}
                    disabled={currentUser.role !== "admin"}
                    onClick={() => void operation(() => command("concluir"))}
                  >
                    Concluir após conferência
                  </button>
                </fieldset>
              )}
              <button
                className={bc}
                disabled={busy || dirty || !record.revision}
                onClick={() => {
                  try {
                    imprimirEbef(context, record);
                  } catch (e) {
                    setErro((e as Error).message);
                  }
                }}
              >
                Imprimir dossiê / salvar PDF
              </button>{" "}
              <button
                className={bc}
                disabled={busy || dirty || !record.revision}
                onClick={() => exportar(record)}
              >
                Exportar dossiê completo (JSON)
              </button>
            </div>
          )}
          {aba === 5 && (
            <div className="space-y-3">
              <p>
                Últimas 100 versões. Cada versão preserva dados, documentos e
                resultado da análise.
              </p>
              {history.map((h) => (
                <div key={h.revision} className="border rounded p-3">
                  <button
                    className="underline text-blue-700"
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        const r = await versaoEbef(context, ano, h.revision);
                        if (alive.current) setSnapshot(r);
                      })
                    }
                  >
                    Versão {h.revision} · {STATUS[h.status]}
                  </button>
                  <p className="text-sm">
                    {h.atualizadoEm} · {h.acao} · responsável {h.atualizadoPor}
                  </p>
                </div>
              ))}
              {snapshot && (
                <div className="p-4 rounded border">
                  <h3 className="font-bold">
                    Versão {snapshot.revision} preservada
                  </h3>
                  <p>{snapshot.analise.motivo}</p>
                  <p>
                    {snapshot.analise.beneficiarios
                      .map((b) => b.nome)
                      .join(", ") ||
                      "Sem beneficiários indicados nesta versão."}
                  </p>
                  <button className={bc} onClick={() => exportar(snapshot)}>
                    Exportar esta versão
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {draft && !analysis && (
        <p role="alert" className="text-red-700">
          Revise os valores: percentuais de 0 a 100, números sem separador de
          milhar e datas válidas. Os campos continuam disponíveis para correção.
        </p>
      )}
    </section>
  );
}
export default function EbefModule({ currentUser }: { currentUser: User }) {
  const { empresa } = useEmpresaAtiva();
  if (!empresa) return <p>Ative a empresa matriz para iniciar o dossiê.</p>;
  return (
    <Workspace
      key={`${empresa.fonte}:${empresa.id}`}
      context={{
        empresaId: empresa.id,
        fonte: empresa.fonte,
        cnpj: empresa.cnpj,
        nome: empresa.nome,
      }}
      currentUser={currentUser}
    />
  );
}

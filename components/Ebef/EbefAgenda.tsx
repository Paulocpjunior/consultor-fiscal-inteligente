import React, { useEffect, useState } from "react";
import { agendaEbef, type EbefAgendaItem } from "../../services/ebefService";
export default function EbefAgenda() {
  const [items, setItems] = useState<EbefAgendaItem[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    agendaEbef()
      .then((d) => {
        if (alive) setItems(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (loading) return <p>Carregando dossiês e-BEF da carteira…</p>;
  if (error)
    return (
      <p role="alert">Não foi possível consultar a agenda e-BEF: {error}</p>
    );
  return (
    <section className="space-y-3">
      <h3 className="font-bold">Acompanhamento e-BEF da carteira</h3>
      <p className="text-sm">
        Dossiês registrados no módulo Beneficiários finais. Ausência de dossiê
        não comprova dispensa.
      </p>
      {!items.length && <p>Nenhum dossiê registrado na sua carteira.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                "Empresa",
                "Exercício",
                "Situação",
                "Prazo legal",
                "Prazo interno",
                "Responsável",
                "Pendências",
              ].map((t) => (
                <th className="p-2 text-left border-b" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...items]
              .sort((a, b) =>
                (a.prazoLegal || "9999").localeCompare(b.prazoLegal || "9999"),
              )
              .map((i) => (
                <tr key={`${i.fonte}:${i.empresaId}:${i.ano}`}>
                  {[
                    i.nome,
                    i.ano,
                    i.status.replaceAll("_", " "),
                    i.prazoLegal || "A confirmar",
                    i.prazoInterno || "Não definido",
                    i.responsavel || "Não definido",
                    i.pendencias,
                  ].map((v, k) => (
                    <td className="p-2 border-b" key={k}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

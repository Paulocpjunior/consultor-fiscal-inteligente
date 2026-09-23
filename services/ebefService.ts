import { getAuth } from "firebase/auth";
import type {
  EbefContext,
  EbefRecord,
  EbefHistorico,
  EbefStatus,
} from "./ebefTypes";
export interface EbefAgendaItem extends EbefContext {
  ano: number;
  status: EbefStatus;
  prazoLegal: string | null;
  prazoInterno: string;
  responsavel: string;
  pendencias: number;
}
const url = (c: EbefContext, ano: number, suffix = "") =>
  `/api/admin/ebef${suffix}?${new URLSearchParams({ empresaId: c.empresaId, fonte: c.fonte, cnpj: c.cnpj.replace(/[.\/\-\s]/g, "").toUpperCase(), ano: String(ano) })}`;
async function request(
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  const res = await fetch(endpoint, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(
      d.error || `Falha no atendimento e-BEF (HTTP ${res.status}).`,
    );
  }
  return res;
}
export async function carregarEbef(
  c: EbefContext,
  ano: number,
): Promise<EbefRecord> {
  return (await (await request(url(c, ano))).json()).record;
}
export async function comandarEbef(
  c: EbefContext,
  ano: number,
  command: Record<string, unknown>,
): Promise<EbefRecord> {
  return (
    await (
      await request(url(c, ano), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      })
    ).json()
  ).record;
}
export async function anexarEbef(
  c: EbefContext,
  ano: number,
  revision: number,
  file: File,
): Promise<EbefRecord> {
  const form = new FormData();
  form.append("arquivo", file);
  return (
    await (
      await request(url(c, ano, "/documentos"), {
        method: "POST",
        headers: { "If-Match": String(revision) },
        body: form,
      })
    ).json()
  ).record;
}
export async function historicoEbef(
  c: EbefContext,
  ano: number,
): Promise<EbefHistorico[]> {
  return (await (await request(url(c, ano, "/historico"))).json()).items;
}
export async function versaoEbef(
  c: EbefContext,
  ano: number,
  revision: number,
): Promise<EbefRecord> {
  return (await (await request(url(c, ano, `/versao/${revision}`))).json())
    .record;
}
export async function agendaEbef(): Promise<EbefAgendaItem[]> {
  return (await (await request("/api/admin/ebef/agenda")).json()).items;
}
export async function baixarDocumentoEbef(
  c: EbefContext,
  ano: number,
  id: string,
  nome: string,
): Promise<void> {
  const blob = await (
    await request(url(c, ano, `/documentos/${encodeURIComponent(id)}`))
  ).blob();
  const u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

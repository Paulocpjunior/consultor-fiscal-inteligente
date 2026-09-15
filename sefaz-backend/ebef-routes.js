// Dados e documentos e-BEF são exclusivos deste módulo. Nenhuma escrita no cadastro fiscal.
import { Router } from "express";
import admin from "firebase-admin";
import multer from "multer";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "./require-admin.js";
import {
  podeAcessarEmpresaId,
  getEmpresaIdsDaCarteira,
} from "./carteira-auth.js";
import {
  novoEbef,
  analisarEbef,
  ebefSchema,
  validarAcaoEbef,
} from "./ebef-core.js";

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const contextSchema = z.object({
  empresaId: key,
  fonte: z.enum(["simples", "lucro"]),
  cnpj: z.string().regex(/^[A-Z0-9]{12}\d{2}$/),
  ano: z.coerce.number().int().min(2026).max(2100),
});
const commandSchema = z
  .object({
    revision: z.number().int().min(0),
    action: z.enum([
      "salvar",
      "revisar",
      "aprovar",
      "reabrir",
      "entregar",
      "concluir",
      "confirmar",
    ]),
    draft: ebefSchema.optional(),
    protocolo: z.string().trim().min(1).max(200).optional(),
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    documentoId: key.optional(),
    pessoaId: key.optional(),
    assinatura: z.enum(["confirmada", "nao_aplicavel"]).optional(),
    justificativa: z.string().max(2000).optional(),
  })
  .strict();
const error = (status, message) =>
  Object.assign(new Error(message), { status });
const dbDefault = () => {
  if (!admin.apps.length)
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
};
const bucketDefault = () =>
  admin
    .storage()
    .bucket(
      process.env.STORAGE_BUCKET ||
        `${process.env.GCP_PROJECT_ID || "consultorfiscalapp"}.firebasestorage.app`,
    );
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
});
const clock = () => new Date().toISOString();
export function createEbefRouter(deps = {}) {
  const router = Router(),
    db = deps.db || dbDefault,
    bucket = deps.bucket || bucketDefault,
    auth = deps.auth || requireAuth,
    access = deps.access || podeAcessarEmpresaId;
  router.use(auth, (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/agenda", async (req, res, next) => {
    try {
      const ids = await (deps.carteira || getEmpresaIdsDaCarteira)(req.user);
      const docs = [];
      if (ids === null) {
        const s = await db().collection("ebef_dossies").limit(501).get();
        if (s.size > 500)
          throw error(
            422,
            "Mais de 500 dossiês: refine a consulta antes de continuar.",
          );
        docs.push(...s.docs);
      } else
        for (let i = 0; i < ids.length; i += 30) {
          const s = await db()
            .collection("ebef_dossies")
            .where("empresaId", "in", ids.slice(i, i + 30))
            .get();
          docs.push(...s.docs);
        }
      res.json({
        ok: true,
        items: docs.map((x) => {
          const d = x.data();
          return {
            empresaId: d.empresaId,
            fonte: d.fonte,
            cnpj: d.cnpj,
            nome: d.nome,
            ano: d.draft.ano,
            status: d.status,
            prazoLegal: d.analise.prazoLegal,
            prazoInterno: d.draft.prazoInterno,
            responsavel: d.draft.responsavel,
            pendencias: d.analise.pendencias.length,
          };
        }),
      });
    } catch (e) {
      next(e);
    }
  });
  router.use(async (req, res, next) => {
    try {
      const c = contextSchema.parse(req.query);
      const allowed = await access(req.user, c.empresaId);
      if (!allowed.ok) throw error(allowed.status, allowed.error);
      const company = await db()
        .collection(
          c.fonte === "simples" ? "simples_empresas" : "lucro_empresas",
        )
        .doc(c.empresaId)
        .get();
      if (!company.exists)
        throw error(404, "Empresa não encontrada no cadastro selecionado.");
      const data = company.data(),
        cnpj = String(data.cnpj || "")
          .replace(/[.\/\-\s]/g, "")
          .toUpperCase();
      if (cnpj !== c.cnpj)
        throw error(
          409,
          "O CNPJ não corresponde à empresa ativa. Recarregue o cadastro.",
        );
      req.ebef = {
        ...c,
        nome: data.nome || data.razaoSocial || data.nomeFantasia || cnpj,
        ref: db()
          .collection("ebef_dossies")
          .doc(`${c.fonte}_${c.empresaId}_${c.ano}`),
      };
      next();
    } catch (e) {
      next(e);
    }
  });
  function initial(c) {
    const draft = novoEbef(c.ano);
    return {
      empresaId: c.empresaId,
      fonte: c.fonte,
      cnpj: c.cnpj,
      nome: c.nome,
      revision: 0,
      status: "rascunho",
      draft,
      documentos: [],
      analise: analisarEbef(draft),
      entrega: null,
      atualizadoEm: "",
      atualizadoPor: "",
    };
  }
  async function mutate(req, expected, action, fn) {
    return db().runTransaction(async (tx) => {
      const ref = req.ebef.ref,
        snap = await tx.get(ref),
        old = snap.exists ? snap.data() : initial(req.ebef);
      if (old.revision !== expected)
        throw error(
          409,
          "Este dossiê foi alterado por outra pessoa. Recarregue antes de gravar; suas alterações não foram sobrescritas.",
        );
      const updated = fn(structuredClone(old));
      updated.revision = old.revision + 1;
      updated.atualizadoEm = clock();
      updated.atualizadoPor = req.user.uid;
      updated.analise = analisarEbef(updated.draft, updated.documentos);
      if (Buffer.byteLength(JSON.stringify(updated)) > 650000)
        throw error(
          422,
          "Dossiê excede o limite de tamanho. Divida a análise documental.",
        );
      tx.set(ref, updated);
      tx.create(
        ref
          .collection("ebef_versoes")
          .doc(String(updated.revision).padStart(8, "0")),
        { ...updated, acao: action },
      );
      return updated;
    });
  }
  router.get("/", async (req, res, next) => {
    try {
      const snap = await req.ebef.ref.get();
      res.json({
        ok: true,
        record: snap.exists ? snap.data() : initial(req.ebef),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get("/historico", async (req, res, next) => {
    try {
      const s = await req.ebef.ref
        .collection("ebef_versoes")
        .orderBy("revision", "desc")
        .limit(100)
        .get();
      res.json({
        ok: true,
        items: s.docs.map((x) => {
          const { revision, status, atualizadoEm, atualizadoPor, acao } =
            x.data();
          return { revision, status, atualizadoEm, atualizadoPor, acao };
        }),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get("/versao/:revision", async (req, res, next) => {
    try {
      if (!/^\d{1,8}$/.test(req.params.revision))
        throw error(400, "Versão inválida.");
      const s = await req.ebef.ref
        .collection("ebef_versoes")
        .doc(String(Number(req.params.revision)).padStart(8, "0"))
        .get();
      if (!s.exists) throw error(404, "Versão não encontrada.");
      res.json({ ok: true, record: s.data() });
    } catch (e) {
      next(e);
    }
  });
  router.post("/", async (req, res, next) => {
    try {
      const c = commandSchema.parse(req.body);
      const record = await mutate(req, c.revision, c.action, (old) => {
        if (c.action === "salvar") {
          if (!["rascunho", "em_revisao"].includes(old.status))
            throw error(
              422,
              "Reabra o dossiê para alterar dados já aprovados.",
            );
          if (!c.draft || c.draft.ano !== req.ebef.ano)
            throw error(400, "Exercício divergente.");
          old.draft = c.draft;
          for (const p of old.draft.pessoas) {
            p.assinatura = "pendente";
            p.assinaturaEvidenciaId = "";
            p.assinaturaJustificativa = "";
          }
          old.status = "rascunho";
          old.entrega = null;
        } else if (c.action === "confirmar") {
          if (old.status !== "entrega_registrada")
            throw error(422, "Registre primeiro a entrega.");
          const p = old.draft.pessoas.find((x) => x.id === c.pessoaId);
          if (
            !p ||
            !old.analise.beneficiarios.some((x) => x.id === p.id) ||
            !c.assinatura ||
            !old.documentos.some((x) => x.id === c.documentoId)
          )
            throw error(
              422,
              "Selecione beneficiário, condição e documento comprobatório.",
            );
          if (
            c.assinatura === "nao_aplicavel" &&
            (p.pais === "BR" || !c.justificativa?.trim())
          )
            throw error(
              422,
              "Exceção de assinatura exige beneficiário estrangeiro e justificativa documental.",
            );
          p.assinatura = c.assinatura;
          p.assinaturaEvidenciaId = c.documentoId;
          p.assinaturaJustificativa = c.justificativa || "";
        } else {
          old.status = validarAcaoEbef(old, c.action, req.user.role);
          if (c.action === "reabrir") {
            old.entrega = null;
            for (const p of old.draft.pessoas) {
              p.assinatura = "pendente";
              p.assinaturaEvidenciaId = "";
              p.assinaturaJustificativa = "";
            }
          }
          if (c.action === "entregar") {
            if (
              !c.protocolo ||
              !c.data ||
              Number.isNaN(Date.parse(c.data)) ||
              new Date(c.data).toISOString().slice(0, 10) !== c.data ||
              c.data > clock().slice(0, 10) ||
              c.data < old.draft.dataBase ||
              !old.documentos.some((x) => x.id === c.documentoId)
            )
              throw error(
                422,
                "Informe protocolo, data real e comprovante da entrega.",
              );
            old.entrega = {
              protocolo: c.protocolo,
              data: c.data,
              documentoId: c.documentoId,
            };
          }
        }
        return old;
      });
      res.json({ ok: true, record });
    } catch (e) {
      next(e);
    }
  });
  router.post(
    "/documentos",
    upload.single("arquivo"),
    async (req, res, next) => {
      let file;
      try {
        const rev = Number(req.headers["if-match"]);
        if (
          !Number.isInteger(rev) ||
          rev < 0 ||
          req.headers["if-match"] === undefined
        )
          throw error(400, "Versão esperada obrigatória.");
        const b = req.file?.buffer;
        if (!b?.length) throw error(400, "Selecione um PDF, PNG ou JPEG.");
        const kind =
          b.subarray(0, 5).toString() === "%PDF-"
            ? "application/pdf"
            : b
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              ? "image/png"
              : b[0] === 255 && b[1] === 216 && b[2] === 255
                ? "image/jpeg"
                : null;
        if (!kind)
          throw error(400, "Conteúdo incompatível: envie PDF, PNG ou JPEG.");
        const id = randomUUID(),
          nome = req.file.originalname
            .replace(/[\r\n\x00-\x1f]/g, "")
            .slice(0, 160),
          path = `ebef/${req.ebef.ref.id}/${id}`;
        file = bucket().file(path);
        await file.save(b, {
          resumable: false,
          metadata: { contentType: kind, cacheControl: "private, no-store" },
          preconditionOpts: { ifGenerationMatch: 0 },
        });
        const record = await mutate(req, rev, "documento_adicionado", (old) => {
          if (["concluido", "dispensa_revisada"].includes(old.status))
            throw error(
              422,
              "Dossiê concluído: reabra antes de anexar novos documentos.",
            );
          if (old.documentos.length >= 80)
            throw error(422, "Limite de 80 documentos por dossiê.");
          old.documentos.push({
            id,
            nome,
            tamanho: b.length,
            sha256: createHash("sha256").update(b).digest("hex"),
            criadoEm: clock(),
            autor: req.user.uid,
          });
          return old;
        });
        res.json({ ok: true, record });
      } catch (e) {
        // Não apagar objeto após resultado incerto de transação: pode já estar referenciado.
        next(e);
      }
    },
  );
  router.get("/documentos/:id", async (req, res, next) => {
    try {
      key.parse(req.params.id);
      const s = await req.ebef.ref.get(),
        doc = s.data()?.documentos?.find((x) => x.id === req.params.id);
      if (!doc) throw error(404, "Documento não encontrado.");
      const [b] = await bucket()
        .file(`ebef/${req.ebef.ref.id}/${doc.id}`)
        .download();
      if (createHash("sha256").update(b).digest("hex") !== doc.sha256)
        throw error(409, "Integridade do documento divergente.");
      res.set("Content-Type", "application/octet-stream");
      res.set("X-Content-Type-Options", "nosniff");
      res.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(doc.nome)}`,
      );
      res.send(b);
    } catch (e) {
      next(e);
    }
  });
  router.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    const status =
      e instanceof z.ZodError
        ? 400
        : e.code === "LIMIT_FILE_SIZE"
          ? 413
          : e.status || 500;
    if (status === 500) console.error("[ebef]", e.message);
    res.status(status).json({
      ok: false,
      error:
        status === 500
          ? "Não foi possível concluir a operação. O dossiê não foi confirmado como salvo."
          : e instanceof z.ZodError
            ? "Dados inválidos: " +
              e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join(";")
            : e.message,
    });
  });
  return router;
}
export default createEbefRouter();

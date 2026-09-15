// Isolated API integration: no Firebase credentials or production IO.
import assert from "node:assert/strict";
import express from "express";
import { createEbefRouter } from "../sefaz-backend/ebef-routes.js";
import { novoEbef } from "../sefaz-backend/ebef-core.js";
const data = new Map([
    [
      "lucro_empresas/test",
      { nome: "Empresa de teste", cnpj: "61343420000165" },
    ],
  ]),
  files = new Map();
const ref = (path) => ({
  id: path.split("/").at(-1),
  path,
  collection: (n) => collection(path + "/" + n),
  get: async () => snap(path),
});
const snap = (path) => ({
  exists: data.has(path),
  data: () => structuredClone(data.get(path)),
  id: path.split("/").at(-1),
});
const collection = (path) => ({
  doc: (id) => ref(path + "/" + id),
  orderBy: () => collection(path),
  limit: () => ({
    get: async () => ({
      docs: [...data.keys()]
        .filter(
          (x) =>
            x.startsWith(path + "/") &&
            x.split("/").length === path.split("/").length + 1,
        )
        .map(snap),
    }),
  }),
});
let queue = Promise.resolve();
const db = {
  collection,
  runTransaction(fn) {
    const work = queue.then(async () => {
      const pending = [];
      const result = await fn({
        get: async (r) => snap(r.path),
        set: (r, d) => pending.push([r.path, d]),
        create: (r, d) => {
          assert(!data.has(r.path));
          pending.push([r.path, d]);
        },
      });
      for (const [k, v] of pending) data.set(k, structuredClone(v));
      return result;
    });
    queue = work.catch(() => {});
    return work;
  },
};
const app = express();
app.use(express.json());
app.use(
  "/ebef",
  createEbefRouter({
    db: () => db,
    auth: (req, res, next) => {
      if (!req.headers.authorization) return res.status(401).end();
      req.user = { uid: "tester", role: req.headers["x-test-role"] || "admin" };
      next();
    },
    access: async (u, id) => ({
      ok: id === "test",
      status: 403,
      error: "Carteira negada",
    }),
    bucket: () => ({
      file: (path) => ({
        save: async (b) => {
          files.set(path, b);
        },
        download: async () => [files.get(path)],
      }),
    }),
  }),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const root = `http://127.0.0.1:${server.address().port}/ebef`,
  q = "?empresaId=test&fonte=lucro&cnpj=61343420000165&ano=2026";
const call = (suffix = "", opts = {}) =>
  fetch(root + suffix + q, {
    ...opts,
    headers: { Authorization: "test", ...opts.headers },
  });
const post = (body, role = "admin") =>
  call("", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-Role": role },
    body: JSON.stringify(body),
  });
try {
  assert.equal((await fetch(root + q)).status, 401);
  assert.equal(
    (
      await fetch(root + q.replace("empresaId=test", "empresaId=other"), {
        headers: { Authorization: "test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(root + q.replace("61343420000165", "12345678000190"), {
        headers: { Authorization: "test" },
      })
    ).status,
    409,
  );
  let response = await call();
  assert.equal(response.status, 200);
  let record = (await response.json()).record;
  assert.equal(record.revision, 0);
  assert.equal(data.size, 1);
  const draft = novoEbef(2026);
  draft.responsavel = "Teste";
  response = await post({ action: "salvar", revision: 0, draft });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.revision, 1);
  assert.equal(
    (await post({ action: "salvar", revision: 0, draft })).status,
    409,
  );
  const same = await Promise.all([
    post({ action: "salvar", revision: 1, draft }),
    post({ action: "salvar", revision: 1, draft }),
  ]);
  assert.deepEqual(same.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await post({ action: "revisar", revision: 2 })).status, 422);
  assert.equal(
    (
      await post({
        action: "salvar",
        revision: 2,
        draft: { ...draft, ano: 2027 },
      })
    ).status,
    400,
  );
  let form = new FormData();
  form.append("arquivo", new Blob(["<script>bad</script>"]), "fake.pdf");
  assert.equal(
    (
      await call("/documentos", {
        method: "POST",
        headers: { "If-Match": "2" },
        body: form,
      })
    ).status,
    400,
  );
  form = new FormData();
  form.append("arquivo", new Blob(["%PDF-1.4\nfixture"]), "contrato.pdf");
  response = await call("/documentos", {
    method: "POST",
    headers: { "If-Match": "2" },
    body: form,
  });
  assert.equal(response.status, 200);
  record = (await response.json()).record;
  const doc = record.documentos[0];
  assert(doc.sha256);
  assert.equal(record.revision, 3);
  Object.assign(draft, {
    natureza: "slu",
    domicilio: "BR",
    enquadramentoConferido: true,
    matrizConferida: true,
    evidenciaEnquadramentoId: doc.id,
  });
  assert.equal(
    (await post({ action: "salvar", revision: 3, draft })).status,
    200,
  );
  assert.equal((await post({ action: "revisar", revision: 4 })).status, 200);
  assert.equal(
    (await post({ action: "aprovar", revision: 5 }, "colaborador")).status,
    403,
  );
  response = await post({ action: "aprovar", revision: 5 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.status, "dispensa_revisada");
  assert.equal(
    (await post({ action: "salvar", revision: 6, draft })).status,
    422,
  );
  assert.equal((await post({ action: "reabrir", revision: 6 })).status, 200);
  response = await call("/versao/6");
  assert.equal((await response.json()).record.status, "dispensa_revisada");
  response = await call(`/documentos/${doc.id}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "%PDF-1.4\nfixture");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await call("/documentos/outro")).status, 404);
  assert.equal((await call("/historico")).status, 200);
  // Full delivery with a synthetic sole controlling person (S.A. closed).
  Object.assign(draft, {
    natureza: "sa_fechada",
    dataBase: "2026-01-01",
    cadeiaConferida: true,
    controleConferido: true,
    pessoas: [
      {
        id: "pf",
        tipo: "PF",
        papelScp: "nenhum",
        beneficiariosScp: [],
        fundamentoScp: "",
        nome: "Pessoa sintética",
        documento: "52998224725",
        pais: "BR",
        administrador: false,
        controle: false,
        fundamentoControle: "",
        evidenciaId: doc.id,
        assinatura: "confirmada",
        assinaturaEvidenciaId: doc.id,
        assinaturaJustificativa: "",
      },
    ],
    vinculos: [
      {
        id: "v",
        titularId: "pf",
        entidadeId: "matriz",
        capital: "100",
        votos: "100",
        inicio: "2025-01-01",
        fim: "",
        evidenciaId: doc.id,
      },
    ],
  });
  response = await post({ action: "salvar", revision: 7, draft });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).record.draft.pessoas[0].assinatura,
    "pendente",
  );
  assert.equal((await post({ action: "revisar", revision: 8 })).status, 200);
  assert.equal((await post({ action: "aprovar", revision: 9 })).status, 200);
  assert.equal(
    (
      await post({
        action: "entregar",
        revision: 10,
        protocolo: "Teste",
        data: "2026-01-02",
        documentoId: "nao-existe",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await post({
        action: "entregar",
        revision: 10,
        protocolo: "Teste",
        data: "2026-01-02",
        documentoId: doc.id,
      })
    ).status,
    200,
  );
  assert.equal((await post({ action: "concluir", revision: 11 })).status, 422);
  assert.equal(
    (
      await post({
        action: "confirmar",
        revision: 11,
        pessoaId: "pf",
        assinatura: "nao_aplicavel",
        documentoId: doc.id,
        justificativa: "Teste",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await post({
        action: "confirmar",
        revision: 11,
        pessoaId: "pf",
        assinatura: "confirmada",
        documentoId: doc.id,
      })
    ).status,
    200,
  );
  assert.equal((await post({ action: "concluir", revision: 12 })).status, 200);
  assert.equal(
    (await post({ action: "reabrir", revision: 13 }, "colaborador")).status,
    403,
  );
  assert.equal((await post({ action: "reabrir", revision: 13 })).status, 200);
  response = await call("/versao/13");
  assert.equal((await response.json()).record.status, "concluido");
  console.log(
    "e-BEF API: auth, carteira, CNPJ, partial saves, concurrent revisions, evidence, workflow, immutable history and private download passed.",
  );
} finally {
  server.closeAllConnections();
  server.close();
}

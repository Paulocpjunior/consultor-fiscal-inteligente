# Firebase Security Rules — Consultor Fiscal Inteligente

> **Os arquivos de regras vivem na RAIZ do repositório**, não nesta pasta:
> - `../firestore.rules` — regras do Firestore (canônica, mantida).
> - `../storage.rules` — regras do Cloud Storage (`xmls/{empresaId}/{file}`,
>   limite 10 MB, validação de content-type, delete só admin).
> - `../firestore.indexes.json` — índices compostos.
>
> O `firebase.json` (raiz) referencia esses 3 arquivos. Esta pasta guarda só
> este README. (Antes havia cópias duplicadas de `firestore.rules`/`storage.rules`
> aqui — eram rascunhos de 24/05 e foram removidos pra evitar editar a versão
> errada.)

## Modelo de permissão

- Master admin: `junior@spassessoriacontabil.com.br`.
- Outros admins: documento em `users/{uid}` com `role == 'admin'`.
- Colaboradores: enxergam o cadastro (via carteira), mas só editam/excluem
  conforme as regras de cada coleção. `createdBy == uid` para documentos
  fiscais/empresas; `usuarioId == uid` para logs/erros.
- Default deny em qualquer coleção/caminho não listado.

## Deploy

**Automático:** o workflow `.github/workflows/deploy.yml` publica
`firestore:rules` e `storage` a cada push na `main` (passo "Deploy Firestore
& Storage rules"), usando a mesma service account do deploy do Cloud Run.

> Se o passo falhar com erro de permissão, conceda à SA do GitHub
> (`secrets.GCP_SA_KEY`) o papel **`roles/firebaserules.admin`** no projeto
> `consultorfiscalapp`. O passo é `continue-on-error` — não bloqueia o deploy
> do app, mas loga um aviso visível.

**Manual (quando precisar publicar fora do CI):**

```bash
firebase deploy --only firestore:rules,storage --project consultorfiscalapp
```

## Verificação rápida pós-deploy

1. Login como colaborador comum.
2. Importe um XML válido em **Importa XML → Importação Manual**.
3. Confira no Console:
   - **Firestore**: documento criado em `documentos_fiscais` com
     `createdBy == seu_uid`; log em `xml_capturas`; nenhum erro em `xml_erros`.
   - **Storage**: arquivo em `xmls/{empresaId}/{chave}.xml`.
4. Tente importar o mesmo XML de novo — deve aparecer "duplicado".
5. Login como admin (master) e confirme que enxerga documentos de outros usuários.

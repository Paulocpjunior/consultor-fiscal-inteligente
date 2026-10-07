'use strict';
const { createHash } = require('node:crypto');
const ACOES = ['editar', 'importar', 'calcular', 'emitir', 'fechar', 'excluir'];
const permissao = nivel => ({ versao: 1, nivel, acoes: Object.fromEntries(ACOES.map(a => [a, nivel === 'operacao'])) });
const erro = (status, message) => Object.assign(new Error(message), { status });
function validarCadastro(body) {
  if (!body || Object.keys(body).some(k => !['nome', 'email'].includes(k))) throw erro(400, 'Informe somente nome e e-mail; as permissões são configuradas após o cadastro.');
  const nome = String(body.nome || '').trim(), email = String(body.email || '').trim().toLowerCase();
  if (nome.length < 2 || nome.length > 120 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@spassessoriacontabil\.com\.br$/.test(email) || email.length > 254) throw erro(400, 'Informe o nome e um e-mail válido @spassessoriacontabil.com.br.');
  return { nome, email };
}
function criarServico({ db, auth, aplicativo, efetivas }) {
  if (!['cci', 'cfi'].includes(aplicativo)) throw new Error('Aplicativo inválido');
  const isCci = aplicativo === 'cci', campo = isCci ? 'permissoesCci' : 'permissoesCfi';
  const ehAdmin = u => isCci ? u?.is_admin === true : u?.role === 'admin';
  async function conferirAutor(tx, autor) {
    const doc = await tx.get(db.collection('users').doc(autor.uid));
    if (!doc.exists || !ehAdmin(doc.data())) throw erro(403, 'Somente administradores deste aplicativo podem gerenciar acessos.');
  }
  function audit(autor, alvoUid, evento, antes, depois, extra = {}) {
    return { aplicativo, alvoUid, autorUid: autor.uid, autorEmail: autor.email || null, evento, em: new Date(), antes: efetivas(antes), depois: efetivas(depois), ...extra };
  }
  async function alterar(autor, uid, body, tipo = 'gestor') {
    if (!uid || !body || typeof body.ativo !== 'boolean' || !Number.isInteger(body.revisao) || body.revisao < 0 || Object.keys(body).some(k => !['ativo', 'revisao'].includes(k))) throw erro(400, 'Informe a alteração e a revisão atual do cadastro.');
    if (uid === autor.uid) throw erro(400, 'Peça a outro administrador para alterar sua própria nomeação.');
    let identidade;
    try { identidade = await auth.getUser(uid); } catch (e) { if (e.code === 'auth/user-not-found') throw erro(409, 'Cadastro antigo sem login correspondente. Selecione a conta ativa.'); throw e; }
    if (identidade.disabled) throw erro(409, 'A conta está desativada. Regularize o login antes da nomeação.');
    const ref = db.collection('users').doc(uid);
    await db.runTransaction(async tx => {
      await conferirAutor(tx, autor);
      const snap = await tx.get(ref);
      if (!snap.exists) throw erro(404, 'Colaborador não encontrado.');
      const antes = snap.data();
      if (String(antes.email || antes.last_email || '').toLowerCase() !== String(identidade.email || '').toLowerCase()) throw erro(409, 'O e-mail do cadastro não corresponde ao login. Confira a identidade.');
      if ((antes.gestaoAcessosRevisao || 0) !== body.revisao) throw erro(409, 'Outro administrador alterou este cadastro. Atualize a lista.');
      const patch = { gestaoAcessosRevisao: body.revisao + 1, updated_at: new Date(), updated_by: autor.uid };
      if (tipo === 'gestor') {
        patch.gestorAcessos = body.ativo;
        if (body.ativo) {
          Object.assign(patch, isCci ? { is_admin: true, acessoContabilAutorizado: true } : { role: 'admin' });
          patch[campo] = permissao('operacao');
          patch[campo + 'Revisao'] = (antes[campo + 'Revisao'] || 0) + 1;
        }
      } else {
        Object.assign(patch, isCci ? { is_admin: body.ativo } : { role: body.ativo ? 'admin' : 'colaborador' });
        if (!body.ativo) patch.gestorAcessos = false;
      }
      tx.update(ref, patch);
      tx.set(db.collection('permissoes_auditoria').doc(), audit(autor, uid, tipo === 'gestor' ? 'gestor_acessos' : 'administracao', antes, { ...antes, ...patch }, { gestorAntes: antes.gestorAcessos === true, gestorDepois: patch.gestorAcessos ?? antes.gestorAcessos === true, adminAntes: ehAdmin(antes), adminDepois: ehAdmin({ ...antes, ...patch }), revisao: body.revisao + 1 }));
    });
    return { ok: true, revisao: body.revisao + 1 };
  }
  async function cadastrar(autor, body) {
    const { nome, email } = validarCadastro(body);
    await db.runTransaction(tx => conferirAutor(tx, autor));
    const uid = 'cadastro_' + createHash('sha256').update(aplicativo + ':' + email).digest('hex').slice(0, 40);
    let identidade;
    try { identidade = await auth.getUserByEmail(email); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    if (identidade && identidade.uid !== uid) throw erro(409, 'Este e-mail já possui conta. Localize o colaborador na lista; nenhum acesso foi alterado.');
    const ref = db.collection('users').doc(uid);
    if (!identidade) {
      try { identidade = await auth.createUser({ uid, email, displayName: nome, disabled: true, emailVerified: false }); }
      catch (e) { if (!['auth/email-already-exists', 'auth/uid-already-exists'].includes(e.code)) throw e; identidade = await auth.getUserByEmail(email); if (identidade.uid !== uid) throw erro(409, 'Este e-mail já possui conta. Atualize a lista.'); }
    }
    await db.runTransaction(async tx => {
      await conferirAutor(tx, autor);
      const snap = await tx.get(ref);
      if (snap.exists) {
        const d = snap.data();
        if (d.provisionamento?.origem !== 'gestao_acessos_v1' || d.provisionamento?.estado !== 'pendente' || d.email !== email) throw erro(409, 'Colaborador já cadastrado. Atualize a lista para configurar as permissões.');
        return;
      }
      const perfil = { name: nome, email, gestorAcessos: false, gestaoAcessosRevisao: 0, created_at: new Date(), cadastradoPor: autor.uid, [campo]: permissao('consulta'), [campo + 'Revisao']: 1, provisionamento: { origem: 'gestao_acessos_v1', estado: 'pendente' }, ...(isCci ? { is_admin: false, last_name: nome, last_email: email, acessoContabilAutorizado: true } : { role: 'colaborador', acessoCfi: 'relatorios', departamentos: [], modulosPermitidos: [], isVerified: false }) };
      tx.set(ref, perfil);
      tx.set(db.collection('permissoes_auditoria').doc(), audit(autor, uid, 'cadastro_colaborador', { [campo]: permissao('consulta') }, perfil));
    });
    await auth.updateUser(uid, { disabled: false });
    await ref.update({ provisionamento: { origem: 'gestao_acessos_v1', estado: 'concluido' } });
    let linkSenha = null;
    try { linkSenha = await auth.generatePasswordResetLink(email); } catch { /* Cadastro concluído; o login também oferece recuperação de senha. */ }
    return { ok: true, uid, email, linkSenha, mensagem: linkSenha ? 'Colaborador cadastrado em consulta. Compartilhe o link de senha e configure as empresas e ações.' : 'Colaborador cadastrado em consulta. Use a recuperação de senha no login e configure as empresas e ações.' };
  }
  return { alterar, cadastrar };
}
function registrar(app, deps) {
  const service = criarServico(deps), prefix = '/api/gestao-acessos';
  const responder = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'Não foi possível concluir. Atualize a lista e tente novamente; cadastros pendentes podem ser retomados com o mesmo e-mail.' }); }
  };
  app.post(prefix + '/colaboradores', deps.adminRequired, responder(req => service.cadastrar(req.user, req.body)));
  app.put(prefix + '/gestores/:uid', deps.adminRequired, responder(req => service.alterar(req.user, req.params.uid, req.body)));
  app.put(prefix + '/administracao/:uid', deps.adminRequired, responder(req => service.alterar(req.user, req.params.uid, req.body, 'admin')));
}
module.exports = { validarCadastro, criarServico, registrar };

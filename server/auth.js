const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const {
  sistema,
  db,
  comConta,
  prepararConta,
} = require('./db-pg');

const router = express.Router();

const COOKIE = 'hm_session';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  const file = path.join(__dirname, '..', '.jwt_secret');

  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {}

  const secret = require('crypto').randomBytes(48).toString('hex');

  try {
    fs.writeFileSync(file, secret, { mode: 0o600 });
  } catch {}

  return secret;
}

const JWT_SECRET = loadSecret();

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: '/',
  };
}

function gerarToken(usuario) {
  return jwt.sign(
    {
      id: Number(usuario.id),
      conta_id: Number(usuario.conta_id),
      papel: usuario.papel,
      nome: usuario.nome,
      email: usuario.email,
    },
    JWT_SECRET,
    {
      expiresIn: '7d',
    }
  );
}

function enviarSessao(res, usuario) {
  res.cookie(COOKIE, gerarToken(usuario), cookieOptions());
}

function limparSessao(res) {
  res.clearCookie(COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

/*
 * Autenticação.
 */
async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];

  if (!token) {
    return res.status(401).json({
      erro: 'Sessão expirada. Faça login novamente.',
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    const usuario = await sistema
      .prepare(`
        SELECT
          u.id,
          u.conta_id,
          u.nome,
          u.email,
          u.papel,
          c.nome AS conta_nome,
          c.slug AS conta_slug
        FROM usuarios u
        JOIN contas c ON c.id = u.conta_id
        WHERE u.id = ?
      `)
      .get(payload.id);

    if (!usuario) {
      limparSessao(res);

      return res.status(401).json({
        erro: 'Sessão inválida. Faça login novamente.',
      });
    }

    req.user = {
      id: Number(usuario.id),
      conta_id: Number(usuario.conta_id),
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
      conta_nome: usuario.conta_nome,
      conta_slug: usuario.conta_slug,
    };

    next();
  } catch (e) {
    limparSessao(res);

    return res.status(401).json({
      erro: 'Sessão inválida ou expirada. Faça login novamente.',
    });
  }
}

/*
 * Coloca a requisição dentro do contexto da empresa.
 */
async function usarConta(req, res, next) {
  if (!req.user?.conta_id) {
    return res.status(401).json({
      erro: 'Conta não identificada.',
    });
  }

  try {
    await comConta(req.user.conta_id, async () => {
      await prepararConta(req.user.conta_id);
      await next();
    });
  } catch (e) {
    next(e);
  }
}

/*
 * Somente administrador.
 */
function requireAdmin(req, res, next) {
  if (req.user?.papel !== 'admin') {
    return res.status(403).json({
      erro: 'Somente o fundador pode realizar esta ação.',
    });
  }

  next();
}

/*
 * Cadastro.
 */
router.post('/cadastro', async (req, res, next) => {
  try {
    const nomeEmpresa = String(
      req.body?.empresa ||
      req.body?.nome_empresa ||
      req.body?.conta ||
      ''
    ).trim();

    const nome = String(req.body?.nome || '').trim();

    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();

    const senha = String(req.body?.senha || '');

    if (!nomeEmpresa || !nome || !email || !senha) {
      return res.status(400).json({
        erro: 'Preencha empresa, nome, e-mail e senha.',
      });
    }

    if (senha.length < 6) {
      return res.status(400).json({
        erro: 'A senha precisa ter pelo menos 6 caracteres.',
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        erro: 'Informe um e-mail válido.',
      });
    }

    const slugBase = nomeEmpresa
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'empresa';

    const hash = await bcrypt.hash(senha, 12);

    const existente = await sistema
      .prepare(`
        SELECT id
        FROM usuarios
        WHERE lower(email) = lower(?)
      `)
      .get(email);

    if (existente) {
      return res.status(409).json({
        erro: 'Este e-mail já está cadastrado.',
      });
    }

    /*
     * Cria conta + usuário na mesma transação.
     */
    const resultado = await sistema.transaction(async () => {
      let slug = slugBase;
      let contador = 2;

      while (
        await sistema
          .prepare('SELECT id FROM contas WHERE slug = ?')
          .get(slug)
      ) {
        slug = `${slugBase}-${contador++}`;
      }

      const conta = await sistema
        .prepare(`
          INSERT INTO contas (nome, slug)
          VALUES (?, ?)
          RETURNING id, nome, slug
        `)
        .get(nomeEmpresa, slug);

      const usuario = await sistema
        .prepare(`
          INSERT INTO usuarios
            (conta_id, nome, email, senha_hash, papel)
          VALUES
            (?, ?, ?, ?, 'admin')
          RETURNING id, conta_id, nome, email, papel
        `)
        .get(
          conta.id,
          nome,
          email,
          hash
        );

      return {
        conta,
        usuario,
      };
    });

    /*
     * Agora criamos as tabelas da empresa e o seed inicial.
     */
    await prepararConta(resultado.conta.id);

    enviarSessao(res, resultado.usuario);

    res.status(201).json({
      ok: true,
      usuario: {
        id: Number(resultado.usuario.id),
        conta_id: Number(resultado.usuario.conta_id),
        nome: resultado.usuario.nome,
        email: resultado.usuario.email,
        papel: resultado.usuario.papel,
      },
      conta: {
        id: Number(resultado.conta.id),
        nome: resultado.conta.nome,
        slug: resultado.conta.slug,
      },
    });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({
        erro: 'Empresa ou e-mail já cadastrado.',
      });
    }

    next(e);
  }
});

/*
 * Login.
 */
router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();

    const senha = String(req.body?.senha || '');

    if (!email || !senha) {
      return res.status(400).json({
        erro: 'Informe e-mail e senha.',
      });
    }

    const usuario = await sistema
      .prepare(`
        SELECT
          u.id,
          u.conta_id,
          u.nome,
          u.email,
          u.senha_hash,
          u.papel,
          c.nome AS conta_nome,
          c.slug AS conta_slug
        FROM usuarios u
        JOIN contas c ON c.id = u.conta_id
        WHERE lower(u.email) = lower(?)
      `)
      .get(email);

    if (!usuario) {
      return res.status(401).json({
        erro: 'E-mail ou senha incorretos.',
      });
    }

    const ok = await bcrypt.compare(
      senha,
      usuario.senha_hash
    );

    if (!ok) {
      return res.status(401).json({
        erro: 'E-mail ou senha incorretos.',
      });
    }

    /*
     * Garante que a estrutura PostgreSQL da conta exista.
     */
    await prepararConta(usuario.conta_id);

    enviarSessao(res, usuario);

    res.json({
      ok: true,
      usuario: {
        id: Number(usuario.id),
        conta_id: Number(usuario.conta_id),
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
        conta_nome: usuario.conta_nome,
        conta_slug: usuario.conta_slug,
      },
    });
  } catch (e) {
    next(e);
  }
});

/*
 * Logout.
 */
router.post('/logout', (req, res) => {
  limparSessao(res);
  res.json({ ok: true });
});

/*
 * Usuário atual.
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const usuario = await sistema
      .prepare(`
        SELECT
          u.id,
          u.conta_id,
          u.nome,
          u.email,
          u.papel,
          c.nome AS conta_nome,
          c.slug AS conta_slug
        FROM usuarios u
        JOIN contas c ON c.id = u.conta_id
        WHERE u.id = ?
      `)
      .get(req.user.id);

    if (!usuario) {
      return res.status(401).json({
        erro: 'Usuário não encontrado.',
      });
    }

    res.json({
      usuario: {
        id: Number(usuario.id),
        conta_id: Number(usuario.conta_id),
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
        conta_nome: usuario.conta_nome,
        conta_slug: usuario.conta_slug,
      },
    });
  } catch (e) {
    next(e);
  }
});

/*
 * Alteração de senha.
 */
router.post('/senha', requireAuth, async (req, res, next) => {
  try {
    const atual = String(req.body?.senha_atual || '');
    const nova = String(req.body?.nova_senha || '');

    if (!atual || !nova) {
      return res.status(400).json({
        erro: 'Informe a senha atual e a nova senha.',
      });
    }

    if (nova.length < 6) {
      return res.status(400).json({
        erro: 'A nova senha precisa ter pelo menos 6 caracteres.',
      });
    }

    const usuario = await sistema
      .prepare(`
        SELECT senha_hash
        FROM usuarios
        WHERE id = ?
      `)
      .get(req.user.id);

    if (!usuario) {
      return res.status(404).json({
        erro: 'Usuário não encontrado.',
      });
    }

    const ok = await bcrypt.compare(
      atual,
      usuario.senha_hash
    );

    if (!ok) {
      return res.status(400).json({
        erro: 'Senha atual incorreta.',
      });
    }

    const hash = await bcrypt.hash(nova, 12);

    await sistema
      .prepare(`
        UPDATE usuarios
        SET senha_hash = ?
        WHERE id = ?
      `)
      .run(hash, req.user.id);

    limparSessao(res);

    res.json({
      ok: true,
      mensagem: 'Senha alterada. Faça login novamente.',
    });
  } catch (e) {
    next(e);
  }
});

/*
 * Lista usuários da conta.
 */
router.get(
  '/usuarios',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const usuarios = await sistema
        .prepare(`
          SELECT
            id,
            conta_id,
            nome,
            email,
            papel,
            created_at
          FROM usuarios
          WHERE conta_id = ?
          ORDER BY id ASC
        `)
        .all(req.user.conta_id);

      res.json(
        usuarios.map((u) => ({
          ...u,
          id: Number(u.id),
          conta_id: Number(u.conta_id),
        }))
      );
    } catch (e) {
      next(e);
    }
  }
);

/*
 * Cria usuário dentro da conta.
 */
router.post(
  '/usuarios',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const nome = String(req.body?.nome || '').trim();

      const email = String(req.body?.email || '')
        .trim()
        .toLowerCase();

      const senha = String(req.body?.senha || '');

      const papel =
        req.body?.papel === 'admin'
          ? 'admin'
          : 'operador';

      if (!nome || !email || !senha) {
        return res.status(400).json({
          erro: 'Preencha nome, e-mail e senha.',
        });
      }

      if (senha.length < 6) {
        return res.status(400).json({
          erro: 'A senha precisa ter pelo menos 6 caracteres.',
        });
      }

      const existente = await sistema
        .prepare(`
          SELECT id
          FROM usuarios
          WHERE lower(email) = lower(?)
        `)
        .get(email);

      if (existente) {
        return res.status(409).json({
          erro: 'Este e-mail já está cadastrado.',
        });
      }

      const hash = await bcrypt.hash(senha, 12);

      const usuario = await sistema
        .prepare(`
          INSERT INTO usuarios
            (conta_id, nome, email, senha_hash, papel)
          VALUES
            (?, ?, ?, ?, ?)
          RETURNING id, conta_id, nome, email, papel, created_at
        `)
        .get(
          req.user.conta_id,
          nome,
          email,
          hash,
          papel
        );

      res.status(201).json({
        ...usuario,
        id: Number(usuario.id),
        conta_id: Number(usuario.conta_id),
      });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({
          erro: 'Este e-mail já está cadastrado.',
        });
      }

      next(e);
    }
  }
);

/*
 * Remove usuário.
 */
router.delete(
  '/usuarios/:id',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          erro: 'Usuário inválido.',
        });
      }

      if (id === Number(req.user.id)) {
        return res.status(400).json({
          erro: 'Você não pode remover o próprio usuário.',
        });
      }

      const usuario = await sistema
        .prepare(`
          SELECT id
          FROM usuarios
          WHERE id = ?
            AND conta_id = ?
        `)
        .get(id, req.user.conta_id);

      if (!usuario) {
        return res.status(404).json({
          erro: 'Usuário não encontrado.',
        });
      }

      await sistema
        .prepare(`
          DELETE FROM usuarios
          WHERE id = ?
            AND conta_id = ?
        `)
        .run(id, req.user.conta_id);

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = {
  router,
  requireAuth,
  requireAdmin,
  usarConta,
};

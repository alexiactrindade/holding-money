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

/* =========================================================
   JWT / SESSÃO
   ========================================================= */

function loadSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Configure JWT_SECRET nas variáveis de ambiente de produção.');
  }

  const file = path.join(__dirname, '..', '.jwt_secret');

  try {
    const secret = fs.readFileSync(file, 'utf8').trim();

    if (secret) {
      return secret;
    }
  } catch {}

  const secret = require('crypto')
    .randomBytes(48)
    .toString('hex');

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
  res.cookie(
    COOKIE,
    gerarToken(usuario),
    cookieOptions()
  );
}

function limparSessao(res) {
  res.clearCookie(COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

/* =========================================================
   AUTENTICAÇÃO
   ========================================================= */

async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];

  if (!token) {
    return res.status(401).json({
      erro: 'Sessão expirada. Faça login novamente.',
    });
  }

  try {
    const payload = jwt.verify(
      token,
      JWT_SECRET
    );

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
        JOIN contas c
          ON c.id = u.conta_id
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

    return next();

  } catch (e) {
    console.error(
      'ERRO NA AUTENTICAÇÃO:',
      e
    );

    limparSessao(res);

    return res.status(401).json({
      erro: 'Sessão inválida ou expirada. Faça login novamente.',
    });
  }
}

async function usarConta(req, res, next) {
  if (!req.user?.conta_id) {
    return res.status(401).json({
      erro: 'Conta não identificada.',
    });
  }

  try {
    await comConta(
      req.user.conta_id,
      async () => {
        await prepararConta(
          req.user.conta_id
        );

        await next();
      }
    );
  } catch (e) {
    next(e);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.papel !== 'admin') {
    return res.status(403).json({
      erro: 'Somente o fundador pode realizar esta ação.',
    });
  }

  next();
}

/* =========================================================
   CADASTRO
   ========================================================= */

router.post('/cadastro', async (req, res) => {
  try {
    const nomeEmpresa = String(
      req.body?.empresa ||
      req.body?.nome_empresa ||
      req.body?.conta ||
      ''
    ).trim();

    const nome = String(
      req.body?.nome || ''
    ).trim();

    const email = String(
      req.body?.email || ''
    )
      .trim()
      .toLowerCase();

    const senha = String(
      req.body?.senha || ''
    );

    if (
      !nomeEmpresa ||
      !nome ||
      !email ||
      !senha
    ) {
      return res.status(400).json({
        erro: 'Preencha empresa, nome, e-mail e senha.',
      });
    }

    if (senha.length < 8) {
      return res.status(400).json({
        erro: 'A senha precisa ter pelo menos 8 caracteres.',
      });
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        erro: 'Informe um e-mail válido.',
      });
    }

    /* Verifica e-mail antes de iniciar a transação */
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

    const slugBase =
      nomeEmpresa
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'empresa';

    const hash = await bcrypt.hash(
      senha,
      12
    );

    /*
     * Cria a empresa e o usuário.
     *
     * Não usamos RETURNING.
     * Fazemos INSERT e depois SELECT.
     */
    const resultado = await sistema.transaction(
      async () => {
        let slug = slugBase;
        let contador = 2;

        while (
          await sistema
            .prepare(`
              SELECT id
              FROM contas
              WHERE slug = ?
            `)
            .get(slug)
        ) {
          slug = `${slugBase}-${contador++}`;
        }

        /* -----------------------------------------
           CRIA CONTA
           ----------------------------------------- */

        await sistema
          .prepare(`
            INSERT INTO contas
              (nome, slug)
            VALUES
              (?, ?)
          `)
          .run(
            nomeEmpresa,
            slug
          );

        /* -----------------------------------------
           RECUPERA CONTA
           ----------------------------------------- */

        const conta = await sistema
          .prepare(`
            SELECT
              id,
              nome,
              slug
            FROM contas
            WHERE slug = ?
          `)
          .get(slug);

        if (!conta) {
          throw new Error(
            'Não foi possível recuperar a conta criada.'
          );
        }

        /* -----------------------------------------
           CRIA USUÁRIO ADMIN
           ----------------------------------------- */

        await sistema
          .prepare(`
            INSERT INTO usuarios
              (
                conta_id,
                nome,
                email,
                senha_hash,
                papel
              )
            VALUES
              (?, ?, ?, ?, 'admin')
          `)
          .run(
            conta.id,
            nome,
            email,
            hash
          );

        /* -----------------------------------------
           RECUPERA USUÁRIO
           ----------------------------------------- */

        const usuario = await sistema
          .prepare(`
            SELECT
              id,
              conta_id,
              nome,
              email,
              papel
            FROM usuarios
            WHERE lower(email) = lower(?)
          `)
          .get(email);

        if (!usuario) {
          throw new Error(
            'Não foi possível recuperar o usuário criado.'
          );
        }

        return {
          conta,
          usuario,
        };
      }
    )();

    if (!resultado?.conta?.id) {
      throw new Error(
        'Conta criada, mas não foi possível recuperar seus dados.'
      );
    }

    if (!resultado?.usuario?.id) {
      throw new Error(
        'Usuário criado, mas não foi possível recuperar seus dados.'
      );
    }

    /* Prepara as tabelas e configurações da nova conta */
    await prepararConta(
      resultado.conta.id
    );

    /* Cria a sessão */
    enviarSessao(
      res,
      resultado.usuario
    );

    return res.status(201).json({
      ok: true,

      usuario: {
        id: Number(
          resultado.usuario.id
        ),
        conta_id: Number(
          resultado.usuario.conta_id
        ),
        nome: resultado.usuario.nome,
        email: resultado.usuario.email,
        papel: resultado.usuario.papel,
      },

      conta: {
        id: Number(
          resultado.conta.id
        ),
        nome: resultado.conta.nome,
        slug: resultado.conta.slug,
      },
    });

  } catch (e) {
    console.error(
      'ERRO NO CADASTRO:',
      e
    );

    if (e.code === '23505') {
      return res.status(409).json({
        erro: 'Empresa ou e-mail já cadastrado.',
      });
    }

    return res.status(500).json({
      erro:
        `Erro no cadastro: ${
          e.message ||
          'erro desconhecido'
        }`,
    });
  }
});

/* =========================================================
   LOGIN
   ========================================================= */

router.post('/login', async (req, res) => {
  try {
    const email = String(
      req.body?.email || ''
    )
      .trim()
      .toLowerCase();

    const senha = String(
      req.body?.senha || ''
    );

    if (!email || !senha) {
      return res.status(400).json({
        erro: 'Preencha e-mail e senha.',
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
        JOIN contas c
          ON c.id = u.conta_id
        WHERE lower(u.email) = lower(?)
      `)
      .get(email);

    if (!usuario) {
      return res.status(401).json({
        erro: 'E-mail ou senha inválidos.',
      });
    }

    const senhaOk =
      await bcrypt.compare(
        senha,
        usuario.senha_hash
      );

    if (!senhaOk) {
      return res.status(401).json({
        erro: 'E-mail ou senha inválidos.',
      });
    }

    await prepararConta(
      usuario.conta_id
    );

    enviarSessao(
      res,
      usuario
    );

    return res.json({
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
    console.error(
      'ERRO NO LOGIN:',
      e
    );

    return res.status(500).json({
      erro: 'Não foi possível entrar no sistema.',
    });
  }
});

/* =========================================================
   LOGOUT
   ========================================================= */

router.post('/logout', (req, res) => {
  limparSessao(res);

  return res.json({
    ok: true,
  });
});

/* =========================================================
   USUÁRIO ATUAL
   ========================================================= */

router.get(
  '/me',
  requireAuth,
  async (req, res) => {
    return res.json({
      usuario: req.user,
    });
  }
);

/* =========================================================
   ALTERAR SENHA
   ========================================================= */

router.put(
  '/senha',
  requireAuth,
  async (req, res) => {
    try {
      const senhaAtual = String(
        req.body?.senhaAtual || ''
      );

      const novaSenha = String(
        req.body?.novaSenha || ''
      );

      if (!senhaAtual || !novaSenha) {
        return res.status(400).json({
          erro: 'Informe a senha atual e a nova senha.',
        });
      }

      if (novaSenha.length < 8) {
        return res.status(400).json({
          erro: 'A nova senha precisa ter pelo menos 8 caracteres.',
        });
      }

      const usuario = await sistema
        .prepare(`
          SELECT
            id,
            senha_hash
          FROM usuarios
          WHERE id = ?
        `)
        .get(req.user.id);

      if (!usuario) {
        return res.status(404).json({
          erro: 'Usuário não encontrado.',
        });
      }

      const senhaOk =
        await bcrypt.compare(
          senhaAtual,
          usuario.senha_hash
        );

      if (!senhaOk) {
        return res.status(400).json({
          erro: 'A senha atual está incorreta.',
        });
      }

      const hash =
        await bcrypt.hash(
          novaSenha,
          12
        );

      await sistema
        .prepare(`
          UPDATE usuarios
          SET senha_hash = ?
          WHERE id = ?
        `)
        .run(
          hash,
          req.user.id
        );

      return res.json({
        ok: true,
      });

    } catch (e) {
      console.error(
        'ERRO AO ALTERAR SENHA:',
        e
      );

      return res.status(500).json({
        erro: 'Não foi possível alterar a senha.',
      });
    }
  }
);

/* =========================================================
   LISTAR USUÁRIOS
   ========================================================= */

router.get(
  '/usuarios',
  requireAuth,
  async (req, res, next) => {
    try {
      const usuarios = await db
        .prepare(`
          SELECT
            id,
            nome,
            email,
            papel
          FROM usuarios
          WHERE conta_id = ?
          ORDER BY nome
        `)
        .all(req.user.conta_id);

      return res.json({
        usuarios: usuarios.map((u) => ({
          id: Number(u.id),
          nome: u.nome,
          email: u.email,
          papel: u.papel,
        })),
      });

    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   CRIAR USUÁRIO
   ========================================================= */

router.post(
  '/usuarios',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const nome = String(
        req.body?.nome || ''
      ).trim();

      const email = String(
        req.body?.email || ''
      )
        .trim()
        .toLowerCase();

      const senha = String(
        req.body?.senha || ''
      );

      const papel = String(
        req.body?.papel || 'operador'
      ).trim();

      if (!nome || !email || !senha) {
        return res.status(400).json({
          erro: 'Preencha nome, e-mail e senha.',
        });
      }

      if (senha.length < 8) {
        return res.status(400).json({
          erro: 'A senha precisa ter pelo menos 8 caracteres.',
        });
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return res.status(400).json({
          erro: 'Informe um e-mail válido.',
        });
      }

      const existente = await db
        .prepare(`
          SELECT id
          FROM usuarios
          WHERE lower(email) = lower(?)
            AND conta_id = ?
        `)
        .get(
          email,
          req.user.conta_id
        );

      if (existente) {
        return res.status(409).json({
          erro: 'Este e-mail já está cadastrado nesta conta.',
        });
      }

      const hash =
        await bcrypt.hash(
          senha,
          12
        );

      await db
        .prepare(`
          INSERT INTO usuarios
            (
              conta_id,
              nome,
              email,
              senha_hash,
              papel
            )
          VALUES
            (?, ?, ?, ?, ?)
        `)
        .run(
          req.user.conta_id,
          nome,
          email,
          hash,
          papel
        );

      const usuario = await db
        .prepare(`
          SELECT
            id,
            conta_id,
            nome,
            email,
            papel
          FROM usuarios
          WHERE lower(email) = lower(?)
            AND conta_id = ?
        `)
        .get(
          email,
          req.user.conta_id
        );

      if (!usuario) {
        throw new Error(
          'Não foi possível recuperar o usuário criado.'
        );
      }

      return res.status(201).json({
        ok: true,

        usuario: {
          id: Number(usuario.id),
          conta_id: Number(usuario.conta_id),
          nome: usuario.nome,
          email: usuario.email,
          papel: usuario.papel,
        },
      });

    } catch (e) {
      console.error(
        'ERRO AO CRIAR USUÁRIO:',
        e
      );

      if (e.code === '23505') {
        return res.status(409).json({
          erro: 'Este e-mail já está cadastrado.',
        });
      }

      return res.status(500).json({
        erro:
          `Não foi possível criar o usuário: ${
            e.message ||
            'erro desconhecido'
          }`,
      });
    }
  }
);

/* =========================================================
   EXCLUIR USUÁRIO
   ========================================================= */

router.delete(
  '/usuarios/:id',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(
        req.params.id
      );

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
          erro: 'Usuário inválido.',
        });
      }

      if (
        id === Number(req.user.id)
      ) {
        return res.status(400).json({
          erro: 'Você não pode excluir seu próprio usuário.',
        });
      }

      const usuario = await db
        .prepare(`
          SELECT id
          FROM usuarios
          WHERE id = ?
            AND conta_id = ?
        `)
        .get(
          id,
          req.user.conta_id
        );

      if (!usuario) {
        return res.status(404).json({
          erro: 'Usuário não encontrado.',
        });
      }

      await db
        .prepare(`
          DELETE FROM usuarios
          WHERE id = ?
            AND conta_id = ?
        `)
        .run(
          id,
          req.user.conta_id
        );

      return res.json({
        ok: true,
      });

    } catch (e) {
      console.error(
        'ERRO AO EXCLUIR USUÁRIO:',
        e
      );

      return res.status(500).json({
        erro: 'Não foi possível excluir o usuário.',
      });
    }
  }
);

module.exports = {
  router,
  requireAuth,
  requireAdmin,
  usarConta,
  enviarSessao,
  limparSessao,
};

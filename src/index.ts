import type { Core } from '@strapi/strapi';

export default {
    register(/* { strapi }: { strapi: Core.Strapi } */) {},

    async bootstrap({ strapi }: { strapi: Core.Strapi }) {
      // 0. Siembra de catálogos de la materia (CMS derivado laboral/civil).
      //    Con SEED_MATERIA=laboral|civil en el entorno, siembra al arrancar
      //    decisiones, tipos de acción, estados, categorías y judicaturas desde
      //    data/materia/<materia>.json. Es idempotente (solo crea lo que falta),
      //    así que puede quedar encendida. Corre en segundo plano para no
      //    demorar el arranque.
      if (process.env.SEED_MATERIA) {
        setImmediate(async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { sembrar } = require(require('path').join(process.cwd(), 'scripts', 'seed-materia.js'));
            const r = await sembrar(process.env.SEED_MATERIA, []);
            strapi.log.info(`[seed-materia] ${process.env.SEED_MATERIA}: ${JSON.stringify(r)}`);
          } catch (err) {
            strapi.log.error('[seed-materia] ' + (err as Error).message);
          }
        });
      }

      // 1. Fix Roles and Permissions automatically
      try {
        // Clean/Ensure role names in UTF-8
        const roles = await strapi.query('plugin::users-permissions.role').findMany();
        for (const role of roles) {
          let cleanName = role.name;
          if (role.type === 'solo_lectura') cleanName = 'Solo lectura';
          if (role.type === 'authenticated') cleanName = 'Authenticated';
          if (role.type === 'public') cleanName = 'Public';

          if (role.name !== cleanName) {
            await strapi.query('plugin::users-permissions.role').update({
              where: { id: role.id },
              data: { name: cleanName }
            });
            strapi.log.info(`[bootstrap] Fixed role name: ${cleanName}`);
          }
        }

        // Ensure Editor admin role has permissions to read users-permissions roles
        const editorRole = await strapi.db.query('admin::role').findOne({
          where: { code: 'strapi-editor' }
        });

        if (editorRole) {
          const subjects = ['plugin::users-permissions.role', 'plugin::users-permissions.user'];
          const actions = ['plugin::content-manager.explorer.read', 'plugin::content-manager.explorer.index'];

          for (const subject of subjects) {
            for (const action of actions) {
              const existing = await strapi.db.query('admin::permission').findOne({
                where: { action, subject, role: editorRole.id }
              });

              if (!existing) {
                await strapi.db.query('admin::permission').create({
                  data: { action, subject, role: editorRole.id, properties: {}, conditions: [] }
                });
                strapi.log.info(`[bootstrap] Granted ${action} on ${subject} to Editor role`);
              }
            }
          }
        }
      } catch (err: any) {
        strapi.log.error('Error in bootstrap permission fix: ' + err.message);
      }

      // 2. Login tracking (lastLoginAt, lastActiveAt, loginCount) is now
      //    handled by src/extensions/users-permissions/strapi-server.ts
      //    which overrides the auth controller via Strapi's official
      //    extension mechanism. The previous monkey-patch here was
      //    unreliable in Strapi 5 because controllers are resolved lazily.

      // 2.5 Permisos del content-type favorito.
      // Sin estas entries, las rutas /favoritos/me y /favoritos/toggle
      // (que no tienen auth:false) responden 403 al rol authenticated.
      try {
        const authRole = await strapi
          .query('plugin::users-permissions.role')
          .findOne({ where: { type: 'authenticated' } });
        if (authRole) {
          const favActions = [
            'api::favorito.favorito.mine',
            'api::favorito.favorito.toggle',
          ];
          for (const action of favActions) {
            const exists = await strapi
              .query('plugin::users-permissions.permission')
              .findOne({ where: { action, role: authRole.id } });
            if (!exists) {
              await strapi
                .query('plugin::users-permissions.permission')
                .create({ data: { action, role: authRole.id } });
              strapi.log.info(`[bootstrap] Granted "${action}" to authenticated role`);
            }
          }
        } else {
          strapi.log.warn('[bootstrap] authenticated role not found, favoritos permissions skipped');
        }
      } catch (err: any) {
        strapi.log.error('[bootstrap] Error granting favoritos permissions: ' + err.message);
      }

      // 2.55 Permisos del content-type juego-partida (motor común de juegos:
      // Tribunal Express, Gemelos Divergentes, …). Mismo patrón que favoritos:
      // sin estas entries, /juego-partidas/* responde 403 mudo al rol
      // authenticated aunque el JWT sea válido.
      try {
        const authRole = await strapi
          .query('plugin::users-permissions.role')
          .findOne({ where: { type: 'authenticated' } });
        if (authRole) {
          const juegoActions = [
            'api::juego-partida.juego-partida.crearMia',
            'api::juego-partida.juego-partida.misStats',
            'api::juego-partida.juego-partida.leaderboard',
            'api::juego-partida.juego-partida.recientes',
          ];
          for (const action of juegoActions) {
            const exists = await strapi
              .query('plugin::users-permissions.permission')
              .findOne({ where: { action, role: authRole.id } });
            if (!exists) {
              await strapi
                .query('plugin::users-permissions.permission')
                .create({ data: { action, role: authRole.id } });
              strapi.log.info(`[bootstrap] Granted "${action}" to authenticated role`);
            }
          }
        } else {
          strapi.log.warn('[bootstrap] authenticated role not found, juego-partida permissions skipped');
        }
      } catch (err: any) {
        strapi.log.error('[bootstrap] Error granting juego-partida permissions: ' + err.message);
      }

      // 2.56 Permisos de la Tribuna Tributaria (foro de la comunidad).
      // Mismo patrón que juego-partida: sin estas entries, /tribuna/*
      // responde 403 mudo al rol authenticated aunque el JWT sea válido.
      try {
        const authRole = await strapi
          .query('plugin::users-permissions.role')
          .findOne({ where: { type: 'authenticated' } });
        if (authRole) {
          const tribunaActions = [
            'api::tribuna-tema.tribuna-tema.listar',
            'api::tribuna-tema.tribuna-tema.crear',
            'api::tribuna-tema.tribuna-tema.detalle',
            'api::tribuna-tema.tribuna-tema.silenciar',
            'api::tribuna-tema.tribuna-tema.silenciados',
            'api::tribuna-tema.tribuna-tema.mostrar',
            'api::tribuna-comentario.tribuna-comentario.crear',
            'api::tribuna-denuncia.tribuna-denuncia.crear',
            'api::tribuna-denuncia.tribuna-denuncia.moderacion',
            'api::tribuna-denuncia.tribuna-denuncia.moderar',
          ];
          for (const action of tribunaActions) {
            const exists = await strapi
              .query('plugin::users-permissions.permission')
              .findOne({ where: { action, role: authRole.id } });
            if (!exists) {
              await strapi
                .query('plugin::users-permissions.permission')
                .create({ data: { action, role: authRole.id } });
              strapi.log.info(`[bootstrap] Granted "${action}" to authenticated role`);
            }
          }
        } else {
          strapi.log.warn('[bootstrap] authenticated role not found, tribuna permissions skipped');
        }
      } catch (err: any) {
        strapi.log.error('[bootstrap] Error granting tribuna permissions: ' + err.message);
      }

      // 2.57 Permisos de notificaciones push. Mismo patrón: sin estas
      // entries, /push/* responde 403 mudo al rol authenticated.
      try {
        const authRole = await strapi
          .query('plugin::users-permissions.role')
          .findOne({ where: { type: 'authenticated' } });
        if (authRole) {
          const pushActions = [
            'api::push-dispositivo.push-dispositivo.registrar',
            'api::push-dispositivo.push-dispositivo.baja',
            'api::push-dispositivo.push-dispositivo.preferencias',
            'api::push-dispositivo.push-dispositivo.guardarPreferencias',
            'api::push-dispositivo.push-dispositivo.silenciarTema',
            'api::push-dispositivo.push-dispositivo.notificaciones',
            'api::push-dispositivo.push-dispositivo.marcarLeidas',
            'api::push-dispositivo.push-dispositivo.prueba',
          ];
          for (const action of pushActions) {
            const exists = await strapi
              .query('plugin::users-permissions.permission')
              .findOne({ where: { action, role: authRole.id } });
            if (!exists) {
              await strapi
                .query('plugin::users-permissions.permission')
                .create({ data: { action, role: authRole.id } });
              strapi.log.info(`[bootstrap] Granted "${action}" to authenticated role`);
            }
          }
        } else {
          strapi.log.warn('[bootstrap] authenticated role not found, push permissions skipped');
        }
      } catch (err: any) {
        strapi.log.error('[bootstrap] Error granting push permissions: ' + err.message);
      }

      // 2.58 Permiso de subida de archivos (foto de perfil). El BFF
      // /api/upload-avatar reenvía a /api/upload con el JWT del usuario;
      // sin esta entry el plugin upload responde 403 Forbidden y la app
      // muestra "Upload rechazado por el servidor". Solo `upload` — nada
      // de find/destroy: el usuario sube, no administra la mediateca.
      try {
        const authRole = await strapi
          .query('plugin::users-permissions.role')
          .findOne({ where: { type: 'authenticated' } });
        if (authRole) {
          const action = 'plugin::upload.content-api.upload';
          const exists = await strapi
            .query('plugin::users-permissions.permission')
            .findOne({ where: { action, role: authRole.id } });
          if (!exists) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: authRole.id } });
            strapi.log.info(`[bootstrap] Granted "${action}" to authenticated role`);
          }
        }
      } catch (err: any) {
        strapi.log.error('[bootstrap] Error granting upload permission: ' + err.message);
      }

      // 2.59 Permiso de BORRADO DE LA PROPIA CUENTA.
      //
      // Sin esta entry, POST /api/admin-panel/account/delete responde 403 en
      // 12 ms al rol authenticated aunque el JWT sea válido, y la app dice
      // que no pudo conectarse. Es el requisito de la Guideline 5.1.1(v) de
      // App Store —toda app que deja crear cuenta tiene que dejar borrarla
      // desde dentro— así que un 403 aquí es rechazo automático.
      //
      // Los demás endpoints de admin-panel que usa la app se habilitaron a
      // mano en el panel; este se agregó después y quedó fuera. Va en el
      // bootstrap para que no dependa de que alguien se acuerde.
      try {
        const authRole = await strapi
          .query('plugin::users-permissions.role')
          .findOne({ where: { type: 'authenticated' } });
        if (authRole) {
          const action = 'plugin::admin-panel.controller.deleteOwnAccount';
          const exists = await strapi
            .query('plugin::users-permissions.permission')
            .findOne({ where: { action, role: authRole.id } });
          if (!exists) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: authRole.id } });
            strapi.log.info(`[bootstrap] Granted "${action}" to authenticated role`);
          }
        } else {
          strapi.log.warn('[bootstrap] authenticated role not found, account/delete permission skipped');
        }
      } catch (err: any) {
        strapi.log.error('[bootstrap] Error granting account/delete permission: ' + err.message);
      }

      // 2.6 Permisos de lectura para eventos.
      //
      // - Rol "public": para que la landing pública (sin JWT) liste los eventos
      //   y resuelva el detalle por slug.
      // - Rol "authenticated": para que el panel admin /admin/publicaciones/eventos
      //   pueda listar y leer eventos al editar (fetch con el JWT del admin
      //   pega a /eventos como rol authenticated). Sin esto, el listado del
      //   admin devuelve 403 silente y la tabla queda vacía.
      //
      // Mismo patrón que se documentó para favoritos arriba.
      try {
        const eventoActions = [
          'api::evento.evento.find',
          'api::evento.evento.findOne',
        ];
        const targetRoles: Array<'public' | 'authenticated'> = ['public', 'authenticated'];

        for (const roleType of targetRoles) {
          const role = await strapi
            .query('plugin::users-permissions.role')
            .findOne({ where: { type: roleType } });
          if (!role) {
            strapi.log.warn(`[bootstrap] ${roleType} role not found, evento permissions skipped`);
            continue;
          }
          for (const action of eventoActions) {
            const exists = await strapi
              .query('plugin::users-permissions.permission')
              .findOne({ where: { action, role: role.id } });
            if (!exists) {
              await strapi
                .query('plugin::users-permissions.permission')
                .create({ data: { action, role: role.id } });
              strapi.log.info(`[bootstrap] Granted "${action}" to ${roleType} role`);
            }
          }
        }
      } catch (err: any) {
        strapi.log.error('[bootstrap] Error granting evento permissions: ' + err.message);
      }

      /*
       * 3. CRON — NO SE REGISTRA AQUI. Se registra en config/server.ts, con
       *    `cron: { enabled, tasks }`, que es la via oficial de Strapi 5.
       *
       *    Aqui habia un segundo registro manual con strapi.cron.add(), puesto
       *    por si el de config/server.ts no cargaba. Cargaban LOS DOS, asi que
       *    cada tarea quedaba programada por duplicado y se ejecutaba dos
       *    veces en el mismo instante.
       *
       *    Durante meses no se noto: las tareas que habia eran idempotentes
       *    -refrescar puntuaciones, asegurar particiones- y correrlas dos
       *    veces daba el mismo resultado.
       *
       *    Se noto el 18 de septiembre de 2026, con el correo de lanzamiento:
       *    las dos ejecuciones leian la misma lista de pendientes con
       *    milisegundos de diferencia, ninguna habia registrado todavia su
       *    envio, y las dos mandaban a las mismas once personas. En el log
       *    quedaron los pares:
       *
       *      00:00:34.359  11 enviados, faltan 77
       *      00:00:34.471  11 enviados, faltan 77
       *
       *    88 personas recibieron el correo dos veces, y el ritmo real fue el
       *    doble del configurado: 88 por hora en vez de 44, por encima del
       *    tope de Titan en los planes basicos.
       *
       *    Si algun dia hay que volver a registrar el cron a mano, hay que
       *    quitar `tasks` de config/server.ts en el mismo cambio. Nunca los
       *    dos.
       */
    },
};

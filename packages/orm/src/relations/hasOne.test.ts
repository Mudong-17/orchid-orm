import {
  User,
  Profile,
  BaseTable,
  db,
  useRelationCallback,
  chatData,
  profileData,
  userData,
  messageSelectAll,
  profileSelectAll,
  userSelectAll,
  useTestORM,
  messageData,
  PostTag,
  postTagSelectAll,
  Post,
  postSelectAll,
} from '../test-utils/orm.test-utils';
import { Db, Query } from 'pqb';
import { orchidORM } from '../orm';
import { assertType, expectSql } from 'test-utils';
import { omit } from 'orchid-core';
import { createBaseTable } from '../baseTable';

const ormParams = {
  db: db.$queryBuilder,
};

useTestORM();

describe('hasOne', () => {
  it('should define foreign keys under autoForeignKeys option', () => {
    const BaseTable = createBaseTable({
      autoForeignKeys: {
        onUpdate: 'CASCADE',
      },
    });

    class UserTable extends BaseTable {
      table = 'user';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
      }));

      relations = {
        user: this.hasOne(() => ProfileTable, {
          columns: ['Id'],
          references: ['UserId'],
        }),
        user2: this.hasOne(() => ProfileTable, {
          columns: ['Id'],
          references: ['UserId2'],
          foreignKey: false,
        }),
        user3: this.hasOne(() => ProfileTable, {
          columns: ['Id'],
          references: ['UserId3'],
          foreignKey: {
            onDelete: 'CASCADE',
          },
        }),
      };
    }

    class ProfileTable extends BaseTable {
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
        UserId: t.name('user_id').integer(),
        UserId2: t.name('user_id_2').integer(),
        UserId3: t.name('user_id_3').integer(),
      }));
    }

    const db = orchidORM(ormParams, { user: UserTable, profile: ProfileTable });
    expect(db.profile.internal.tableData.constraints).toEqual([
      {
        references: {
          columns: ['UserId'],
          fnOrTable: 'user',
          foreignColumns: ['Id'],
          options: { onUpdate: 'CASCADE' },
        },
      },
      {
        references: {
          columns: ['UserId3'],
          fnOrTable: 'user',
          foreignColumns: ['Id'],
          options: { onDelete: 'CASCADE' },
        },
      },
    ]);
  });

  describe('querying', () => {
    it('should support `queryRelated` to query related data', async () => {
      const UserId = await db.user.get('Id').create(userData);

      await db.profile.create({ ...profileData, UserId });

      const user = await db.user.find(UserId);
      const query = db.user.queryRelated('profile', user);

      expectSql(
        query.toSQL(),
        `
        SELECT ${profileSelectAll} FROM "profile"
        WHERE "profile"."user_id" = $1
          AND "profile"."profile_key" = $2
      `,
        [UserId, 'key'],
      );

      const profile = await query;

      expect(profile).toMatchObject(profileData);
    });

    it('should handle chained query', () => {
      const query = db.user
        .where({ Name: 'name' })
        .chain('profile')
        .where({ Bio: 'bio' });

      expectSql(
        query.toSQL(),
        `
          SELECT ${profileSelectAll} FROM "profile"
          WHERE EXISTS (
              SELECT 1 FROM "user"
              WHERE "user"."name" = $1
                AND "user"."id" = "profile"."user_id"
            AND "user"."user_key" = "profile"."profile_key"
            )
            AND "profile"."bio" = $2
        `,
        ['name', 'bio'],
      );
    });

    it('should handle long chained query', () => {
      const q = db.user
        .where({ Name: 'name' })
        .chain('onePost')
        .where({ Body: 'body' })
        .chain('onePostTag')
        .where({ Tag: 'tag' });

      assertType<Awaited<typeof q>, PostTag[]>();

      expectSql(
        q.toSQL(),
        `
          SELECT ${postTagSelectAll}
          FROM "postTag" "onePostTag"
          WHERE
            EXISTS (
              SELECT 1
              FROM "post" AS "onePost"
              WHERE
                EXISTS (
                  SELECT 1
                  FROM "user"
                  WHERE "user"."name" = $1
                    AND "user"."id" = "onePost"."user_id"
                    AND "user"."user_key" = "onePost"."title"
                )
                AND "onePost"."body" = $2
                AND "onePost"."id" = "onePostTag"."post_id"
            )
            AND "onePostTag"."tag" = $3
        `,
        ['name', 'body', 'tag'],
      );
    });

    it('should have create with defaults of provided id', () => {
      const user = { Id: 1, UserKey: 'key' };
      const now = new Date();

      const query = db.user.queryRelated('profile', user).insert({
        Bio: 'bio',
        updatedAt: now,
        createdAt: now,
      });

      expectSql(
        query.toSQL(),
        `
        INSERT INTO "profile"("user_id", "profile_key", "bio", "updated_at", "created_at")
        VALUES ($1, $2, $3, $4, $5)
      `,
        [1, 'key', 'bio', now, now],
      );
    });

    it('can create after calling `queryRelated`', async () => {
      const Id = await db.user.get('Id').create(userData);
      const now = new Date();
      await db.user.queryRelated('profile', { Id, UserKey: 'key' }).create({
        UserId: Id,
        Bio: 'bio',
        updatedAt: now,
        createdAt: now,
      });
    });

    describe('chained create', () => {
      it('should have create based on find query', () => {
        const query = db.user.find(1).chain('profile').create({
          Bio: 'bio',
        });

        expectSql(
          query.toSQL(),
          `
            INSERT INTO "profile"("user_id", "profile_key", "bio")
            SELECT "user"."id" "UserId", "user"."user_key" "ProfileKey", $1
            FROM "user"
            WHERE "user"."id" = $2
            LIMIT 1
            RETURNING ${profileSelectAll}
          `,
          ['bio', 1],
        );
      });

      it('should throw when the main query returns many records', async () => {
        await expect(
          async () =>
            await db.user.chain('profile').create({
              Bio: 'bio',
            }),
        ).rejects.toThrow(
          'Cannot create based on a query which returns multiple records',
        );
      });

      it('should throw when main record is not found', async () => {
        const q = db.user.find(1).chain('profile').create({
          Bio: 'bio',
        });

        await expect(q).rejects.toThrow('Record is not found');
      });

      it('should not throw when searching with findOptional', async () => {
        await db.user.findOptional(1).chain('profile').takeOptional().create({
          Bio: 'bio',
        });
      });
    });

    describe('chained delete', () => {
      it('should delete relation records', () => {
        const query = db.user
          .where({ Name: 'name' })
          .chain('profile')
          .where({ Bio: 'bio' })
          .delete();

        expectSql(
          query.toSQL(),
          `
            DELETE FROM "profile"
            WHERE EXISTS (
                SELECT 1 FROM "user"
                WHERE "user"."name" = $1
                  AND "user"."id" = "profile"."user_id"
              AND "user"."user_key" = "profile"."profile_key"
              )
              AND "profile"."bio" = $2
          `,
          ['name', 'bio'],
        );
      });
    });

    it('should have proper joinQuery', () => {
      expectSql(
        (
          db.user.relations.profile.relationConfig.joinQuery(
            db.profile.as('p'),
            db.user.as('u'),
          ) as Query
        ).toSQL(),
        `
          SELECT ${profileSelectAll} FROM "profile" "p"
          WHERE "p"."user_id" = "u"."id"
            AND "p"."profile_key" = "u"."user_key"
        `,
      );
    });

    it('should be supported in whereExists', () => {
      expectSql(
        db.user.as('u').whereExists('profile').toSQL(),
        `
        SELECT ${userSelectAll} FROM "user" "u"
        WHERE EXISTS (
          SELECT 1 FROM "profile"
          WHERE "profile"."user_id" = "u"."id"
          AND "profile"."profile_key" = "u"."user_key"
        )
      `,
      );

      expectSql(
        db.user
          .as('u')
          .whereExists((q) => q.profile.where({ Bio: 'bio' }))
          .toSQL(),
        `
            SELECT ${userSelectAll} FROM "user" "u"
            WHERE EXISTS (
              SELECT 1 FROM "profile"
              WHERE "profile"."bio" = $1
                AND "profile"."user_id" = "u"."id"
                AND "profile"."profile_key" = "u"."user_key"
            )
          `,
        ['bio'],
      );

      expectSql(
        db.user
          .as('u')
          .whereExists('profile', (q) => q.where({ 'profile.Bio': 'bio' }))
          .toSQL(),
        `
          SELECT ${userSelectAll} FROM "user" "u"
          WHERE EXISTS (
            SELECT 1 FROM "profile"
            WHERE "profile"."user_id" = "u"."id"
              AND "profile"."profile_key" = "u"."user_key"
              AND "profile"."bio" = $1
          )
        `,
        ['bio'],
      );
    });

    it('should be supported in join', () => {
      const query = db.user
        .as('u')
        .join('profile', (q) => q.where({ Bio: 'bio' }))
        .select('Name', 'profile.Bio');

      assertType<
        Awaited<typeof query>,
        { Name: string; Bio: string | null }[]
      >();

      expectSql(
        query.toSQL(),
        `
        SELECT "u"."name" "Name", "profile"."bio" "Bio"
        FROM "user" "u"
        JOIN "profile"
          ON "profile"."user_id" = "u"."id"
               AND "profile"."profile_key" = "u"."user_key"
         AND "profile"."bio" = $1
      `,
        ['bio'],
      );
    });

    it('should be supported in join with a callback', () => {
      const query = db.user
        .as('u')
        .join(
          (q) => q.profile.as('p').where({ UserId: 123 }),
          (q) => q.where({ Bio: 'bio' }),
        )
        .select('Name', 'p.Bio');

      assertType<
        Awaited<typeof query>,
        { Name: string; Bio: string | null }[]
      >();

      expectSql(
        query.toSQL(),
        `
        SELECT "u"."name" "Name", "p"."bio" "Bio"
        FROM "user" "u"
        JOIN "profile" AS "p"
          ON "p"."bio" = $1
          AND "p"."user_id" = $2
          AND "p"."user_id" = "u"."id"
          AND "p"."profile_key" = "u"."user_key"
      `,
        ['bio', 123],
      );
    });

    it('should be supported in joinLateral', () => {
      const q = db.user
        .joinLateral('profile', (q) => q.as('p').where({ Bio: 'one' }))
        .where({ 'p.Bio': 'two' })
        .select('Name', 'p.*');

      assertType<Awaited<typeof q>, { Name: string; p: Profile }[]>();

      expectSql(
        q.toSQL(),
        `
          SELECT "user"."name" "Name", row_to_json("p".*) "p"
          FROM "user"
          JOIN LATERAL (
            SELECT ${profileSelectAll}
            FROM "profile" "p"
            WHERE "p"."bio" = $1
              AND "p"."user_id" = "user"."id"
              AND "p"."profile_key" = "user"."user_key"
          ) "p" ON true
          WHERE "p"."Bio" = $2
        `,
        ['one', 'two'],
      );
    });

    describe('select', () => {
      it('should be selectable', () => {
        const query = db.user
          .as('u')
          .select('Id', {
            profile: (q) => q.profile.where({ Bio: 'bio' }),
          })
          .order('profile.Bio');

        assertType<Awaited<typeof query>, { Id: number; profile: Profile }[]>();

        expectSql(
          query.toSQL(),
          `
            SELECT
              "u"."id" "Id",
              row_to_json("profile".*) "profile"
            FROM "user" "u"
            LEFT JOIN LATERAL (
              SELECT ${profileSelectAll}
              FROM "profile"
              WHERE "profile"."bio" = $1
                AND "profile"."user_id" = "u"."id"
                AND "profile"."profile_key" = "u"."user_key"
            ) "profile" ON true
            ORDER BY "profile"."Bio" ASC
          `,
          ['bio'],
        );
      });

      it('should support chained select', () => {
        const q = db.user.select({
          items: (q) => q.onePost.chain('onePostTag'),
        });

        assertType<Awaited<typeof q>, { items: PostTag[] }[]>();

        expectSql(
          q.toSQL(),
          `
            SELECT COALESCE("items".r, '[]') "items"
            FROM "user"
            LEFT JOIN LATERAL (
              SELECT json_agg(row_to_json("t".*)) r
              FROM (
                SELECT ${postTagSelectAll}
                FROM "postTag" "onePostTag"
                WHERE EXISTS (
                  SELECT 1
                  FROM "post" AS "onePost"
                  WHERE "onePost"."user_id" = "user"."id"
                    AND "onePost"."title" = "user"."user_key"
                    AND "onePost"."id" = "onePostTag"."post_id"
                )
              ) "t"
            ) "items" ON true
          `,
        );
      });

      it('should handle exists sub query', () => {
        const query = db.user.as('u').select('Id', {
          hasProfile: (q) => q.profile.exists(),
        });

        assertType<
          Awaited<typeof query>,
          { Id: number; hasProfile: boolean }[]
        >();

        expectSql(
          query.toSQL(),
          `
            SELECT
              "u"."id" "Id",
              COALESCE("hasProfile".r, false) "hasProfile"
            FROM "user" "u"
            LEFT JOIN LATERAL (
              SELECT true r
              FROM "profile"
              WHERE "profile"."user_id" = "u"."id"
              AND "profile"."profile_key" = "u"."user_key"
            ) "hasProfile" ON true
          `,
        );
      });

      it('should support recurring select', () => {
        const q = db.user.select({
          profile: (q) =>
            q.profile.select({
              user: (q) =>
                q.user
                  .select({
                    profile: (q) => q.profile,
                  })
                  .where({ 'profile.Bio': 'bio' }),
            }),
        });

        expectSql(
          q.toSQL(),
          `
            SELECT row_to_json("profile".*) "profile"
            FROM "user"
            LEFT JOIN LATERAL (
              SELECT row_to_json("user2".*) "user"
              FROM "profile"
              LEFT JOIN LATERAL (
                SELECT row_to_json("profile2".*) "profile"
                FROM "user" "user2"
                LEFT JOIN LATERAL (
                  SELECT ${profileSelectAll}
                  FROM "profile" "profile2"
                  WHERE "profile2"."user_id" = "user2"."id"
                    AND "profile2"."profile_key" = "user2"."user_key"
                ) "profile2" ON true
                WHERE "profile2"."Bio" = $1
                  AND "user2"."id" = "profile"."user_id"
                  AND "user2"."user_key" = "profile"."profile_key"
              ) "user2" ON true
              WHERE "profile"."user_id" = "user"."id"
                AND "profile"."profile_key" = "user"."user_key"
            ) "profile" ON true
          `,
          ['bio'],
        );
      });

      it('should be selectable for update', () => {
        const q = db.profile.all().update({
          Bio: (q) => q.user.get('Name'),
        });

        expectSql(
          q.toSQL(),
          `
            UPDATE "profile"
            SET
              "bio" = (
                SELECT "user"."name"
                FROM "user"
                WHERE "user"."id" = "profile"."user_id"
                  AND "user"."user_key" = "profile"."profile_key"
              ),
              "updated_at" = now()
          `,
        );
      });
    });
  });

  describe('create', () => {
    const checkUserAndProfile = ({
      user,
      profile,
      Name,
      Bio,
    }: {
      user: User;
      profile: Profile;
      Name: string;
      Bio: string;
    }) => {
      expect(user).toEqual({
        ...omit(userData, ['Password']),
        Id: user.Id,
        Name,
        Active: null,
        Age: null,
        Data: null,
        Picture: null,
      });

      expect(profile).toMatchObject({
        Id: profile.Id,
        Bio,
        UserId: user.Id,
      });
    };

    describe('nested create', () => {
      it('should support create', async () => {
        const q = db.user.create({
          ...userData,
          Name: 'user',
          profile: {
            create: {
              ...profileData,
              Bio: 'profile',
            },
          },
        });

        const user = await q;
        const profile = await db.profile.findBy({ UserId: user.Id });

        checkUserAndProfile({ user, profile, Name: 'user', Bio: 'profile' });
      });

      it('should support create many', async () => {
        const query = db.user.createMany([
          {
            ...userData,
            Name: 'user 1',
            profile: {
              create: {
                ...profileData,
                Bio: 'profile 1',
              },
            },
          },
          {
            ...userData,
            Name: 'user 2',
            profile: {
              create: {
                ...profileData,
                Bio: 'profile 2',
              },
            },
          },
        ]);

        const users = await query;
        const profiles = await db.profile
          .where({
            UserId: { in: users.map((user) => user.Id) },
          })
          .order('Id');

        checkUserAndProfile({
          user: users[0],
          profile: profiles[0],
          Name: 'user 1',
          Bio: 'profile 1',
        });

        checkUserAndProfile({
          user: users[1],
          profile: profiles[1],
          Name: 'user 2',
          Bio: 'profile 2',
        });
      });

      describe('relation callbacks', () => {
        const { beforeCreate, afterCreate, resetMocks } = useRelationCallback(
          db.user.relations.profile,
          ['Id'],
        );

        it('should invoke callbacks', async () => {
          await db.user.create({
            ...userData,
            profile: {
              create: profileData,
            },
          });

          expect(beforeCreate).toHaveBeenCalledTimes(1);
          expect(afterCreate).toHaveBeenCalledTimes(1);
          expect(afterCreate).toBeCalledWith(
            [{ Id: expect.any(Number) }],
            expect.any(Db),
          );
        });

        it('should invoke callbacks in a batch create', async () => {
          resetMocks();

          await db.user.createMany([
            {
              ...userData,
              profile: {
                create: profileData,
              },
            },
            {
              ...userData,
              profile: {
                create: profileData,
              },
            },
          ]);

          expect(beforeCreate).toHaveBeenCalledTimes(1);
          expect(afterCreate).toHaveBeenCalledTimes(1);
          expect(afterCreate).toBeCalledWith(
            [{ Id: expect.any(Number) }, { Id: expect.any(Number) }],
            expect.any(Db),
          );
        });
      });
    });

    describe('nested connect', () => {
      it('should support connect', async () => {
        await db.profile.create({
          Bio: 'profile',
          user: {
            create: {
              ...userData,
              Name: 'tmp',
            },
          },
        });

        const query = db.user.create({
          ...userData,
          Name: 'user',
          profile: {
            connect: { Bio: 'profile' },
          },
        });

        const user = await query;
        const profile = await db.user.queryRelated('profile', user);

        checkUserAndProfile({ user, profile, Name: 'user', Bio: 'profile' });
      });

      it('should support connect many', async () => {
        await db.profile.createMany([
          {
            Bio: 'profile 1',
            user: {
              create: {
                ...userData,
                Name: 'tmp',
              },
            },
          },
          {
            Bio: 'profile 2',
            user: {
              connect: { Name: 'tmp' },
            },
          },
        ]);

        const query = db.user.createMany([
          {
            ...userData,
            Name: 'user 1',
            profile: {
              connect: { Bio: 'profile 1' },
            },
          },
          {
            ...userData,
            Name: 'user 2',
            profile: {
              connect: { Bio: 'profile 2' },
            },
          },
        ]);

        const users = await query;
        const profiles = await db.profile
          .where({
            UserId: { in: users.map((user) => user.Id) },
          })
          .order('Id');

        checkUserAndProfile({
          user: users[0],
          profile: profiles[0],
          Name: 'user 1',
          Bio: 'profile 1',
        });

        checkUserAndProfile({
          user: users[1],
          profile: profiles[1],
          Name: 'user 2',
          Bio: 'profile 2',
        });
      });

      describe('relation callbacks', () => {
        const { beforeUpdate, afterUpdate, resetMocks } = useRelationCallback(
          db.user.relations.profile,
          ['Id'],
        );

        it('should invoke callbacks', async () => {
          const profileId = await db.profile.get('Id').create(profileData);

          await db.user.insert({
            ...userData,
            profile: {
              connect: { Id: profileId },
            },
          });

          expect(beforeUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toBeCalledWith(
            [{ Id: profileId }],
            expect.any(Db),
          );
        });

        it('should invoke callbacks in a batch create', async () => {
          resetMocks();

          const ids = await db.profile
            .pluck('Id')
            .createMany([profileData, profileData]);

          await db.user.createMany([
            {
              ...userData,
              profile: {
                connect: { Id: ids[0] },
              },
            },
            {
              ...userData,
              profile: {
                connect: { Id: ids[1] },
              },
            },
          ]);

          expect(beforeUpdate).toHaveBeenCalledTimes(2);
          expect(afterUpdate).toHaveBeenCalledTimes(2);
          expect(afterUpdate.mock.calls).toEqual([
            [[{ Id: ids[0] }], expect.any(Db)],
            [[{ Id: ids[1] }], expect.any(Db)],
          ]);
        });
      });
    });

    describe('connect or create', () => {
      it('should support connect or create', async () => {
        const profileId = await db.profile.get('Id').create({
          Bio: 'profile 1',
          user: {
            create: {
              ...userData,
              Name: 'tmp',
            },
          },
        });

        const user1 = await db.user.create({
          ...userData,
          Name: 'user 1',
          profile: {
            connectOrCreate: {
              where: { Bio: 'profile 1' },
              create: { ...profileData, Bio: 'profile 1' },
            },
          },
        });

        const user2 = await db.user.create({
          ...userData,
          Name: 'user 2',
          profile: {
            connectOrCreate: {
              where: { Bio: 'profile 2' },
              create: { ...profileData, Bio: 'profile 2' },
            },
          },
        });

        const profile1 = await db.user.queryRelated('profile', user1);
        expect(profile1.Id).toBe(profileId);
        checkUserAndProfile({
          user: user1,
          profile: profile1,
          Name: 'user 1',
          Bio: 'profile 1',
        });

        const profile2 = await db.user.queryRelated('profile', user2);
        checkUserAndProfile({
          user: user2,
          profile: profile2,
          Name: 'user 2',
          Bio: 'profile 2',
        });
      });

      it('should support connect or create many', async () => {
        const profileId = await db.profile.get('Id').create({
          Bio: 'profile 1',
          user: {
            create: {
              ...userData,
              Name: 'tmp',
            },
          },
        });

        const [user1, user2] = await db.user.createMany([
          {
            ...userData,
            Name: 'user 1',
            profile: {
              connectOrCreate: {
                where: { Bio: 'profile 1' },
                create: { ...profileData, Bio: 'profile 1' },
              },
            },
          },
          {
            ...userData,
            Name: 'user 2',
            profile: {
              connectOrCreate: {
                where: { Bio: 'profile 2' },
                create: { ...profileData, Bio: 'profile 2' },
              },
            },
          },
        ]);

        const profile1 = await db.user.queryRelated('profile', user1);
        expect(profile1.Id).toBe(profileId);
        checkUserAndProfile({
          user: user1,
          profile: profile1,
          Name: 'user 1',
          Bio: 'profile 1',
        });

        const profile2 = await db.user.queryRelated('profile', user2);
        checkUserAndProfile({
          user: user2,
          profile: profile2,
          Name: 'user 2',
          Bio: 'profile 2',
        });
      });
    });

    describe('relation callbacks', () => {
      const {
        beforeUpdate,
        afterUpdate,
        beforeCreate,
        afterCreate,
        resetMocks,
      } = useRelationCallback(db.user.relations.profile, ['Id']);

      it('should invoke callbacks when connecting', async () => {
        const Id = await db.profile.get('Id').create(profileData);

        await db.user.create({
          ...userData,
          profile: {
            connectOrCreate: {
              where: { Id },
              create: profileData,
            },
          },
        });

        expect(beforeUpdate).toHaveBeenCalledTimes(1);
        expect(afterUpdate).toHaveBeenCalledTimes(1);
        expect(afterUpdate).toBeCalledWith([{ Id }], expect.any(Db));
      });

      it('should invoke callbacks when creating', async () => {
        await db.user.create({
          ...userData,
          profile: {
            connectOrCreate: {
              where: { Id: 0 },
              create: profileData,
            },
          },
        });

        const Id = await db.profile.take().get('Id');

        expect(beforeCreate).toHaveBeenCalledTimes(1);
        expect(afterCreate).toHaveBeenCalledTimes(1);
        expect(afterCreate).toBeCalledWith([{ Id }], expect.any(Db));
      });

      it('should invoke callbacks in a batch create', async () => {
        resetMocks();

        const Id = await db.profile.get('Id').create(profileData);

        await db.user.createMany([
          {
            ...userData,
            profile: {
              connectOrCreate: {
                where: { Id: 0 },
                create: profileData,
              },
            },
          },
          {
            ...userData,
            profile: {
              connectOrCreate: {
                where: { Id },
                create: profileData,
              },
            },
          },
        ]);

        const ids = await db.profile.pluck('Id');

        expect(beforeUpdate).toHaveBeenCalledTimes(2);
        expect(afterUpdate).toHaveBeenCalledTimes(1);
        expect(afterUpdate).toBeCalledWith([{ Id: ids[0] }], expect.any(Db));

        expect(beforeCreate).toHaveBeenCalledTimes(1);
        expect(afterCreate).toHaveBeenCalledTimes(1);
        expect(afterCreate).toBeCalledWith([{ Id: ids[1] }], expect.any(Db));
      });
    });
  });

  describe('update', () => {
    describe('disconnect', () => {
      it('should nullify foreignKey', async () => {
        const user = await db.user.create({
          ...userData,
          profile: { create: profileData },
        });

        const { Id: profileId } = await db.user.queryRelated('profile', user);

        const Id = await db.user
          .get('Id')
          .where(user)
          .update({
            profile: {
              disconnect: true,
            },
          });

        expect(Id).toBe(user.Id);

        const profile = await db.profile.find(profileId);
        expect(profile.UserId).toBe(null);
      });

      it('should nullify foreignKey in batch update', async () => {
        const userIds = await db.user.pluck('Id').createMany([
          { ...userData, profile: { create: profileData } },
          { ...userData, profile: { create: profileData } },
        ]);

        const profileIds = await db.profile.pluck('Id').where({
          UserId: { in: userIds },
        });

        await db.user.where({ Id: { in: userIds } }).update({
          profile: {
            disconnect: true,
          },
        });

        const updatedUserIds = await db.profile
          .pluck('UserId')
          .where({ Id: { in: profileIds } });
        expect(updatedUserIds).toEqual([null, null]);
      });

      describe('relation callbacks', () => {
        const { beforeUpdate, afterUpdate, resetMocks } = useRelationCallback(
          db.user.relations.profile,
          ['Id'],
        );

        it('should invoke callbacks', async () => {
          const { Id, UserId } = await db.profile
            .select('Id', 'UserId')
            .create({
              user: { create: userData },
            });

          await db.user.find(UserId as number).update({
            profile: {
              disconnect: true,
            },
          });

          expect(beforeUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toBeCalledWith([{ Id: Id }], expect.any(Db));
        });

        it('should invoke callbacks in a batch update', async () => {
          resetMocks();

          const userIds = await db.user.pluck('Id').createMany([
            {
              ...userData,
              profile: { create: profileData },
            },
            {
              ...userData,
              profile: { create: profileData },
            },
          ]);

          await db.user.where({ Id: { in: userIds } }).update({
            profile: {
              disconnect: true,
            },
          });

          const ids = await db.profile.pluck('Id');

          expect(beforeUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toBeCalledWith(
            [{ Id: ids[0] }, { Id: ids[1] }],
            expect.any(Db),
          );
        });
      });
    });

    describe('set', () => {
      it('should nullify foreignKey of previous related record and set foreignKey to new related record', async () => {
        const Id = await db.user.get('Id').create(userData);

        const [{ Id: profile1Id }, { Id: profile2Id }] = await db.profile
          .select('Id')
          .createMany([{ ...profileData, UserId: Id }, { ...profileData }]);

        await db.user.find(Id).update({
          profile: {
            set: { Id: profile2Id },
          },
        });

        const profile1 = await db.profile.find(profile1Id);
        expect(profile1.UserId).toBe(null);

        const profile2 = await db.profile.find(profile2Id);
        expect(profile2.UserId).toBe(Id);
      });

      it('should throw in batch update', async () => {
        expect(() =>
          db.user.where({ Id: { in: [1, 2, 3] } }).update({
            profile: {
              // @ts-expect-error not allows in batch update
              set: { Id: 1 },
            },
          }),
        ).toThrow('`set` option is not allowed in a batch update');
      });

      describe('relation callbacks', () => {
        const { beforeUpdate, afterUpdate } = useRelationCallback(
          db.user.relations.profile,
          ['Id'],
        );

        it('should invoke callbacks', async () => {
          const { Id: prevId, UserId } = await db.profile
            .select('Id', 'UserId')
            .create({ Bio: 'bio', user: { create: userData } });

          const newId = await db.profile.get('Id').create(profileData);

          await db.user.find(UserId as number).update({
            profile: {
              set: { Id: newId },
            },
          });

          expect(beforeUpdate).toHaveBeenCalledTimes(2);
          expect(afterUpdate).toHaveBeenCalledTimes(2);
          expect(afterUpdate).toBeCalledWith([{ Id: prevId }], expect.any(Db));
          expect(afterUpdate).toBeCalledWith([{ Id: newId }], expect.any(Db));
        });
      });
    });

    describe('delete', () => {
      it('should delete related record', async () => {
        const Id = await db.user
          .get('Id')
          .create({ ...userData, profile: { create: profileData } });

        const { Id: profileId } = await db.user
          .queryRelated('profile', { Id, UserKey: 'key' })
          .select('Id')
          .take();

        await db.user.find(Id).update({
          profile: {
            delete: true,
          },
        });

        const profile = await db.profile.findByOptional({ Id: profileId });
        expect(profile).toBe(undefined);
      });

      it('should delete related record in batch update', async () => {
        const userIds = await db.user.pluck('Id').createMany([
          { ...userData, profile: { create: profileData } },
          { ...userData, profile: { create: profileData } },
        ]);

        await db.user.where({ Id: { in: userIds } }).update({
          profile: {
            delete: true,
          },
        });

        const count = await db.profile.count();
        expect(count).toBe(0);
      });

      describe('relation callbacks', () => {
        const { beforeDelete, afterDelete, resetMocks } = useRelationCallback(
          db.user.relations.profile,
          ['Id'],
        );

        it('should invoke callbacks', async () => {
          const { Id, UserId } = await db.profile
            .select('Id', 'UserId')
            .create({ Bio: 'bio', user: { create: userData } });

          await db.user.find(UserId as number).update({
            profile: {
              delete: true,
            },
          });

          expect(beforeDelete).toHaveBeenCalledTimes(1);
          expect(afterDelete).toHaveBeenCalledTimes(1);
          expect(afterDelete).toBeCalledWith([{ Id }], expect.any(Db));
        });

        it('should invoke callbacks in a batch update', async () => {
          resetMocks();

          const data = await db.profile.select('Id', 'UserId').createMany([
            { Bio: 'bio', user: { create: userData } },
            { Bio: 'bio', user: { create: userData } },
          ]);

          await db.user
            .where({ Id: { in: data.map((p) => p.UserId as number) } })
            .update({
              profile: {
                delete: true,
              },
            });

          expect(beforeDelete).toHaveBeenCalledTimes(1);
          expect(afterDelete).toHaveBeenCalledTimes(1);
          expect(afterDelete).toBeCalledWith(
            [{ Id: data[0].Id }, { Id: data[1].Id }],
            expect.any(Db),
          );
        });
      });
    });

    describe('nested update', () => {
      it('should update related record', async () => {
        const Id = await db.user
          .get('Id')
          .create({ ...userData, profile: { create: profileData } });

        await db.user.find(Id).update({
          profile: {
            update: {
              Bio: 'updated',
            },
          },
        });

        const profile = await db.user
          .queryRelated('profile', { Id, UserKey: 'key' })
          .take();
        expect(profile.Bio).toBe('updated');
      });

      it('should update related record in batch update', async () => {
        const userIds = await db.user.pluck('Id').createMany([
          { ...userData, profile: { create: profileData } },
          { ...userData, profile: { create: profileData } },
        ]);

        await db.user.where({ Id: { in: userIds } }).update({
          profile: {
            update: {
              Bio: 'updated',
            },
          },
        });

        const bios = await db.profile.pluck('Bio');
        expect(bios).toEqual(['updated', 'updated']);
      });

      describe('relation callbacks', () => {
        const { beforeUpdate, afterUpdate, resetMocks } = useRelationCallback(
          db.user.relations.profile,
          ['Id'],
        );

        it('should invoke callbacks', async () => {
          const { Id, UserId } = await db.profile
            .select('Id', 'UserId')
            .create({ Bio: 'bio', user: { create: userData } });

          await db.user.find(UserId as number).update({
            profile: {
              update: {
                Bio: 'updated',
              },
            },
          });

          expect(beforeUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toBeCalledWith([{ Id }], expect.any(Db));
        });

        it('should invoke callbacks in a batch update', async () => {
          resetMocks();

          const data = await db.profile.select('Id', 'UserId').createMany([
            { Bio: 'bio', user: { create: userData } },
            { Bio: 'bio', user: { create: userData } },
          ]);

          await db.user
            .where({ Id: { in: data.map((p) => p.UserId as number) } })
            .update({
              profile: {
                update: {
                  Bio: 'updated',
                },
              },
            });

          expect(beforeUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toBeCalledWith(
            [{ Id: data[0].Id }, { Id: data[1].Id }],
            expect.any(Db),
          );
        });
      });
    });

    describe('nested upsert', () => {
      it('should update related record if it exists', async () => {
        const user = await db.user.create({
          ...userData,
          profile: { create: profileData },
        });

        await db.user.find(user.Id).update({
          profile: {
            upsert: {
              update: {
                Bio: 'updated',
              },
              create: profileData,
            },
          },
        });

        const profile = await db.user.queryRelated('profile', user);
        expect(profile.Bio).toBe('updated');
      });

      it('should create related record if it does not exists', async () => {
        const user = await db.user.create(userData);

        await db.user.find(user.Id).update({
          profile: {
            upsert: {
              update: {
                Bio: 'updated',
              },
              create: {
                ...profileData,
                Bio: 'created',
              },
            },
          },
        });

        const profile = await db.user.queryRelated('profile', user);
        expect(profile.Bio).toBe('created');
      });

      it('should create related record if it does not exists with a data from a callback', async () => {
        const user = await db.user.create(userData);

        await db.user.find(user.Id).update({
          profile: {
            upsert: {
              update: {
                Bio: 'updated',
              },
              create: () => ({
                ...profileData,
                Bio: 'created',
              }),
            },
          },
        });

        const profile = await db.user.queryRelated('profile', user);
        expect(profile.Bio).toBe('created');
      });

      it('should throw in batch update', async () => {
        expect(() =>
          db.user.where({ Id: { in: [1, 2, 3] } }).update({
            profile: {
              // @ts-expect-error not allows in batch update
              upsert: {
                update: {
                  Bio: 'updated',
                },
                create: {
                  ...profileData,
                  Bio: 'created',
                },
              },
            },
          }),
        ).toThrow('`upsert` option is not allowed in a batch update');
      });

      describe('relation callbacks', () => {
        const {
          beforeUpdate,
          afterUpdate,
          beforeCreate,
          afterCreate,
          resetMocks,
        } = useRelationCallback(db.user.relations.profile, ['Id']);

        it('should invoke callbacks when connecting', async () => {
          const { Id, UserId } = await db.profile
            .select('Id', 'UserId')
            .create({ Bio: 'bio', user: { create: userData } });

          await db.user.find(UserId as number).update({
            profile: {
              upsert: {
                update: {
                  Bio: 'updated',
                },
                create: profileData,
              },
            },
          });

          expect(beforeUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toBeCalledWith(
            [{ Id, UserId, ProfileKey: 'key' }],
            expect.any(Db),
          );
        });

        it('should invoke callbacks when creating', async () => {
          resetMocks();

          const userId = await db.user.get('Id').create(userData);

          await db.user.find(userId).update({
            profile: {
              upsert: {
                update: {
                  Bio: 'updated',
                },
                create: profileData,
              },
            },
          });

          const profile = await db.profile.take();

          expect(beforeCreate).toHaveBeenCalledTimes(1);
          expect(afterCreate).toHaveBeenCalledTimes(1);
          expect(afterCreate).toHaveBeenCalledWith([profile], expect.any(Db));
        });
      });
    });

    describe('nested create', () => {
      it('should create new related record', async () => {
        const userId = await db.user
          .get('Id')
          .create({ ...userData, profile: { create: profileData } });

        const previousProfileId = await db.user
          .queryRelated('profile', { Id: userId, UserKey: 'key' })
          .get('Id');

        const updated = await db.user
          .selectAll()
          .find(userId)
          .update({
            profile: {
              create: { ...profileData, Bio: 'created' },
            },
          });

        const previousProfile = await db.profile.find(previousProfileId);
        expect(previousProfile.UserId).toBe(null);

        const profile = await db.user.queryRelated('profile', updated);
        expect(profile.Bio).toBe('created');
      });

      it('should throw in batch update', async () => {
        expect(() =>
          db.user.where({ Id: { in: [1, 2, 3] } }).update({
            profile: {
              // @ts-expect-error not allows in batch update
              create: {
                ...profileData,
                Bio: 'created',
              },
            },
          }),
        ).toThrow('`create` option is not allowed in a batch update');
      });

      describe('relation callbacks', () => {
        const {
          beforeUpdate,
          afterUpdate,
          beforeCreate,
          afterCreate,
          resetMocks,
        } = useRelationCallback(db.user.relations.profile, ['Id']);

        it('should invoke callbacks to disconnect previous and create new', async () => {
          const { Id, UserId } = await db.profile
            .select('Id', 'UserId')
            .create({ Bio: 'bio', user: { create: userData } });

          resetMocks();

          await db.user.find(UserId as number).update({
            profile: {
              create: profileData,
            },
          });

          expect(beforeUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toHaveBeenCalledTimes(1);
          expect(afterUpdate).toHaveBeenCalledWith([{ Id }], expect.any(Db));

          const newId = await db.profile.findBy({ UserId }).get('Id');

          expect(beforeCreate).toHaveBeenCalledTimes(1);
          expect(afterCreate).toHaveBeenCalledTimes(1);
          expect(afterCreate).toBeCalledWith([{ Id: newId }], expect.any(Db));
        });
      });
    });
  });

  describe('not required hasOne', () => {
    class UserTable extends BaseTable {
      readonly table = 'user';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
        Name: t.name('name').text(),
        Password: t.name('password').text(),
      }));

      relations = {
        profile: this.hasOne(() => ProfileTable, {
          columns: ['Id'],
          references: ['UserId'],
        }),
      };
    }

    class ProfileTable extends BaseTable {
      readonly table = 'profile';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
        UserId: t.name('user_id').integer(),
      }));
    }

    const local = orchidORM(ormParams, {
      user: UserTable,
      profile: ProfileTable,
    });

    it('should query related record and get an `undefined`', async () => {
      const profile = await local.user.queryRelated('profile', { Id: 123 });
      expect(profile).toBe(undefined);
    });

    it('should be selectable', async () => {
      const id = await local.user.get('Id').create(userData);

      const result = await local.user.select('Id', {
        profile: (q) => q.profile,
      });

      expect(result).toEqual([
        {
          Id: id,
          profile: null,
        },
      ]);
    });
  });

  it('should be supported in a `where` callback', () => {
    const q = db.user.where((q) =>
      q.profile.whereIn('Bio', ['a', 'b']).count().equals(1),
    );

    expectSql(
      q.toSQL(),
      `
        SELECT ${userSelectAll} FROM "user" WHERE (
          SELECT count(*) = $1
          FROM "profile"
          WHERE "profile"."bio" IN ($2, $3)
            AND "profile"."user_id" = "user"."id"
            AND "profile"."profile_key" = "user"."user_key"
        )
      `,
      [1, 'a', 'b'],
    );
  });
});

describe('hasOne through', () => {
  it('should resolve recursive situation when both tables depends on each other', () => {
    class Post extends BaseTable {
      table = 'post';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
      }));

      relations = {
        postTag: this.hasOne(() => PostTag, {
          columns: ['Id'],
          references: ['PostId'],
        }),

        tag: this.hasOne(() => Tag, {
          through: 'postTag',
          source: 'tag',
        }),
      };
    }

    class Tag extends BaseTable {
      table = 'tag';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
      }));

      relations = {
        postTag: this.hasOne(() => PostTag, {
          columns: ['Id'],
          references: ['PostId'],
        }),

        post: this.hasOne(() => Post, {
          through: 'postTag',
          source: 'post',
        }),
      };
    }

    class PostTag extends BaseTable {
      table = 'postTag';
      columns = this.setColumns(
        (t) => ({
          PostId: t
            .name('postId')
            .integer()
            .foreignKey(() => Post, 'Id'),
          TagId: t
            .name('tagId')
            .integer()
            .foreignKey(() => Tag, 'Id'),
        }),
        (t) => t.primaryKey(['PostId', 'TagId']),
      );

      relations = {
        post: this.belongsTo(() => Post, {
          references: ['Id'],
          columns: ['PostId'],
        }),

        tag: this.belongsTo(() => Tag, {
          references: ['Id'],
          columns: ['TagId'],
        }),
      };
    }

    const local = orchidORM(ormParams, {
      post: Post,
      tag: Tag,
      postTag: PostTag,
    });

    expect(Object.keys(local.post.relations)).toEqual(['postTag', 'tag']);
    expect(Object.keys(local.tag.relations)).toEqual(['postTag', 'post']);
  });

  it('should throw if through relation is not defined', () => {
    class Post extends BaseTable {
      table = 'post';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
      }));

      relations = {
        tag: this.hasOne(() => Tag, {
          through: 'postTag',
          source: 'tag',
        }),
      };
    }

    class Tag extends BaseTable {
      table = 'tag';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
      }));
    }

    expect(() => {
      orchidORM(ormParams, {
        post: Post,
        tag: Tag,
      });
    }).toThrow(
      'Cannot define a `tag` relation on `post`: cannot find `postTag` relation required by the `through` option',
    );
  });

  it('should throw if source relation is not defined', () => {
    class Post extends BaseTable {
      table = 'post';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
      }));

      relations = {
        postTag: this.hasOne(() => PostTag, {
          columns: ['Id'],
          references: ['PostId'],
        }),

        tag: this.hasOne(() => Tag, {
          through: 'postTag',
          source: 'tag',
        }),
      };
    }

    class Tag extends BaseTable {
      table = 'tag';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
      }));
    }

    class PostTag extends BaseTable {
      table = 'postTag';
      columns = this.setColumns(
        (t) => ({
          PostId: t
            .name('postId')
            .integer()
            .foreignKey(() => Post, 'Id'),
          TagId: t
            .name('tagId')
            .integer()
            .foreignKey(() => Tag, 'Id'),
        }),
        (t) => t.primaryKey(['PostId', 'TagId']),
      );
    }

    expect(() => {
      orchidORM(ormParams, {
        post: Post,
        tag: Tag,
        postTag: PostTag,
      });
    }).toThrow(
      'Cannot define a `tag` relation on `post`: cannot find `tag` relation in `postTag` required by the `source` option',
    );
  });

  it('should support `queryRelated` to query related data', async () => {
    const query = db.message.queryRelated('profile', {
      AuthorId: 1,
      MessageKey: 'key',
    });
    expectSql(
      query.toSQL(),
      `
        SELECT ${profileSelectAll} FROM "profile"
        WHERE EXISTS (
          SELECT 1 FROM "user" AS "sender"
          WHERE "profile"."user_id" = "sender"."id"
            AND "profile"."profile_key" = "sender"."user_key"
            AND "sender"."id" = $1
            AND "sender"."user_key" = $2
        )
      `,
      [1, 'key'],
    );
  });

  it('should handle chained query', () => {
    const query = db.message
      .where({ Text: 'text' })
      .chain('profile')
      .where({ Bio: 'bio' });

    expectSql(
      query.toSQL(),
      `
        SELECT ${profileSelectAll} FROM "profile"
        WHERE EXISTS (
            SELECT 1 FROM "message"
            WHERE "message"."text" = $1
              AND EXISTS (
                SELECT 1 FROM "user" AS "sender"
                WHERE "profile"."user_id" = "sender"."id"
                  AND "profile"."profile_key" = "sender"."user_key"
                  AND "sender"."id" = "message"."author_id"
                  AND "sender"."user_key" = "message"."message_key"
              )
          )
          AND "profile"."bio" = $2
      `,
      ['text', 'bio'],
    );
  });

  it('should handle long chained query', () => {
    const q = db.message
      .where({ Text: 'text' })
      .chain('profile')
      .where({ Bio: 'bio' })
      .chain('onePost')
      .where({ Body: 'body' });

    assertType<Awaited<typeof q>, Post[]>();

    expectSql(
      q.toSQL(),
      `
        SELECT ${postSelectAll}
        FROM "post" "onePost"
        WHERE
          EXISTS (
            SELECT 1
            FROM "profile"
            WHERE
              EXISTS (
                SELECT 1
                FROM "message"
                WHERE "message"."text" = $1
                  AND EXISTS (
                    SELECT 1
                    FROM "user" AS "sender"
                    WHERE "profile"."user_id" = "sender"."id"
                      AND "profile"."profile_key" = "sender"."user_key"
                      AND "sender"."id" = "message"."author_id"
                      AND "sender"."user_key" = "message"."message_key"
                  )
              )
              AND "profile"."bio" = $2
              AND EXISTS (
                SELECT 1
                FROM "user"
                WHERE "onePost"."user_id" = "user"."id"
                  AND "onePost"."title" = "user"."user_key"
                  AND "user"."id" = "profile"."user_id"
                  AND "user"."user_key" = "profile"."profile_key"
              )
          )
          AND "onePost"."body" = $3
      `,
      ['text', 'bio', 'body'],
    );
  });

  it('should disable create', () => {
    // @ts-expect-error hasOne with through option should not have chained create
    db.message.chain('profile').create(chatData);
  });

  it('should support chained delete', () => {
    const query = db.message
      .where({ Text: 'text' })
      .chain('profile')
      .where({ Bio: 'bio' })
      .delete();

    expectSql(
      query.toSQL(),
      `
        DELETE FROM "profile"
        WHERE EXISTS (
            SELECT 1 FROM "message"
            WHERE "message"."text" = $1
              AND EXISTS (
                SELECT 1 FROM "user" AS "sender"
                WHERE "profile"."user_id" = "sender"."id"
                  AND "profile"."profile_key" = "sender"."user_key"
                  AND "sender"."id" = "message"."author_id"
                  AND "sender"."user_key" = "message"."message_key"
              )
          )
          AND "profile"."bio" = $2
      `,
      ['text', 'bio'],
    );
  });

  it('should have proper joinQuery', () => {
    expectSql(
      (
        db.message.relations.profile.relationConfig.joinQuery(
          db.profile.as('p'),
          db.message.as('m'),
        ) as Query
      ).toSQL(),
      `
        SELECT ${profileSelectAll} FROM "profile" "p"
        WHERE EXISTS (
          SELECT 1 FROM "user" AS "sender"
          WHERE "p"."user_id" = "sender"."id"
            AND "p"."profile_key" = "sender"."user_key"
            AND "sender"."id" = "m"."author_id"
            AND "sender"."user_key" = "m"."message_key"
        )
      `,
    );
  });

  it('should be supported in whereExists', () => {
    expectSql(
      db.message.whereExists('profile').toSQL(),
      `
        SELECT ${messageSelectAll} FROM "message"
        WHERE EXISTS (
          SELECT 1 FROM "profile"
          WHERE EXISTS (
            SELECT 1 FROM "user" AS "sender"
            WHERE "profile"."user_id" = "sender"."id"
              AND "profile"."profile_key" = "sender"."user_key"
              AND "sender"."id" = "message"."author_id"
              AND "sender"."user_key" = "message"."message_key"
          )
        )
      `,
    );

    expectSql(
      db.message
        .as('m')
        .whereExists((q) => q.profile.where({ Bio: 'bio' }))
        .toSQL(),
      `
        SELECT ${messageSelectAll} FROM "message" "m"
        WHERE EXISTS (
          SELECT 1 FROM "profile"
          WHERE "profile"."bio" = $1
            AND EXISTS (
              SELECT 1 FROM "user" AS "sender"
              WHERE "profile"."user_id" = "sender"."id"
                AND "profile"."profile_key" = "sender"."user_key"
                AND "sender"."id" = "m"."author_id"
                AND "sender"."user_key" = "m"."message_key"
            )
        )
      `,
      ['bio'],
    );

    expectSql(
      db.message
        .as('m')
        .whereExists('profile', (q) => q.where({ 'profile.Bio': 'bio' }))
        .toSQL(),
      `
        SELECT ${messageSelectAll} FROM "message" "m"
        WHERE EXISTS (
          SELECT 1 FROM "profile"
          WHERE EXISTS (
            SELECT 1 FROM "user" AS "sender"
            WHERE "profile"."user_id" = "sender"."id"
              AND "profile"."profile_key" = "sender"."user_key"
              AND "sender"."id" = "m"."author_id"
              AND "sender"."user_key" = "m"."message_key"
          )
          AND "profile"."bio" = $1
        )
      `,
      ['bio'],
    );
  });

  it('should be supported in join', () => {
    const query = db.message
      .as('m')
      .join('profile', (q) => q.where({ Bio: 'bio' }))
      .select('Text', 'profile.Bio');

    assertType<Awaited<typeof query>, { Text: string; Bio: string | null }[]>();

    expectSql(
      query.toSQL(),
      `
        SELECT "m"."text" "Text", "profile"."bio" "Bio"
        FROM "message" "m"
        JOIN "profile"
          ON EXISTS (
            SELECT 1 FROM "user" AS "sender"
            WHERE "profile"."user_id" = "sender"."id"
              AND "profile"."profile_key" = "sender"."user_key"
              AND "sender"."id" = "m"."author_id"
              AND "sender"."user_key" = "m"."message_key"
          )
          AND "profile"."bio" = $1
      `,
      ['bio'],
    );
  });

  it('should be supported in join with a callback', () => {
    const query = db.message
      .as('m')
      .join(
        (q) => q.profile.as('p').where({ UserId: 123 }),
        (q) => q.where({ Bio: 'bio' }),
      )
      .select('Text', 'p.Bio');

    assertType<Awaited<typeof query>, { Text: string; Bio: string | null }[]>();

    expectSql(
      query.toSQL(),
      `
        SELECT "m"."text" "Text", "p"."bio" "Bio"
        FROM "message" "m"
        JOIN "profile" AS "p"
          ON "p"."bio" = $1
         AND "p"."user_id" = $2
         AND EXISTS (
            SELECT 1 FROM "user" AS "sender"
            WHERE "p"."user_id" = "sender"."id"
              AND "p"."profile_key" = "sender"."user_key"
              AND "sender"."id" = "m"."author_id"
              AND "sender"."user_key" = "m"."message_key"
          )
      `,
      ['bio', 123],
    );
  });

  it('should be supported in joinLateral', () => {
    const q = db.message
      .joinLateral('profile', (q) => q.as('p').where({ Bio: 'one' }))
      .where({ 'p.Bio': 'two' })
      .select('Text', 'p.*');

    assertType<Awaited<typeof q>, { Text: string; p: Profile }[]>();

    expectSql(
      q.toSQL(),
      `
        SELECT "message"."text" "Text", row_to_json("p".*) "p"
        FROM "message"
        JOIN LATERAL (
          SELECT ${profileSelectAll}
          FROM "profile" "p"
          WHERE "p"."bio" = $1
            AND EXISTS (
            SELECT 1
            FROM "user" AS "sender"
            WHERE "p"."user_id" = "sender"."id"
              AND "p"."profile_key" = "sender"."user_key"
              AND "sender"."id" = "message"."author_id"
              AND "sender"."user_key" = "message"."message_key"
          )
        ) "p" ON true
        WHERE "p"."Bio" = $2
      `,
      ['one', 'two'],
    );
  });

  describe('select', () => {
    it('should be selectable', () => {
      const query = db.message.as('m').select('Id', {
        profile: (q) => q.profile.where({ Bio: 'bio' }),
      });

      assertType<Awaited<typeof query>, { Id: number; profile: Profile }[]>();

      expectSql(
        query.toSQL(),
        `
          SELECT
            "m"."id" "Id",
            row_to_json("profile".*) "profile"
          FROM "message" "m"
          LEFT JOIN LATERAL (
            SELECT ${profileSelectAll} FROM "profile"
            WHERE "profile"."bio" = $1
              AND EXISTS (
                SELECT 1 FROM "user" AS "sender"
                WHERE "profile"."user_id" = "sender"."id"
                  AND "profile"."profile_key" = "sender"."user_key"
                  AND "sender"."id" = "m"."author_id"
                  AND "sender"."user_key" = "m"."message_key"
              )
          ) "profile" ON true
        `,
        ['bio'],
      );
    });

    it('should support chained select', () => {
      const q = db.message.select({
        items: (q) => q.profile.chain('onePost'),
      });

      assertType<Awaited<typeof q>, { items: Post[] }[]>();

      expectSql(
        q.toSQL(),
        `
          SELECT COALESCE("items".r, '[]') "items"
          FROM "message"
          LEFT JOIN LATERAL (
            SELECT json_agg(row_to_json("t".*)) r
            FROM (
              SELECT ${postSelectAll}
              FROM "post" "onePost"
              WHERE EXISTS (
                SELECT 1 FROM "profile"
                WHERE EXISTS (
                  SELECT 1 FROM "user" AS "sender"
                  WHERE "profile"."user_id" = "sender"."id"
                    AND "profile"."profile_key" = "sender"."user_key"
                    AND "sender"."id" = "message"."author_id"
                    AND "sender"."user_key" = "message"."message_key"
                ) AND EXISTS (
                  SELECT 1 FROM "user"
                  WHERE "onePost"."user_id" = "user"."id"
                    AND "onePost"."title" = "user"."user_key"
                    AND "user"."id" = "profile"."user_id"
                    AND "user"."user_key" = "profile"."profile_key"
                )
              )
            ) "t"
          ) "items" ON true
        `,
      );
    });

    it('should handle exists sub query', () => {
      const query = db.message.as('m').select('Id', {
        hasProfile: (q) => q.profile.exists(),
      });

      assertType<
        Awaited<typeof query>,
        { Id: number; hasProfile: boolean }[]
      >();

      expectSql(
        query.toSQL(),
        `
          SELECT
            "m"."id" "Id",
            COALESCE("hasProfile".r, false) "hasProfile"
          FROM "message" "m"
          LEFT JOIN LATERAL (
            SELECT true r
            FROM "profile"
            WHERE EXISTS (
              SELECT 1 FROM "user" AS "sender"
              WHERE "profile"."user_id" = "sender"."id"
                AND "profile"."profile_key" = "sender"."user_key"
                AND "sender"."id" = "m"."author_id"
                AND "sender"."user_key" = "m"."message_key"
            )
          ) "hasProfile" ON true
        `,
      );
    });

    it('should support recurring select', async () => {
      const q = db.message.select({
        profile: (q) =>
          q.profile.select({
            messages: (q) =>
              q.messages
                .select({
                  profile: (q) => q.profile,
                })
                .where({ 'profile.Bio': 'bio' }),
          }),
      });

      expectSql(
        q.toSQL(),
        `
          SELECT row_to_json("profile".*) "profile"
          FROM "message"
          LEFT JOIN LATERAL (
            SELECT COALESCE("messages".r, '[]') "messages"
            FROM "profile"
            LEFT JOIN LATERAL (
              SELECT json_agg(row_to_json("t".*)) r
              FROM (
                SELECT row_to_json("profile2".*) "profile"
                FROM "message" "messages"
                LEFT JOIN LATERAL (
                  SELECT ${profileSelectAll}
                  FROM "profile" "profile2"
                  WHERE EXISTS (
                    SELECT 1
                    FROM "user" AS "sender"
                    WHERE "profile2"."user_id" = "sender"."id"
                      AND "profile2"."profile_key" = "sender"."user_key"
                      AND "sender"."id" = "messages"."author_id"
                      AND "sender"."user_key" = "messages"."message_key"
                  )
                ) "profile2" ON true
                WHERE "profile2"."Bio" = $1
                  AND EXISTS (
                    SELECT 1
                    FROM "user"
                    WHERE "messages"."author_id" = "user"."id"
                      AND "messages"."message_key" = "user"."user_key"
                      AND "user"."id" = "profile"."user_id"
                      AND "user"."user_key" = "profile"."profile_key"
                  )
              ) "t"
            ) "messages" ON true
            WHERE EXISTS (
              SELECT 1
              FROM "user" AS "sender"
              WHERE "profile"."user_id" = "sender"."id"
                AND "profile"."profile_key" = "sender"."user_key"
                AND "sender"."id" = "message"."author_id"
                AND "sender"."user_key" = "message"."message_key"
            )
          ) "profile" ON true
        `,
        ['bio'],
      );
    });
  });

  describe('not required hasOne through', () => {
    class UserTable extends BaseTable {
      readonly table = 'user';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
        Name: t.name('name').text(),
        Password: t.name('password').text(),
      }));

      relations = {
        profile: this.hasOne(() => ProfileTable, {
          columns: ['Id'],
          references: ['UserId'],
        }),
      };
    }

    class ProfileTable extends BaseTable {
      readonly table = 'profile';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
        UserId: t.name('user_id').integer().nullable(),
      }));
    }

    class MessageTable extends BaseTable {
      readonly table = 'message';
      columns = this.setColumns((t) => ({
        Id: t.name('id').identity().primaryKey(),
        ChatId: t.name('chat_id').integer(),
        AuthorId: t.name('author_id').integer().nullable(),
        Text: t.name('text').text(),
      }));

      relations = {
        user: this.belongsTo(() => UserTable, {
          references: ['Id'],
          columns: ['AuthorId'],
        }),

        profile: this.hasOne(() => ProfileTable, {
          through: 'user',
          source: 'profile',
        }),
      };
    }

    const local = orchidORM(ormParams, {
      user: UserTable,
      profile: ProfileTable,
      message: MessageTable,
    });

    it('should query related record and get an `undefined`', async () => {
      const profile = await local.message.queryRelated('profile', {
        AuthorId: 123,
      });
      expect(profile).toBe(undefined);
    });

    it('should be selectable', async () => {
      const ChatId = await db.chat.get('IdOfChat').create(chatData);
      const id = await local.message
        .get('Id')
        .create({ ...messageData, ChatId });

      const result = await local.message.select('Id', {
        profile: (q) => q.profile,
      });

      expect(result).toEqual([
        {
          Id: id,
          profile: null,
        },
      ]);
    });
  });

  it('should be supported in a `where` callback', () => {
    const q = db.message.where((q) =>
      q.profile.whereIn('Bio', ['a', 'b']).count().equals(1),
    );

    expectSql(
      q.toSQL(),
      `
        SELECT ${messageSelectAll} FROM "message" WHERE (
          SELECT count(*) = $1
          FROM "profile"
          WHERE "profile"."bio" IN ($2, $3)
            AND EXISTS (
              SELECT 1
              FROM "user" AS "sender"
              WHERE "profile"."user_id" = "sender"."id"
                AND "profile"."profile_key" = "sender"."user_key"
                AND "sender"."id" = "message"."author_id"
                AND "sender"."user_key" = "message"."message_key"
            )
        )
      `,
      [1, 'a', 'b'],
    );
  });
});
